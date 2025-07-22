import { parse } from "https://deno.land/std@0.140.0/flags/mod.ts";
import { WordList } from "./word-list.ts";
import { generateGridConfigFromTemplateString, renderGrid } from "./grid-config.ts";
import { findFill } from "./backtracking-search.ts";

async function main() {
  const flags = parse(Deno.args, {
    string: ["wordlist"],
    alias: { h: "help" },
  });

  if (flags.help) {
    console.log("Usage: deno run src/main.ts <GRID_PATH> [--wordlist <WORDLIST>]");
    return;
  }

  const gridPath = flags._[0];
  if (typeof gridPath !== "string") {
    console.error("Error: Missing GRID_PATH");
    return;
  }

  const gridTemplate = await Deno.readTextFile(gridPath);
  const wordList = new WordList([]);
  await wordList.replaceList([
    {
      type: "file",
      id: "wordlist",
      enabled: true,
      path: flags.wordlist ?? "resources/XwiWordList.txt",
    },
  ]);

  const gridConfig = generateGridConfigFromTemplateString(wordList, gridTemplate, 40);
  const result = await findFill(gridConfig);

  if (result.type === "Success") {
    const renderedGrid = renderGrid(gridConfig, result.choices);
    console.log(renderedGrid);
  } else {
    console.error(`Failed to find a fill: ${result.type}`);
  }
}

if (import.meta.main) {
  main();
}