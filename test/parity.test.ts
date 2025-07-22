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

  const command = new Deno.Command("ingrid_core", {
    args: [
      "--wordlist",
      "./resources/XwiWordList.txt",
      "--min-score",
      "50",
      "./example-grid.txt",
    ],
  });
  const { code, stdout, stderr } = await command.output();
  console.log("Rust stdout:", new TextDecoder().decode(stdout));
  console.log("Rust stderr:", new TextDecoder().decode(stderr));
  assertEquals(code, 0);

  const rustOutput = new TextDecoder().decode(stdout).trim();

  assertEquals(renderedGrid, rustOutput);
});