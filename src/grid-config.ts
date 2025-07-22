/**
 * An identifier for a given slot.
 */
export type SlotId = number;

/**
 * An identifier for the intersection between two slots.
 */
export type CrossingId = number;

/**
 * Zero-indexed x and y coords for a cell in the grid, where y = 0 in the top row.
 */
export type GridCoord = [number, number];

/**
 * The direction that a slot is facing.
 */
export enum Direction {
  Across = "across",
  Down = "down",
}

/**
 * A struct representing a crossing between one slot and another.
 */
export interface Crossing {
  otherSlotId: SlotId;
  otherSlotCell: number;
  crossingId: CrossingId;
}
import type { GlyphId, WordId } from "./types.ts";

/**
 * A class representing the aspects of a slot in the grid that are static during filling.
 */
export class SlotConfig {
  public id: SlotId;
  public startCell: GridCoord;
  public direction: Direction;
  public length: number;
  public crossings: (Crossing | undefined)[];
  public minScoreOverride?: number;
  public filterPattern?: RegExp;

  constructor(
    id: SlotId,
    startCell: GridCoord,
    direction: Direction,
    length: number,
    crossings: (Crossing | undefined)[],
    minScoreOverride?: number,
    filterPattern?: RegExp,
  ) {
    this.id = id;
    this.startCell = startCell;
    this.direction = direction;
    this.length = length;
    this.crossings = crossings;
    this.minScoreOverride = minScoreOverride;
    this.filterPattern = filterPattern;
  }

  /**
   * Generate the coords for each cell of this slot.
   */
  public cellCoords(): GridCoord[] {
    const coords: GridCoord[] = [];
    for (let i = 0; i < this.length; i++) {
      if (this.direction === Direction.Across) {
        coords.push([this.startCell[0] + i, this.startCell[1]]);
      } else {
        coords.push([this.startCell[0], this.startCell[1] + i]);
      }
    }
    return coords;
  }

  /**
   * Generate the indices of this slot's cells in a flat fill array.
   */
  public cellFillIndices(gridWidth: number): number[] {
    return this.cellCoords().map((loc) => loc[0] + loc[1] * gridWidth);
  }

  /**
   * Get the values of this slot's cells from a flat fill array.
   */
  public getFill(fill: (GlyphId | undefined)[], gridWidth: number): (GlyphId | undefined)[] {
    return this.cellFillIndices(gridWidth).map((idx) => fill[idx]);
  }
}
import { WordList } from "./word-list.ts";

/**
 * A class that holds all of the information needed as input to a crossword filling operation.
 */
export class GridConfig {
  /** The word list used to fill the grid. */
  public wordList: WordList;
  /** A flat array of letters filled into the grid. */
  public fill: (GlyphId | undefined)[];
  /** Config representing all of the slots in the grid. */
  public slotConfigs: SlotConfig[];
  /** An array of available words for each slot. */
  public slotOptions: WordId[][];
  /** The width of the grid. */
  public width: number;
  /** The height of the grid. */
  public height: number;
  /** The number of distinct crossings in the grid. */
  public crossingCount: number;
  /** A flag to signal that the fill operation should be canceled. */
  public abort = false;

  constructor(
    wordList: WordList,
    fill: (GlyphId | undefined)[],
    slotConfigs: SlotConfig[],
    slotOptions: WordId[][],
    width: number,
    height: number,
    crossingCount: number,
  ) {
    this.wordList = wordList;
    this.fill = fill;
    this.slotConfigs = slotConfigs;
    this.slotOptions = slotOptions;
    this.width = width;
    this.height = height;
    this.crossingCount = crossingCount;
  }
}
/**
 * A struct identifying a specific slot in the grid.
 */
export interface SlotSpec {
  startCell: GridCoord;
  direction: Direction;
  length: number;
}

/**
 * Generate a list of `SlotSpec`s from a template string.
 *
 * In the template string:
 * - `.` represents an empty cell
 * - `#` represents a block
 * - letters represent themselves
 */
export function generateSlotsFromTemplateString(template: string): SlotSpec[] {
  function buildWords(grid: string[][]): GridCoord[][] {
    const result: GridCoord[][] = [];
    const paddedGrid = grid.map((row) => [...row, "#"]);
    paddedGrid.push(Array(paddedGrid[0].length).fill("#"));

    for (let y = 0; y < paddedGrid.length; y++) {
      let currentWordCoords: GridCoord[] = [];
      for (let x = 0; x < paddedGrid[y].length; x++) {
        if (paddedGrid[y][x] === "#") {
          if (currentWordCoords.length > 1) {
            result.push(currentWordCoords);
          }
          currentWordCoords = [];
        } else {
          currentWordCoords.push([x, y]);
        }
      }
    }
    return result;
  }

  const lines = template.trim().split("\n").map((l) => l.split(""));
  const height = lines.length;
  const width = lines[0].length;

  const slotSpecs: SlotSpec[] = [];

  for (const coords of buildWords(lines)) {
    slotSpecs.push({
      startCell: coords[0],
      length: coords.length,
      direction: Direction.Across,
    });
  }

  const transposedGrid: string[][] = [];
  for (let x = 0; x < width; x++) {
    transposedGrid[x] = [];
    for (let y = 0; y < height; y++) {
      transposedGrid[x][y] = lines[y][x];
    }
  }

  for (const coords of buildWords(transposedGrid)) {
    const retransposed = coords.map(([y, x]) => [x, y] as GridCoord);
    slotSpecs.push({
      startCell: retransposed[0],
      length: retransposed.length,
      direction: Direction.Down,
    });
  }

  return slotSpecs;
}
/**
 * Given `SlotSpec`s specifying the positions of the slots in a grid, generate
 * `SlotConfig`s containing derived information about crossings, etc.
 */
export function generateSlotConfigs(
  entries: SlotSpec[],
): { slotConfigs: SlotConfig[]; crossingCount: number } {
  const slotConfigs: SlotConfig[] = [];

  const cellByLoc: { coord: GridCoord; entries: { entryIndex: number; cellIndex: number }[] }[] = [];

  for (const [entryIndex, entry] of entries.entries()) {
    const coords = entry.direction === Direction.Across
      ? Array.from({ length: entry.length }, (_, i) => [entry.startCell[0] + i, entry.startCell[1]] as GridCoord)
      : Array.from({ length: entry.length }, (_, i) => [entry.startCell[0], entry.startCell[1] + i] as GridCoord);

    for (const [cellIndex, loc] of coords.entries()) {
      let cell = cellByLoc.find((c) => c.coord[0] === loc[0] && c.coord[1] === loc[1]);
      if (!cell) {
        cell = { coord: loc, entries: [] };
        cellByLoc.push(cell);
      }
      cell.entries.push({ entryIndex, cellIndex });
    }
  }

  cellByLoc.sort((a, b) => {
    if (a.coord[1] !== b.coord[1]) {
      return a.coord[1] - b.coord[1];
    }
    return a.coord[0] - b.coord[0];
  });

  const constraintIdCache = new Map<string, number>();
  let crossingCount = 0;

  for (const [entryIndex, entry] of entries.entries()) {
    const coords = entry.direction === Direction.Across
      ? Array.from({ length: entry.length }, (_, i) => [entry.startCell[0] + i, entry.startCell[1]])
      : Array.from({ length: entry.length }, (_, i) => [entry.startCell[0], entry.startCell[1] + i]);

    const crossings = coords.map((loc) => {
      const cell = cellByLoc.find((c) => c.coord[0] === loc[0] && c.coord[1] === loc[1])!;
      const crossingEntries = cell.entries.filter((e: { entryIndex: number; }) => e.entryIndex !== entryIndex);

      if (crossingEntries.length === 0) {
        return undefined;
      }

      const otherEntry = crossingEntries[0];
      const otherSlotId = otherEntry.entryIndex;
      const otherSlotCell = otherEntry.cellIndex;

      const id1 = Math.min(entryIndex, otherSlotId);
      const id2 = Math.max(entryIndex, otherSlotId);
      const cacheKey = `${id1},${id2}`;

      let crossingId = constraintIdCache.get(cacheKey);
      if (crossingId === undefined) {
        crossingId = crossingCount++;
        constraintIdCache.set(cacheKey, crossingId);
      }

      return {
        otherSlotId,
        otherSlotCell,
        crossingId,
      };
    });

    slotConfigs.push(
      new SlotConfig(
        entryIndex,
        entry.startCell,
        entry.direction,
        entry.length,
        crossings,
      ),
    );
  }

  return { slotConfigs, crossingCount };
}
/**
 * Given a single slot's fill, minimum score, and optional filter pattern, generate the possible
 * options for that slot.
 */
export function generateSlotOptions(
  wordList: WordList,
  entryFill: (GlyphId | undefined)[],
  minScore: number,
  filterPattern?: RegExp,
  allowedWordIds?: Set<WordId>,
): WordId[] {
  const length = entryFill.length;

  // If the slot is fully specified, we need to either use an existing word or create a new one.
  const isComplete = entryFill.every((g) => g !== undefined);
  if (isComplete) {
    const completeFill = entryFill as GlyphId[];
    const wordString = completeFill.map((glyphId) => wordList.glyphs[glyphId]).join("");
    const [, wordId] = wordList.getWordIdOrAddHidden(wordString);
    return [wordId];
  }

  const options: WordId[] = [];
  if (!wordList.words[length]) {
    return [];
  }

  for (const [wordId, word] of wordList.words[length].entries()) {
    const enforceCriteria = !allowedWordIds?.has(wordId);

    if (enforceCriteria) {
      if (word.hidden || word.score < minScore) {
        continue;
      }

      if (filterPattern && !filterPattern.test(word.normalizedString)) {
        continue;
      }
    }

    let match = true;
    for (const [cellIndex, cellFill] of entryFill.entries()) {
      if (cellFill !== undefined && cellFill !== word.glyphs[cellIndex]) {
        match = false;
        break;
      }
    }

    if (match) {
      options.push(wordId);
    }
  }

  return options;
}
/**
 * A struct recording a slot assignment made during a fill process.
 */
export interface Choice {
  slotId: SlotId;
  wordId: WordId;
}

/**
 * Generate a `GridConfig` from a template string.
 */
export function generateGridConfigFromTemplateString(
  wordList: WordList,
  template: string,
  minScore: number,
): GridConfig {
  const lines = template.trim().split("\n").map((l) => l.trim());
  const height = lines.length;
  const width = lines[0].length;

  const fill: (GlyphId | undefined)[] = lines
    .flatMap((line) => [...line])
    .map((char) => {
      if (char === "." || char === "#") {
        return undefined;
      }
      return wordList.glyphIdByChar.get(char.toLowerCase());
    });

  const slotSpecs = generateSlotsFromTemplateString(template);
  const { slotConfigs, crossingCount } = generateSlotConfigs(slotSpecs);

  const slotOptions = slotConfigs.map((slot) => {
    const entryFill = slot.getFill(fill, width);
    return generateSlotOptions(
      wordList,
      entryFill,
      slot.minScoreOverride ?? minScore,
      slot.filterPattern,
    );
  });

  return new GridConfig(
    wordList,
    fill,
    slotConfigs,
    slotOptions,
    width,
    height,
    crossingCount,
  );
}
/**
 * Turn the given grid config and fill choices into a rendered string.
 */
export function renderGrid(config: GridConfig, choices: Choice[]): string {
  const grid: (string | undefined)[] = config.fill.map((g) =>
    g === undefined ? undefined : config.wordList.glyphs[g],
  );

  for (const { slotId, wordId } of choices) {
    const slotConfig = config.slotConfigs[slotId];
    const word = config.wordList.words[slotConfig.length][wordId];

    for (const [cellIndex, glyph] of word.glyphs.entries()) {
      const [x, y] = slotConfig.direction === Direction.Across
        ? [slotConfig.startCell[0] + cellIndex, slotConfig.startCell[1]]
        : [slotConfig.startCell[0], slotConfig.startCell[1] + cellIndex];
      grid[y * config.width + x] = config.wordList.glyphs[glyph];
    }
  }

  let output = "";
  for (let y = 0; y < config.height; y++) {
    for (let x = 0; x < config.width; x++) {
      const char = grid[y * config.width + x];
      output += char ?? ".";
    }
    if (y < config.height - 1) {
      output += "\n";
    }
  }
  return output;
}