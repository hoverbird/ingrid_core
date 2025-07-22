/**
 * An identifier for a given letter or symbol, based on its index in the `WordList`'s `glyphs`
 * field.
 */
export type GlyphId = number;

/**
 * An identifier for a given word, based on its index in the `WordList`'s `words` field (scoped to
 * the relevant length bucket).
 */
export type WordId = number;

/**
 * An identifier that fully specifies a word by including both its length and `WordId`.
 */
export type GlobalWordId = [number, WordId];