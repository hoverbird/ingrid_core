import { assertEquals } from "https://deno.land/std@0.140.0/testing/asserts.ts";
import { generateSlotsFromTemplateString } from "./grid-config.ts";

const exampleGrid = `
....#.....#....
....#.....#....
...............
......##.......
###.....#......
............###
.....#.....#...
....#.....#....
...#.....#.....
###cremebrulees
......#.....###
.......##......
...............
....#.....#....
....#.....#....
`;

Deno.test("generateSlotsFromTemplateString", () => {
  const slotSpecs = generateSlotsFromTemplateString(exampleGrid);
  assertEquals(slotSpecs.length, 60);
});
import { generateSlotConfigs } from "./grid-config.ts";

Deno.test("generateSlotConfigs", () => {
  const slotSpecs = generateSlotsFromTemplateString(exampleGrid);
  const { slotConfigs, crossingCount } = generateSlotConfigs(slotSpecs);

  assertEquals(slotConfigs.length, 60);
  // A manual count is too complex, but we can check for a reasonable number.
  assertEquals(crossingCount > 100, true);

  const firstAcross = slotConfigs[0];
  assertEquals(firstAcross.direction, "across");
  assertEquals(firstAcross.startCell, [0, 0]);

  // In the example grid, there are 30 across slots.
  const firstDown = slotConfigs[30];
  assertEquals(firstDown.direction, "down");
  assertEquals(firstDown.startCell, [0, 0]);

  assertEquals(firstAcross.crossings[0]!.otherSlotId, firstDown.id);
  assertEquals(firstDown.crossings[0]!.otherSlotId, firstAcross.id);
  assertEquals(firstAcross.crossings[0]!.crossingId, firstDown.crossings[0]!.crossingId);
});
import { generateSlotOptions } from "./grid-config.ts";
import { WordList } from "./word-list.ts";

Deno.test("generateSlotOptions", async () => {
  const wordList = new WordList([]);
  await wordList.replaceList([
    {
      type: "memory",
      id: "test",
      enabled: true,
      words: [
        ["cat", 50],
        ["car", 60],
        ["cot", 70],
        ["dog", 50],
      ],
    },
  ]);

  const cGlyph = wordList.glyphIdByChar.get("c")!;
  const aGlyph = wordList.glyphIdByChar.get("a")!;

  const entryFill = [cGlyph, aGlyph, undefined];
  const options = generateSlotOptions(wordList, entryFill, 0);

  assertEquals(options.length, 2);
  const optionWords = options.map((id) => wordList.words[3][id].normalizedString);
  assertEquals(optionWords.includes("cat"), true);
  assertEquals(optionWords.includes("car"), true);
});