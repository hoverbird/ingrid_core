import { assertEquals } from "https://deno.land/std@0.140.0/testing/asserts.ts";
import { WordList } from "../src/word-list.ts";
import { generateGridConfigFromTemplateString, renderGrid } from "../src/grid-config.ts";
import { getGridTemplate } from "../src/grid-templates.ts";
import { findFill } from "../src/backtracking-search.ts";

Deno.test("Parity test with example-grid.txt", async () => {
  const gridTemplate = getGridTemplate("Parity1").gridString;
  const wordList = new WordList([]);
  await wordList.replaceList([
    {
      type: "file",
      id: "test-file",
      enabled: true,
      path: "test/fixtures/XwiWordList.txt",
    },
  ]);

  const gridConfig = generateGridConfigFromTemplateString(wordList, gridTemplate, 40);

  const result = await findFill(gridConfig);

  assertEquals(result.type, "Success");
  if (result.type !== "Success") {
    return;
  }

  const renderedGrid = renderGrid(gridConfig, result.choices);
  const expectedGrid = `
aced#notpc#cats
tare#aeiou#alou
tramptramptramp
attila##sorrier
###gulfs#leonia
ahhomeatlast###
loads#trees#mat
moss#thatd#halo
app#groks#sonos
###cremebrulees
accrue#seeme###
trouble##mesons
louisedelaramee
acls#simon#wane
side#seuss#snap
`.trim();

  assertEquals(renderedGrid, expectedGrid);
});