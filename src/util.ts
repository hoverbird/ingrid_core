import type { WordId } from "./types.ts";
import type { WordList } from "./word-list.ts";

export function weightedRandom(weights: number[]): number {
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  let random = Math.random() * totalWeight;
  for (let i = 0; i < weights.length; i++) {
    if (random < weights[i]) {
      return i;
    }
    random -= weights[i];
  }
  return weights.length - 1;
}

export type GlyphCountsByCell = number[][];

export function buildGlyphCountsByCell(
  wordList: WordList,
  length: number,
  options: WordId[],
): GlyphCountsByCell {
  const glyphCountsByCell: GlyphCountsByCell = Array.from(
    { length },
    () => Array(wordList.glyphs.length).fill(0),
  );

  for (const wordId of options) {
    const word = wordList.words[length][wordId];
    for (const [cellIndex, glyph] of word.glyphs.entries()) {
      glyphCountsByCell[cellIndex][glyph]++;
    }
  }

  return glyphCountsByCell;
}