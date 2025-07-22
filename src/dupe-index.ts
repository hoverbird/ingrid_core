import type { GlobalWordId, GlyphId, WordId } from "./types.ts";
import type { Word } from "./word-list.ts";

/**
 * Interface representing a `DupeIndex` with any window size.
 */
export interface AnyDupeIndex {
  /** The number of sequential characters that have to be shared to count as a dupe. */
  windowSize: number;
  /** Record a word in the index. */
  addWord(wordId: WordId, word: Word): void;
  /** Record that two arbitrary words should be considered duplicates of each other. */
  addDupePair(globalWordId1: GlobalWordId, globalWordId2: GlobalWordId): void;
  /** Remove a word pair from the extra dupes index. */
  removeDupePair(globalWordId1: GlobalWordId, globalWordId2: GlobalWordId): void;
  /** For a given word, get a map containing all words that duplicate it, indexed by their length. */
  getDupesByLength(globalWordId: GlobalWordId): Map<number, Set<WordId>>;
  /** Take the extra dupes out of the index. */
  takeExtraDupes(): Map<GlobalWordId, GlobalWordId[]>;
  /** Put extra dupes into the index. */
  putExtraDupes(extraDupes: Map<GlobalWordId, GlobalWordId[]>): void;
}

/**
 * A class used to track which words in the list share N-letter substrings.
 */
export class DupeIndex implements AnyDupeIndex {
  public windowSize: number;
  public groups: GlobalWordId[][] = [];
  public extraDupesByWord = new Map<GlobalWordId, GlobalWordId[]>();
  public groupKeysByWord = new Map<GlobalWordId, number[]>();
  public groupKeyBySubstring = new Map<string, number>();

  constructor(windowSize: number) {
    this.windowSize = windowSize;
  }

  public addWord(wordId: WordId, word: Word) {
    if (this.windowSize === 0) {
      return;
    }

    const globalWordId: GlobalWordId = [word.glyphs.length, wordId];
    const groupKeys: number[] = [];

    for (let i = 0; i <= word.glyphs.length - this.windowSize; i++) {
      const substring = word.glyphs.slice(i, i + this.windowSize);
      const substringKey = substring.join(",");
      
      let groupKey = this.groupKeyBySubstring.get(substringKey);
      if (groupKey !== undefined) {
        this.groups[groupKey].push(globalWordId);
        groupKeys.push(groupKey);
      } else {
        groupKey = this.groups.length;
        this.groups.push([globalWordId]);
        this.groupKeyBySubstring.set(substringKey, groupKey);
        groupKeys.push(groupKey);
      }
    }

    this.groupKeysByWord.set(globalWordId, groupKeys);
  }

  public addDupePair(globalWordId1: GlobalWordId, globalWordId2: GlobalWordId) {
    for (const [fromId, toId] of [[globalWordId1, globalWordId2], [globalWordId2, globalWordId1]]) {
      let group = this.extraDupesByWord.get(fromId);
      if (!group) {
        group = [];
        this.extraDupesByWord.set(fromId, group);
      }
      if (!group.includes(toId)) {
        group.push(toId);
      }
    }
  }

  public removeDupePair(globalWordId1: GlobalWordId, globalWordId2: GlobalWordId) {
    for (const [fromId, toId] of [[globalWordId1, globalWordId2], [globalWordId2, globalWordId1]]) {
      const group = this.extraDupesByWord.get(fromId);
      if (group) {
        const index = group.indexOf(toId);
        if (index > -1) {
          group.splice(index, 1);
        }
      }
    }
  }

  public getDupesByLength(globalWordId: GlobalWordId): Map<number, Set<WordId>> {
    const dupesByLength = new Map<number, Set<WordId>>();
    const addDupe = (length: number, wordId: WordId) => {
      if (!dupesByLength.has(length)) {
        dupesByLength.set(length, new Set());
      }
      dupesByLength.get(length)!.add(wordId);
    };

    addDupe(globalWordId[0], globalWordId[1]);

    const groupKeys = this.groupKeysByWord.get(globalWordId);
    if (groupKeys) {
      for (const groupKey of groupKeys) {
        for (const [length, wordId] of this.groups[groupKey]) {
          addDupe(length, wordId);
        }
      }
    }

    const extraDupes = this.extraDupesByWord.get(globalWordId);
    if (extraDupes) {
      for (const [length, wordId] of extraDupes) {
        addDupe(length, wordId);
      }
    }

    return dupesByLength;
  }

  public getDupes(slotId: number, wordId: WordId): Map<number, Set<WordId>> {
    const dupes = new Map<number, Set<WordId>>();
    const globalWordId: GlobalWordId = [slotId, wordId];
    const dupesByLength = this.getDupesByLength(globalWordId);
    for (const [length, wordIds] of dupesByLength.entries()) {
      for (const dupeWordId of wordIds) {
        if (!dupes.has(length)) {
          dupes.set(length, new Set());
        }
        dupes.get(length)!.add(dupeWordId);
      }
    }
    return dupes;
  }

  public takeExtraDupes(): Map<GlobalWordId, GlobalWordId[]> {
    const extraDupes = this.extraDupesByWord;
    this.extraDupesByWord = new Map();
    return extraDupes;
  }

  public putExtraDupes(extraDupes: Map<GlobalWordId, GlobalWordId[]>) {
    this.extraDupesByWord = extraDupes;
  }
}