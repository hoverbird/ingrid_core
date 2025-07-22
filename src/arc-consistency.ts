import type { WordId } from "./types.ts";
import type { GridConfig, SlotId } from "./grid-config.ts";
import type { GlyphCountsByCell } from "./util.ts";

/**
 * Structure for tracking words eliminated from a given slot while establishing arc consistency.
 */
export class EliminationSet {
  private eliminationsById: boolean[];
  public eliminatedIds: WordId[] = [];

  constructor(size: number) {
    this.eliminationsById = Array(size).fill(false);
  }

  public addElimination(id: WordId) {
    if (!this.eliminationsById[id]) {
      this.eliminationsById[id] = true;
      this.eliminatedIds.push(id);
    }
  }

  public resetEliminations() {
    for (const id of this.eliminatedIds) {
      this.eliminationsById[id] = false;
    }
    this.eliminatedIds = [];
  }

  public contains(id: WordId): boolean {
    return this.eliminationsById[id];
  }
}

/**
 * Interface that needs to be implemented by callers to `establishArcConsistency`.
 */
export interface ArcConsistencyAdapter {
  isWordEliminated(slotId: SlotId, wordId: WordId): boolean;
  getGlyphCounts(slotId: SlotId): GlyphCountsByCell;
  getSingleOption(slotId: SlotId, eliminations: EliminationSet): WordId | undefined;
}
/**
 * Result from a failed call to `establishArcConsistency`.
 */
export interface ArcConsistencyFailure {
  /** A map from crossing ID to the amount to increase its weight by. */
  weightUpdates: Map<number, number>;
}

/**
 * Result from a call to `establishArcConsistency`.
 */
export type ArcConsistencyResult = ArcConsistencyFailure | undefined;

/**
 * Determine which eliminations are needed to bring the grid into an arc-consistent state.
 */
export function establishArcConsistency(
  config: GridConfig,
  adapter: ArcConsistencyAdapter,
  initialOptionCounts: number[],
  crossingWeights: number[],
  slotWeights: number[],
  fixedSlots: boolean[],
  evaluatingSlot: SlotId | undefined,
  eliminationSets: EliminationSet[],
): ArcConsistencyResult {
  const slotStates = config.slotConfigs.map((slotConfig, i) => {
    eliminationSets[i].resetEliminations();
    return {
      slotId: slotConfig.id,
      eliminations: eliminationSets[i],
      blameCounts: Array(slotConfig.length).fill(0),
      optionCount: initialOptionCounts[i],
      glyphCountsByCell: undefined as GlyphCountsByCell | undefined,
      queuedCellIdxs: undefined as number[] | undefined,
      needsSingletonPropagation: false,
    };
  });

  const initialSlotIds = evaluatingSlot === undefined
    ? config.slotConfigs.map((s) => s.id)
    : [evaluatingSlot];

  for (const slotId of initialSlotIds) {
    if (slotStates[slotId].optionCount === 0) {
      return { weightUpdates: new Map() };
    }

    slotStates[slotId].queuedCellIdxs = config.slotConfigs[slotId].crossings
      .map((crossing, i) => (crossing && !fixedSlots[crossing.otherSlotId] ? i : -1))
      .filter((i) => i !== -1);

    if (slotStates[slotId].optionCount === 1) {
      slotStates[slotId].needsSingletonPropagation = true;
    }
  }

  const eliminateWord = (
    slotId: SlotId,
    wordId: WordId,
    blamedCellIdx?: number,
  ): ArcConsistencyResult => {
    const slotConfig = config.slotConfigs[slotId];
    const state = slotStates[slotId];

    state.eliminations.addElimination(wordId);
    state.optionCount--;
    if (blamedCellIdx !== undefined) {
      state.blameCounts[blamedCellIdx]++;
    }

    if (state.optionCount === 0) {
      const weightUpdates = new Map<number, number>();
      for (const [cellIdx, crossing] of slotConfig.crossings.entries()) {
        if (crossing) {
          weightUpdates.set(
            crossing.crossingId,
            state.blameCounts[cellIdx] / initialOptionCounts[slotId],
          );
        }
      }
      return { weightUpdates };
    }

    if (state.optionCount === 1) {
      state.needsSingletonPropagation = true;
    }

    const word = config.wordList.words[slotConfig.length][wordId];
    for (const [cellIndex, glyph] of word.glyphs.entries()) {
      if (!state.glyphCountsByCell) {
        state.glyphCountsByCell = adapter.getGlyphCounts(slotId);
      }
      state.glyphCountsByCell[cellIndex][glyph]--;

      if (blamedCellIdx === cellIndex) {
        continue;
      }

      if (state.glyphCountsByCell[cellIndex][glyph] === 0) {
        const crossing = slotConfig.crossings[cellIndex];
        if (crossing && !fixedSlots[crossing.otherSlotId]) {
          if (!state.queuedCellIdxs) {
            state.queuedCellIdxs = [];
          }
          if (!state.queuedCellIdxs.includes(cellIndex)) {
            state.queuedCellIdxs.push(cellIndex);
          }
        }
      }
    }
    return undefined;
  };

  while (true) {
    let queuedSlotId: SlotId | undefined;
    let minPriority = Infinity;

    for (let i = 0; i < slotStates.length; i++) {
      if (slotStates[i].queuedCellIdxs) {
        const priority = slotStates[i].optionCount / slotWeights[i];
        if (priority < minPriority) {
          minPriority = priority;
          queuedSlotId = i;
        }
      }
    }

    if (queuedSlotId === undefined) {
      break;
    }

    const state = slotStates[queuedSlotId];
    const cellIdxs = state.queuedCellIdxs!;
    state.queuedCellIdxs = undefined;

    cellIdxs.sort((a, b) => {
      const weightA = crossingWeights[config.slotConfigs[queuedSlotId!].crossings[a]!.crossingId];
      const weightB = crossingWeights[config.slotConfigs[queuedSlotId!].crossings[b]!.crossingId];
      return weightB - weightA;
    });

    for (const cellIdx of cellIdxs) {
      const crossing = config.slotConfigs[queuedSlotId].crossings[cellIdx]!;
      const otherSlotId = crossing.otherSlotId;
      const otherSlotConfig = config.slotConfigs[otherSlotId];
      const otherSlotOptions = config.slotOptions[otherSlotId];

      for (const wordId of otherSlotOptions) {
        if (adapter.isWordEliminated(otherSlotId, wordId) || slotStates[otherSlotId].eliminations.contains(wordId)) {
          continue;
        }

        const word = config.wordList.words[otherSlotConfig.length][wordId];
        const glyph = word.glyphs[crossing.otherSlotCell];

        if (!state.glyphCountsByCell) {
          state.glyphCountsByCell = adapter.getGlyphCounts(queuedSlotId);
        }

        if (state.glyphCountsByCell[cellIdx][glyph] === 0) {
          const result = eliminateWord(otherSlotId, wordId, crossing.otherSlotCell);
          if (result) return result;
        }
      }
    }

    const singletonSlots = slotStates
      .filter((s) => s.needsSingletonPropagation)
      .map((s) => {
        s.needsSingletonPropagation = false;
        return s.slotId;
      });

    for (const slotId of singletonSlots) {
      const wordId = adapter.getSingleOption(slotId, slotStates[slotId].eliminations)!;
      const dupes = config.wordList.dupeIndex.getDupes(slotId, wordId);

      for (const [otherSlotId, dupeWordIds] of dupes.entries()) {
        if (fixedSlots[otherSlotId]) continue;

        for (const dupeWordId of dupeWordIds) {
          if (!adapter.isWordEliminated(otherSlotId, dupeWordId) && !slotStates[otherSlotId].eliminations.contains(dupeWordId)) {
            const result = eliminateWord(otherSlotId, dupeWordId);
            if (result) return result;
          }
        }
      }
    }

    if (slotStates.every((s) => !s.queuedCellIdxs && !s.needsSingletonPropagation)) {
      break;
    }
  }

  return undefined;
}