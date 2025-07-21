import * as ingridCore from "../lib/ingrid_core.js";
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { parseGridString } from "../src/shared/gridUtils.ts";

// Removed unused import as Deno.readTextFile is used instead
// Load the word list from disk
// console.log("Word list loaded successfully from disk:", wordList.slice(0, 100));

// const testUrl = 'http://localhost:8000/resources/XwiWordList.txt';
const testWordListPath = './resources/XwiWordList.txt';
const gridFilePath = './resources/emptyGrid.txt';

// const wordList = await Deno.readTextFile(testWordListPath);


const gridContent = 
"#....\n" +
".....\n" +
".....\n" +
".....\n" +
"....#";

async function testGridFill() {
  try {
    console.log("Initializing WebAssembly module...");
    // await ingridCore.default();
    
    console.log("Creating grid content...");
    
    // Call fill_grid with only the grid template, letting other parameters be null
    const grid = parseGridString(await ingridCore.fill_grid(gridContent, null, null));
    console.log("Grid filling with word list succeeded:", grid);
    assertEquals(grid.length, 5)
    assertEquals(grid[0].length, 5)

    console.log("Grid filling succeeded:", grid);
  } catch (error) {
    console.error("Error during grid fill:", error);
    if (error instanceof Error) {
      console.error("Error name:", error.name);
      console.error("Error message:", error.message);
      console.error("Error stack:", error.stack);
    }
  }
}

// New test case to compare runtimes
async function testRuntimeComparison() {
  try {
    console.log("Comparing runtimes for ingridCore.fill_grid() vs CLI");
    
    // Measure WebAssembly initialization time
    const startWasmInit = Date.now();
    console.log("Initializing WebAssembly module...");
    // await ingridCore.default();
    const wasmInitTime = Date.now() - startWasmInit;
    console.log("WASM initialization time:", wasmInitTime, "ms");
    
    // Measure just the grid filling time
    const startWasmFill = Date.now();
    // await ingridCore.fill_grid(gridContent, null, null, testUrl);
    await ingridCore.fill_grid(gridContent, null, null);
    const wasmFillTime = Date.now() - startWasmFill;
    console.log("WASM grid fill time:", wasmFillTime, "ms");
    console.log("WASM total time:", wasmInitTime + wasmFillTime, "ms");
    
    // CLI timing remains the same
    const cliCommand = `ingrid_core --wordlist ${testWordListPath} ${gridFilePath}`;
    
    const startCli = Date.now();
    const parts = cliCommand.split(" ");
    const command = new Deno.Command(parts[0], {
      args: parts.slice(1),
      stdout: "piped",
      stderr: "piped",
    });
    const output = await command.output();
    const cliRuntime = Date.now() - startCli;
    console.log("CLI runtime:", cliRuntime, "ms");
    
    // Process output
    const textDecoder = new TextDecoder();
    const stdout = textDecoder.decode(output.stdout);
    console.log("CLI output:", stdout);
    const stderr = textDecoder.decode(output.stderr);
    if (stderr) console.error("CLI error output:", stderr);
  } catch (error) {
    console.error("Error during runtime comparison:", error);
  }
}

// Run the tests sequentially
await testGridFill();
// await testRuntimeComparison();
