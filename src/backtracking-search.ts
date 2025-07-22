import type { WordId } from "./types.ts";
import type { GridConfig, SlotId } from "./grid-config.ts";
import type { GlyphCountsByCell } from "./util.ts";
import { buildGlyphCountsByCell } from "./util.ts";
import { ArcConsistencyAdapter, EliminationSet } from "./arc-consistency.ts";

/**
 * If the previously-attempted slot is within this distance of the "best" (lowest-priority-value)
 * slot, we should stick with the previous one instead of switching (per Balafoutis).
 */
export const ADAPTIVE_BRANCHING_THRESHOLD = 0.15;

/**
 * How many times should we loop before checking whether we've passed our deadline?
 */
export const INTERRUPT_FREQUENCY = 10;

/**
 * How much do we decrease the weight of each crossing every time we wipe out a domain?
 * The lower this is, the more we prioritize recent information over older information.
 */
export const WEIGHT_AGE_FACTOR = 0.99;

/**
 * How do we weigh the highest-ranked N slots when choosing which one to fill next?
 */
export const RANDOM_SLOT_WEIGHTS = [4, 2, 1];

/**
 * How do we weigh the highest-ranked N words when choosing a word for a given slot?
 */
export const RANDOM_WORD_WEIGHTS = [4, 2, 1];

/**
 * How much do we increase the backtrack limit when retrying?
 */
export const RETRY_GROWTH_FACTOR = 1.1;

/**
 * A class tracking the live state of a single slot during filling.
 */
export class Slot {
  public id: SlotId;
  public length: number;
  public eliminations: (SlotId | null | undefined)[];
  public glyphCountsByCell: GlyphCountsByCell;
  public remainingOptionCount: number;
  public fixedWordId?: WordId;
  public fixedGlyphCountsByCell?: GlyphCountsByCell;

  constructor(
    id: SlotId,
    length: number,
    eliminations: (SlotId | null | undefined)[],
    glyphCountsByCell: GlyphCountsByCell,
    remainingOptionCount: number,
  ) {
    this.id = id;
    this.length = length;
    this.eliminations = eliminations;
    this.glyphCountsByCell = glyphCountsByCell;
    this.remainingOptionCount = remainingOptionCount;
  }

  public addElimination(
    config: GridConfig,
    wordId: WordId,
    blamedSlotId: SlotId | null,
  ) {
    this.eliminations[wordId] = blamedSlotId;
    this.remainingOptionCount--;

    const word = config.wordList.words[this.length][wordId];
    for (const [cellIndex, glyph] of word.glyphs.entries()) {
      this.glyphCountsByCell[cellIndex][glyph]--;
    }
  }

  public removeElimination(config: GridConfig, wordId: WordId) {
    this.eliminations[wordId] = undefined;
    this.remainingOptionCount++;

    const word = config.wordList.words[this.length][wordId];
    for (const [cellIndex, glyph] of word.glyphs.entries()) {
      this.glyphCountsByCell[cellIndex][glyph]++;
    }
  }

  public chooseWord(config: GridConfig, wordId: WordId) {
    this.fixedWordId = wordId;
    this.fixedGlyphCountsByCell = buildGlyphCountsByCell(
      config.wordList,
      this.length,
      [wordId],
    );
  }

  public clearChoice() {
    this.fixedWordId = undefined;
    this.fixedGlyphCountsByCell = undefined;
  }
}
import type { Choice } from "./grid-config.ts";

/**
 * A class tracking stats about the filling process.
 */
export class Statistics {
  public states = 0;
  public backtracks = 0;
  public restrictedBranchings = 0;
  public retries = 0;
  public totalTime = 0;
  public tryTime = 0;
  public initialArcConsistencyTime = 0;
  public choiceArcConsistencyTime = 0;
  public eliminationArcConsistencyTime = 0;
}

/**
 * A struct representing the results of a fill operation.
 */
export interface FillSuccess {
  type: "Success";
  statistics: Statistics;
  choices: Choice[];
}

export type FillFailure =
  | { type: "HardFailure" }
  | { type: "Timeout" }
  | { type: "Abort" }
  | { type: "ExceededBacktrackLimit"; limit: number };
/**
 * Search for a valid fill for the given grid.
 */
export async function findFill(
  config: GridConfig,
  timeout?: number,
): Promise<FillSuccess | FillFailure> {
  const start = Date.now();
  const deadline = timeout ? start + timeout : undefined;

  const slots: Slot[] = config.slotConfigs.map((slotConfig) => {
    const glyphCountsByCell = buildGlyphCountsByCell(
      config.wordList,
      slotConfig.length,
      config.slotOptions[slotConfig.id],
    );

    const isFixed = slotConfig.getFill(config.fill, config.width).every((g) => g !== undefined);

    return new Slot(
      slotConfig.id,
      slotConfig.length,
      Array(config.wordList.words[slotConfig.length].length).fill(undefined),
      glyphCountsByCell,
      config.slotOptions[slotConfig.id].length,
    );
  });

  const crossingWeights: number[] = Array(config.crossingCount).fill(1.0);

  const initialOptionCounts = slots.map(s => s.remainingOptionCount);
  const initialFixedSlots = slots.map(s => s.fixedWordId !== undefined);
  const initialSlotWeights = calculateSlotWeights(config, slots, crossingWeights);

  const statistics = new Statistics();
  const eliminationSets = slots.map(
    (slot) => new EliminationSet(config.wordList.words[slot.length].length),
  );
  const adapter: ArcConsistencyAdapter = {
    isWordEliminated: (slotId: SlotId, wordId: WordId) => slots[slotId].eliminations[wordId] !== undefined,
    getGlyphCounts: (slotId: SlotId) => slots[slotId].glyphCountsByCell,
    getSingleOption: (slotId: SlotId, eliminations: EliminationSet) => {
      return config.slotOptions[slotId].find((wordId) => !eliminations.contains(wordId));
    },
  };

  if (!maintainArcConsistency(config, slots, crossingWeights, initialSlotWeights, { type: "Initial" }, statistics, eliminationSets, adapter)) {
    return { type: "HardFailure" };
  }

  let maxBacktracks = 500;
  for (let retryNum = 0; ; retryNum++) {
    const result = await findFillForSeed(
      config,
      slots,
      deadline,
      maxBacktracks,
      retryNum,
      crossingWeights,
    );

    if (result.type !== "ExceededBacktrackLimit") {
      return result;
    }

    maxBacktracks = Math.floor(maxBacktracks * RETRY_GROWTH_FACTOR) + 1;
  }
}

/**
 * Search for a valid fill for the given grid with a specific random seed.
 */
async function findFillForSeed(
  config: GridConfig,
  slots: Slot[],
  deadline: number | undefined,
  maxBacktracks: number,
  rngSeed: number,
  crossingWeights: number[],
): Promise<FillSuccess | FillFailure> {
  const start = Date.now();
  const statistics = new Statistics();
  const choices: Choice[] = [];
  let lastSlotId: SlotId | undefined;

  const eliminationSets = slots.map(
    (slot) => new EliminationSet(config.wordList.words[slot.length].length),
  );

  const adapter: ArcConsistencyAdapter = {
    isWordEliminated: (slotId: SlotId, wordId: WordId) => slots[slotId].eliminations[wordId] !== undefined,
    getGlyphCounts: (slotId: SlotId) => slots[slotId].glyphCountsByCell,
    getSingleOption: (slotId: SlotId, eliminations: EliminationSet) => {
      // Simplified for now
      return config.slotOptions[slotId].find((wordId) => !eliminations.contains(wordId));
    },
  };

  // TODO: Implement random number generation and weighted choices.

  while (true) {
    statistics.states++;

    if (statistics.states % INTERRUPT_FREQUENCY === 0) {
      if (deadline && Date.now() > deadline) {
        return { type: "Timeout" };
      }
      if (config.abort) {
        return { type: "Abort" };
      }
    }

    const slotWeights = calculateSlotWeights(config, slots, crossingWeights);
    const slotId = chooseNextSlot(slots, slotWeights, lastSlotId, statistics);

    if (slotId === undefined) {
      // We're done!
      statistics.totalTime = Date.now() - start;
      // TODO: Collect all choices, including implicit ones.
      return { type: "Success", statistics, choices };
    }

    const wordCandidates = config.slotOptions[slotId]
      .map((wordId, i) => ({ wordId, i }))
      .filter(({ wordId }) => slots[slotId].eliminations[wordId] === undefined)
      .slice(0, RANDOM_WORD_WEIGHTS.length);

    if (wordCandidates.length === 0) {
      // This should not happen if the grid is consistent
      return { type: "HardFailure" };
    }

    // TODO: Implement weighted random choice
    const { wordId } = wordCandidates[0];

    const choice: Choice = { slotId, wordId };

    if (maintainArcConsistency(config, slots, crossingWeights, slotWeights, { type: "Choice", choice }, statistics, eliminationSets, adapter)) {
      choices.push(choice);
      continue;
    }

    // Backtracking logic
    let undoingChoice = choice;
    while (true) {
      statistics.backtracks++;

      if (maintainArcConsistency(config, slots, crossingWeights, slotWeights, { type: "Elimination", choice: undoingChoice, blamedSlotId: choices[choices.length - 1]?.slotId }, statistics, eliminationSets, adapter)) {
        break;
      }

      const lastChoice = choices.pop();
      if (!lastChoice) {
        return { type: "HardFailure" };
      }
      undoingChoice = lastChoice;

      slots[undoingChoice.slotId].clearChoice();
      for (const slot of slots) {
        if (slot.id !== undoingChoice.slotId && slot.fixedWordId === undefined) {
          // This is a simplified version of clear_eliminations
          slot.eliminations = slot.eliminations.map(e => e === undoingChoice.slotId ? undefined : e);
        }
      }

      if (statistics.backtracks > maxBacktracks) {
        return { type: "ExceededBacktrackLimit", limit: statistics.backtracks };
      }
    }
  }

  return { type: "HardFailure" };
}

function calculateSlotWeights(
  config: GridConfig,
  slots: Slot[],
  crossingWeights: number[],
): number[] {
  return slots.map((slot) => {
    return config.slotConfigs[slot.id].crossings.reduce((sum, crossing) => {
      if (crossing && slots[crossing.otherSlotId].remainingOptionCount > 1) {
        return sum + crossingWeights[crossing.crossingId];
      }
      return sum;
    }, 0);
  });
}

function chooseNextSlot(
  slots: Slot[],
  slotWeights: number[],
  lastSlotId: SlotId | undefined,
  statistics: Statistics,
): SlotId | undefined {
  let bestSlotPriority: number | undefined;
  let lastSlotPriority: number | undefined;

  const sortedSlotIds = slots
    .map((s, i) => i)
    .filter((slotId) => slots[slotId].fixedWordId === undefined && slots[slotId].remainingOptionCount > 1);

  if (sortedSlotIds.length === 0) {
    return undefined;
  }

  sortedSlotIds.sort((a, b) => {
    const priorityA = slots[a].remainingOptionCount / slotWeights[a];
    const priorityB = slots[b].remainingOptionCount / slotWeights[b];

    if (bestSlotPriority === undefined || priorityA < bestSlotPriority) {
      bestSlotPriority = priorityA;
    }
    if (lastSlotId === a) {
      lastSlotPriority = priorityA;
    }

    return priorityA - priorityB;
  });

  if (bestSlotPriority !== undefined && lastSlotId !== undefined && lastSlotPriority !== undefined) {
    if (lastSlotPriority - bestSlotPriority < ADAPTIVE_BRANCHING_THRESHOLD) {
      statistics.restrictedBranchings++;
      return lastSlotId;
    }
  }

  // TODO: Implement weighted random choice
  return sortedSlotIds[0];
}
import { establishArcConsistency } from "./arc-consistency.ts";

type ArcConsistencyMode =
  | { type: "Initial" }
  | { type: "Choice"; choice: Choice }
  | { type: "Elimination"; choice: Choice; blamedSlotId?: SlotId };

function maintainArcConsistency(
  config: GridConfig,
  slots: Slot[],
  crossingWeights: number[],
  slotWeights: number[],
  mode: ArcConsistencyMode,
  statistics: Statistics,
  eliminationSets: EliminationSet[],
  adapter: ArcConsistencyAdapter,
): boolean {
  const start = Date.now();

  // Provisional state changes
  if (mode.type === "Choice") {
    slots[mode.choice.slotId].chooseWord(config, mode.choice.wordId);
  } else if (mode.type === "Elimination") {
    slots[mode.choice.slotId].addElimination(config, mode.choice.wordId, mode.blamedSlotId ?? null);
  }

  const remainingOptionCounts = slots.map(s => s.fixedWordId !== undefined ? 1 : s.remainingOptionCount);
  const fixedSlots = slots.map(s => remainingOptionCounts[s.id] === 1);
  const evaluatingSlot = mode.type === "Initial" ? undefined : mode.choice.slotId;

  const result = establishArcConsistency(
    config,
    adapter,
    remainingOptionCounts,
    crossingWeights,
    slotWeights,
    fixedSlots,
    evaluatingSlot,
    eliminationSets,
  );

  if (result) { // Failure
    if (mode.type === "Choice") {
      slots[mode.choice.slotId].clearChoice();
    } else if (mode.type === "Elimination") {
      slots[mode.choice.slotId].removeElimination(config, mode.choice.wordId);
    }
    for (const [crossingId, weightUpdate] of result.weightUpdates.entries()) {
      crossingWeights[crossingId] = 1.0 + ((crossingWeights[crossingId] - 1.0) * WEIGHT_AGE_FACTOR) + weightUpdate;
    }
    return false;
  }

  // Success
  for (const [slotId, eliminations] of eliminationSets.entries()) {
    for (const wordId of eliminations.eliminatedIds) {
      const blamedSlotId = mode.type === "Initial" ? undefined : mode.type === "Choice" ? mode.choice.slotId : mode.blamedSlotId;
      slots[slotId].addElimination(config, wordId, blamedSlotId ?? null);
    }
  }

  if (mode.type === "Initial") {
    statistics.initialArcConsistencyTime += Date.now() - start;
  } else if (mode.type === "Choice") {
    statistics.choiceArcConsistencyTime += Date.now() - start;
  } else {
    statistics.eliminationArcConsistencyTime += Date.now() - start;
  }

  return true;
}