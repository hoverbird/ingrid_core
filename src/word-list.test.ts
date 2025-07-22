import { assertEquals } from "https://deno.land/std@0.140.0/testing/asserts.ts";
import { normalizeWord, WordList, WordListSourceConfigMemory } from "./word-list.ts";

Deno.test("normalizeWord", () => {
  assertEquals(normalizeWord("  heLLo  "), "hello");
  assertEquals(normalizeWord("WoRlD"), "world");
  assertEquals(normalizeWord("fOo-bAr"), "foo-bar");
  assertEquals(normalizeWord("café"), "café");
  assertEquals(normalizeWord("ca fe"), "cafe");
});

Deno.test("WordList loads from memory source", async () => {
  const source: WordListSourceConfigMemory = {
    type: "memory",
    id: "test",
    enabled: true,
    words: [
      ["HELLO", 50],
      ["WORLD", 60],
    ],
  };

  const wordList = new WordList([]);
  await wordList.replaceList([source]);

  assertEquals(wordList.words.length, 6);
  assertEquals(wordList.words[5].length, 2);

  const wordIdHello = wordList.wordIdByString.get("hello");
  assertEquals(wordIdHello, 0);
  const wordHello = wordList.words[5][wordIdHello!];
  assertEquals(wordHello.normalizedString, "hello");
  assertEquals(wordHello.score, 50);

  const wordIdWorld = wordList.wordIdByString.get("world");
  assertEquals(wordIdWorld, 1);
  const wordWorld = wordList.words[5][wordIdWorld!];
  assertEquals(wordWorld.normalizedString, "world");
  assertEquals(wordWorld.score, 60);
});
import { WordListSourceConfigFile } from "./word-list.ts";

Deno.test("WordList loads from file source", async () => {
  const source: WordListSourceConfigFile = {
    type: "file",
    id: "test-file",
    enabled: true,
    path: "resources/XwiWordList.txt",
  };

  const wordList = new WordList([]);
  await wordList.replaceList([source]);

  const wordId = wordList.wordIdByString.get("aaa");
  assertEquals(wordId, 0);
  const word = wordList.words[3][wordId!];
  assertEquals(word.normalizedString, "aaa");
  assertEquals(word.score, 50);
});