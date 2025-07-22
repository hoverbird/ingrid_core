import type { WordId } from "./types.ts";
import type { WordList } from "./word-list.ts";

/**
 * Structure used to efficiently prune options based on their crossings.
 *
 * The outer array has an entry for each cell; each of these entries consists of an array
 * indexed by `GlyphId`, containing the number of times that glyph occurs in that position in
 * all of the available options.
 */
export type GlyphCountsByCell = number[][];

/**
 * Initialize the `glyph_counts_by_cell` structure for a slot.
 */
export function buildGlyphCountsByCell(
  wordList: WordList,
  slotLength: number,
  options: WordId[],
): GlyphCountsByCell {
  const result: GlyphCountsByCell = Array.from({ length: slotLength }, () =>
    Array(wordList.glyphs.length).fill(0),
  );

  for (const wordId of options) {
    const word = wordList.words[slotLength][wordId];
    for (const [cellIndex, glyph] of word.glyphs.entries()) {
      result[cellIndex][glyph]++;
    }
  }

  return result;
}