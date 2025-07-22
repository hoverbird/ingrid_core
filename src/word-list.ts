import type { GlobalWordId, GlyphId, WordId } from "./types.ts";
import { DupeIndex } from "./dupe-index.ts";

/**
 * The expected maximum length for a single slot.
 */
export const MAX_SLOT_LENGTH = 21;

/**
 * Completely arbitrary mapping from letter to point value.
 */
const LETTER_POINTS: ReadonlyMap<string, number> = new Map([
  ["a", 1], ["e", 1], ["i", 1], ["l", 1], ["n", 1], ["o", 1], ["r", 1], ["s", 1], ["t", 1], ["u", 1],
  ["d", 2], ["g", 2],
  ["b", 3], ["c", 3], ["m", 3], ["p", 3],
  ["f", 4], ["h", 4], ["v", 4], ["w", 4], ["y", 4],
  ["k", 5],
  ["j", 8], ["x", 8],
  ["q", 10], ["z", 10],
]);

/**
 * A class representing a word in the word list.
 */
export class Word {
  /**
   * The word as it would appear in a grid -- only lowercase letters or other valid glyphs.
   */
  public normalizedString: string;

  /**
   * The word as it appears in the user's word list, with arbitrary formatting and punctuation.
   */
  public canonicalString: string;

  /**
   * The glyph ids making up `normalizedString`.
   */
  public glyphs: GlyphId[];

  /**
   * The word's score, usually on a roughly 0 - 100 scale where 50 means average quality.
   */
  public score: number;

  /**
   * The sum of the scores of the word's letters.
   */
  public letterScore: number;

  /**
   * Is this word currently invisible to the user and unavailable for autofill? This will be
   * true for non-words that are part of an input grid or for words that have been removed from
   * the list dynamically.
   */
  public hidden: boolean;

  /**
   * If the word is currently not hidden, what is the index of the source that it came from? If
   * the same word appears in multiple sources, this will be the highest-priority (i.e., lowest)
   * one.
   */
  public sourceIndex?: number;

  /**
   * If we specified a personal list in config, the score from that list.
   */
  public personalWordScore?: number;

  constructor(
    normalizedString: string,
    canonicalString: string,
    glyphs: GlyphId[],
    score: number,
    hidden: boolean,
    sourceIndex?: number,
    personalWordScore?: number,
  ) {
    this.normalizedString = normalizedString;
    this.canonicalString = canonicalString;
    this.glyphs = glyphs;
    this.score = score;
    this.letterScore = [...normalizedString].reduce(
      (acc, char) => acc + (LETTER_POINTS.get(char) ?? 3),
      0,
    );
    this.hidden = hidden;
    this.sourceIndex = sourceIndex;
    this.personalWordScore = personalWordScore;
  }
}

/**
 * Given a canonical word string from a dictionary file, turn it into the normalized form we'll
 * use in the actual fill engine.
 */
export function normalizeWord(canonical: string): string {
  return canonical
    .toLowerCase()
    .normalize("NFC")
    .replace(/\s/g, "");
}

/**
 * An error that occurs while loading a word list.
 */
export class WordListError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WordListError";
  }
}

/**
 * Configuration for a word list source that is loaded from an in-memory array.
 */
export interface WordListSourceConfigMemory {
  type: "memory";
  id: string;
  enabled: boolean;
  words: [string, number][];
}

/**
 * Configuration for a word list source that is loaded from a file.
 */
export interface WordListSourceConfigFile {
  type: "file";
  id: string;
  enabled: boolean;
  path: string;
}

/**
 * Configuration for a word list source that is loaded from a string.
 */
export interface WordListSourceConfigFileContents {
  type: "fileContents";
  id: string;
  enabled: boolean;
  contents: string;
}

/**
 * Configuration describing a source of wordlist entries.
 */
export type WordListSourceConfig =
  | WordListSourceConfigMemory
  | WordListSourceConfigFile
  | WordListSourceConfigFileContents;

/**
 * A single word list entry.
 */
export interface RawWordListEntry {
  length: number;
  normalized: string;
  canonical: string;
  score: number;
}

/**
 * A struct representing the currently-loaded word list(s).
 */
export class WordList {
  /**
   * A list of all characters that occur in any (normalized) word. `GlyphId`s used everywhere
   * else are indices into this list.
   */
  public glyphs: string[] = [];

  /**
   * The inverse of `glyphs`: a map from a character to the `GlyphId` representing it.
   */
  public glyphIdByChar: Map<string, GlyphId> = new Map();

  /**
   * A list of all loaded words, bucketed by length. An index into `words` is the length of the
   * words in the bucket, so `words[0]` is always an empty vec.
   */
  public words: Word[][] = [[]];

  /**
   * A map from a normalized string to the id of the Word representing it.
   */
  public wordIdByString: Map<string, WordId> = new Map();

  /**
   * A dupe index reflecting the max substring length provided when configuring the `WordList`.
   */
  public dupeIndex: DupeIndex;

  /**
   * The maximum word length provided when configuring the `WordList`, if any.
   */
  public maxLength?: number;

  /**
   * Callback run after adding words.
   */
  public onUpdate?: (wordList: WordList, updatedIds: GlobalWordId[]) => void;

  /**
   * The most recently-received word list sources, as an ordered list.
   */
  public sourceConfigs: WordListSourceConfig[] = [];

  /**
   * If applicable, the index of the source that should be treated as the personal list.
   */
  public personalListIndex?: number;

  /**
   * The last seen state of each word list source, keyed by source id.
   */
  public sourceStates: Map<string, any> = new Map(); // TODO: Port WordListSourceState

  /**
   * Do we have pending updates that need to be saved?
   */
  public needsSync = false;

  constructor(
    sourceConfigs: WordListSourceConfig[],
    personalListIndex?: number,
    maxLength?: number,
    maxSharedSubstring?: number,
  ) {
    this.sourceConfigs = sourceConfigs;
    this.personalListIndex = personalListIndex;
    this.maxLength = maxLength;
    this.dupeIndex = new DupeIndex(maxSharedSubstring ?? 0);
  }

  public async replaceList(
    sourceConfigs: WordListSourceConfig[],
    personalListIndex?: number,
    maxLength?: number,
  ) {
    this.sourceConfigs = sourceConfigs;
    this.personalListIndex = personalListIndex;
    this.maxLength = maxLength;

    // A map to prevent loading duplicate words from different sources
    const seenWords = new Set<string>();

    for (const source of this.sourceConfigs) {
      if (!source.enabled) {
        continue;
      }

      const { entries } = await this.loadWordsFromSource(source);

      for (const rawEntry of entries) {
        if (maxLength && rawEntry.length > maxLength) {
          continue;
        }

        if (seenWords.has(rawEntry.normalized)) {
          continue;
        }
        seenWords.add(rawEntry.normalized);

        const glyphs = this.getGlyphIds(rawEntry.normalized);
        const wordLength = glyphs.length;

        if (this.words.length <= wordLength) {
          for (let i = this.words.length; i <= wordLength; i++) {
            this.words.push([]);
          }
        }

        const wordId = this.words[wordLength].length;
        this.words[wordLength].push(
          new Word(
            rawEntry.normalized,
            rawEntry.canonical,
            glyphs,
            rawEntry.score,
            false, // hidden
            // TODO: sourceIndex
          ),
        );
        this.wordIdByString.set(rawEntry.normalized, wordId);
      }
    }
  }

  private getGlyphIds(word: string): GlyphId[] {
    const glyphs: GlyphId[] = [];
    for (const char of word) {
      let id = this.glyphIdByChar.get(char);
      if (id === undefined) {
        id = this.glyphs.length;
        this.glyphs.push(char);
        this.glyphIdByChar.set(char, id);
      }
      glyphs.push(id);
    }
    return glyphs;
  }

  private parseWordListFileContents(
    fileContents: string,
    index: Map<string, number>,
    errors: WordListError[],
  ): RawWordListEntry[] {
    const entries: RawWordListEntry[] = [];

    for (const line of fileContents.split("\n")) {
      if (errors.length > 100) {
        break;
      }

      const lineParts = line.split(";");

      if (lineParts[0].includes("�")) {
        errors.push(new WordListError(`Invalid word: ${lineParts[0]}`));
        continue;
      }

      const canonical = lineParts[0].trim();
      const normalized = normalizeWord(canonical);
      if (normalized.length === 0) {
        continue;
      }
      if (index.has(normalized)) {
        continue;
      }

      let score = 50;
      if (lineParts.length >= 2) {
        const parsedScore = parseInt(lineParts[1].trim(), 10);
        if (isNaN(parsedScore)) {
          errors.push(new WordListError(`Invalid score: ${lineParts[1]}`));
          continue;
        }
        score = parsedScore;
      }

      index.set(normalized, entries.length);
      entries.push({
        length: normalized.length,
        normalized,
        canonical,
        score,
      });
    }

    return entries;
  }

  public getWordIdOrAddHidden(normalizedWord: string): GlobalWordId {
    const existingWordId = this.wordIdByString.get(normalizedWord);
    if (existingWordId !== undefined) {
      return [normalizedWord.length, existingWordId];
    }
    return this.addHiddenWord(normalizedWord);
  }

  private addHiddenWord(normalizedWord: string): GlobalWordId {
    const rawEntry: RawWordListEntry = {
      length: normalizedWord.length,
      normalized: normalizedWord,
      canonical: normalizedWord,
      score: 0,
    };
    const globalWordId = this.addWordSilent(rawEntry, undefined, true);

    if (this.onUpdate) {
      this.onUpdate(this, [globalWordId]);
    }

    return globalWordId;
  }

  private addWordSilent(
    rawEntry: RawWordListEntry,
    sourceIndex: number | undefined,
    hidden: boolean,
  ): GlobalWordId {
    const glyphs = this.getGlyphIds(rawEntry.normalized);
    const wordLength = glyphs.length;

    while (this.words.length <= wordLength) {
      this.words.push([]);
    }

    const wordId = this.words[wordLength].length;
    this.words[wordLength].push(
      new Word(
        rawEntry.normalized,
        rawEntry.canonical,
        glyphs,
        rawEntry.score,
        hidden,
        sourceIndex,
      ),
    );
    this.wordIdByString.set(rawEntry.normalized, wordId);

    this.dupeIndex.addWord(wordId, this.words[wordLength][wordId]);

    return [wordLength, wordId];
  }

  private async loadWordsFromSource(
    source: WordListSourceConfig,
  ): Promise<{ entries: RawWordListEntry[]; errors: WordListError[] }> {
    const index = new Map<string, number>();
    const errors: WordListError[] = [];
    let entries: RawWordListEntry[] = [];

    switch (source.type) {
      case "memory": {
        for (const [canonical, score] of source.words) {
          const normalized = normalizeWord(canonical);
          if (normalized.length === 0 || index.has(normalized)) {
            continue;
          }
          index.set(normalized, entries.length);
          entries.push({
            length: normalized.length,
            normalized,
            canonical,
            score,
          });
        }
        break;
      }
      case "file": {
        try {
          const contents = await Deno.readTextFile(source.path);
          entries = this.parseWordListFileContents(contents, index, errors);
        } catch (e) {
          errors.push(new WordListError(`Can't read file: "${source.path}"`));
        }
        break;
      }
      case "fileContents": {
        entries = this.parseWordListFileContents(source.contents, index, errors);
        break;
      }
    }

    return { entries, errors };
  }
}