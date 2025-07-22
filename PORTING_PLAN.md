# Rust to TypeScript Porting Plan

This document outlines the plan to port the `ingrid_core` Rust library to TypeScript for the Deno runtime.

## Phase 1: Core Data Structures & Word List

- [ ] Port `types.rs` to `src/types.ts`
- [ ] Port `word_list.rs` to `src/word-list.ts`
- [ ] Implement word loading from files using Deno APIs
- [ ] Create tests for word list loading and normalization

## Phase 2: Grid Representation

- [ ] Port `grid_config.rs` to `src/grid-config.ts`
- [ ] Implement grid parsing from a template string
- [ ] Create tests for grid parsing and slot generation

## Phase 3: Generating and Filtering Word Options

- [ ] Implement `generate_slot_options` in `src/grid-config.ts`
- [ ] Create tests to verify word options are generated correctly

## Phase 4: Search Algorithm

- [ ] Analyze and port `backtracking_search.rs`
- [ ] Analyze and port `arc_consistency.rs`
- [ ] Create parity tests against the original Rust implementation

## Phase 5: CLI & Finalization

- [ ] Create a Deno CLI application
- [ ] Port the `dupe_index.rs` functionality
- [ ] Add JSDoc documentation and finalize the API