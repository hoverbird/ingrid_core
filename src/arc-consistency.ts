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

  // ... (rest of the implementation is very complex and will be done in next steps)

  return undefined;
}