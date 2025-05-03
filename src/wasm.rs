// No longer need to import find_fill as we use find_fill_wasm
use crate::grid_config::{generate_grid_config_from_template_string, render_grid, GridConfig};
use crate::word_list::{WordList, WordListSourceConfig};
use crate::backtracking_search::{Slot, FillSuccess, FillFailure, WEIGHT_AGE_FACTOR, ArcConsistencyMode};
use crate::arc_consistency::EliminationSet;
use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;
use wasm_bindgen::prelude::*;
// use web_sys::console;
#[wasm_bindgen(start)]
pub fn initialize() {
    // Set the panic hook for better error messages
    crate::set_panic_hook();
}
const STWL_RAW: &str = include_str!("../resources/XwiWordList.txt");

/// A struct to batch multiple strings into a single allocation
/// to reduce JS-WASM boundary crossings
struct BatchedStrings {
    // The raw storage buffer that holds all strings
    buffer: String,
    // Start and end indices of each string within the buffer
    spans: Vec<(usize, usize)>,
}
impl BatchedStrings {

    /// Create a new batch with an initial capacity
    fn with_capacity(capacity: usize) -> Self {
        Self {
            buffer: String::with_capacity(capacity),
            spans: Vec::new(),
        }
    }

    /// Add a string to the batch, returning its index
    fn add(&mut self, s: &str) -> usize {
        let start = self.buffer.len();
        self.buffer.push_str(s);
        let end = self.buffer.len();
        self.spans.push((start, end));
        self.spans.len() - 1
    }

    /// Get a string by its index
    fn get(&self, index: usize) -> &str {
        let (start, end) = self.spans[index];
        &self.buffer[start..end]
    }
}
// Buffer pool removed for debugging WASM unreachable error
/// WASM-compatible function to fill a crossword grid
#[wasm_bindgen]
pub async fn fill_grid(
    grid_content: &str,
    min_score: Option<u16>,
    max_shared_substring: Option<usize>,
    word_list_source: Option<String>
) -> Result<String, JsError> {
    // console::log_1(&JsValue::from_str("Starting fill_grid function"));
    // console::time_with_label("fill_grid_total");
    // console::time_with_label("string_batching");
    
    // Create a batched strings container to hold all strings with a single allocation
    let mut batched_strings = BatchedStrings::with_capacity(
        grid_content.len() + if word_list_source.is_none() { STWL_RAW.len() } else { 1024 * 1024 }
    );
    // console::log_1(&JsValue::from_str("Created batched strings container"));

    // Add grid content to the batch for normalization later
    let grid_content_idx = batched_strings.add(grid_content);
    // console::log_1(&JsValue::from_str("Added grid content to batch"));
    // console::time_end_with_label("string_batching");
    // console::log_1(&JsValue::from_str("⏱️ Time spent creating string batch"));
    
    // Load the word list content from a URL or a file path, or use the built-in word list
    // console::time_with_label("word_list_loading");
    let word_list_content = match word_list_source {
        Some(src) => {
            // console::log_1(&JsValue::from_str("Loading external word list"));
            if src.starts_with("http://") || src.starts_with("https://") {
                use wasm_bindgen::JsCast;
                let window = web_sys::window().unwrap_throw();
                let resp_value = wasm_bindgen_futures::JsFuture::from(window.fetch_with_str(&src))
                    .await
                    .unwrap_throw();
                let response: web_sys::Response = resp_value.dyn_into().unwrap_throw();
                if !response.ok() {
                    wasm_bindgen::throw_str("Network response was not OK");
                }
                let text = wasm_bindgen_futures::JsFuture::from(response.text().unwrap_throw())
                    .await
                    .unwrap_throw();
                text.as_string().unwrap_throw()
            } else {
                std::fs::read_to_string(&src)
                    .map_err(|e| wasm_bindgen::throw_str(&format!("Failed to read file: {}", e)))
                    .unwrap_throw()
            }
        }
        None => {
            // Use the built-in word list without extra allocation
            // console::log_1(&JsValue::from_str("Using built-in word list"));
            STWL_RAW.to_string()
        }
    };

    // console::log_1(&JsValue::from_str("Word list loaded"));

    // Add the word list to our batched strings
    // console::time_with_label("word_list_batching");
    let word_list_idx = batched_strings.add(&word_list_content);
    // console::log_1(&JsValue::from_str("Added word list to batch"));
    // console::time_end_with_label("word_list_batching");
    // console::log_1(&JsValue::from_str("⏱️ Time spent batching word list"));
    // console::time_end_with_label("word_list_loading");
    // console::log_1(&JsValue::from_str("⏱️ Time spent loading word list"));

    // Get a pre-allocated buffer for string normalization from the pool
    // console::time_with_label("grid_content_normalization");
    let grid_content_for_normalization = batched_strings.get(grid_content_idx);
    let buffer_needed = grid_content_for_normalization.len() * 2; // Unicode normalization may expand
    
    // Buffer pool removed - creating buffer directly
    // Normalize grid content using the pre-allocated buffer
    let _normalized_buffer = String::with_capacity(buffer_needed); // Renamed and removed mut as it's unused
    let raw_grid_content = grid_content_for_normalization
        .trim()
        .nfkd()
        .collect::<String>()
        .to_lowercase();
    
    // console::time_end_with_label("grid_content_normalization");
    // console::log_1(&JsValue::from_str("⏱️ Time spent normalizing grid content"));

    let height = raw_grid_content.lines().count();

    if height == 0 {
        return Err(JsError::new("Grid must have at least one row"));
    }

    if raw_grid_content
        .lines()
        .map(|line| line.chars().count())
        .collect::<HashSet<_>>()
        .len()
        != 1
    {
        return Err(JsError::new("Rows in grid must all be the same length"));
    }

    // let _width = raw_grid_content.lines().next().unwrap().chars().count();

    // Validate max_shared_substring
    if !max_shared_substring
        .map_or(true, |mss| (3..=10).contains(&mss))
    {
        return Err(JsError::new(
            "If given, max shared substring must be between 3 and 10",
        ));
    }

    let min_score = min_score.unwrap_or(50);

    // Create the word list using the dynamically loaded content
    // console::time_with_label("word_list_processing");
    let word_list_content_ref = batched_strings.get(word_list_idx);
    
    // Track time spent creating WordList
    // console::time_with_label("word_list_creation");
    
    // Create WordList from the content
    let word_list = WordList::new(
        vec![WordListSourceConfig::FileContents {
            id: "0".into(),
            enabled: true,
            contents: word_list_content_ref.to_string(),
        }],
        None,
        None,
        max_shared_substring,
    );
    
    // console::time_end_with_label("word_list_creation");
    // console::log_1(&JsValue::from_str("⏱️ Time spent creating WordList"));
    
    #[allow(clippy::comparison_chain)]
    if let Some(errors) = word_list.get_source_errors().get("0") {
        if errors.len() == 1 {
            // Buffer pool removed
            return Err(JsError::new(&errors[0].to_string()));
        } else if errors.len() > 1 {
            let mut full_error = String::new();
            for error in errors {
                full_error.push_str(&format!("\n- {error}"));
            }
            // Buffer pool removed
            return Err(JsError::new(&full_error));
        }
    }

    if word_list.word_id_by_string.is_empty() {
        // Buffer pool removed
        return Err(JsError::new("Word list is empty"));
    }

    // console::time_with_label("template_string_processing");
    // Before grid parsing
    // console::log_1(&JsValue::from_str("Parsing grid configuration"));

    let grid_config =
        generate_grid_config_from_template_string(word_list, &raw_grid_content, min_score.into());

    // console::log_1(&JsValue::from_str("Grid configuration parsed successfully"));
    // console::time_end_with_label("template_string_processing");
    // console::log_1(&JsValue::from_str("⏱️ Time spent processing template string"));
    // console::log_1(&JsValue::from_str("Search initialized, starting solve"));

    let result = find_fill_wasm(&grid_config.to_config_ref())
        .map_err(|_| {
            // Buffer pool removed
            // console::log_1(&JsValue::from_str("No solution found"));
            JsError::new("Unfillable grid")
        })?;

    // console::log_1(&JsValue::from_str("Solution found"));

    // Return the filled grid as a string
    // console::time_with_label("grid_rendering");
    let rendered_grid = render_grid(&grid_config.to_config_ref(), &result.choices).replace('.', "#");
    // console::time_end_with_label("grid_rendering");
    // console::log_1(&JsValue::from_str("⏱️ Time spent rendering final grid"));
    
    // console::time_end_with_label("fill_grid_total");
    // console::log_1(&JsValue::from_str("⏱️ Total time spent in WASM boundary crossing"));
    
    // Buffer pool removed
    Ok(rendered_grid)
}

/// WASM-compatible wrapper for find_fill that avoids using std::time::Instant
fn find_fill_wasm(config: &GridConfig) -> Result<crate::backtracking_search::FillSuccess, crate::backtracking_search::FillFailure> {
    use crate::arc_consistency::EliminationSet;
    use crate::backtracking_search::*;
    
    // Create owned elimination sets
    let mut owned_elimination_sets = Some(EliminationSet::build_all(
        config.slot_configs,
        config.word_list,
    ));
    let elimination_sets = owned_elimination_sets.as_mut().unwrap();

    // Create basic Slot structs for the grid
    let mut slots: Vec<Slot> = config
        .slot_configs
        .iter()
        .map(|slot_config| {
            let glyph_counts_by_cell = crate::util::build_glyph_counts_by_cell(
                config.word_list,
                slot_config.length,
                &config.slot_options[slot_config.id],
            );

            let is_fixed = slot_config
                .complete_fill(config.fill, config.width)
                .is_some();

            let fixed_word_id = if is_fixed {
                // Replace assert_eq! with a check that returns an Err
                if config.slot_options[slot_config.id].len() != 1 {
                    return Err(FillFailure::HardFailure); // Return Err if inconsistent
                }
                Some(config.slot_options[slot_config.id][0])
            } else {
                None
            };

            // Wrap Slot creation in Ok
            Ok(Slot {
                id: slot_config.id,
                length: slot_config.length,
                eliminations: vec![None; config.word_list.words[slot_config.length].len()],
                remaining_option_count: config.slot_options[slot_config.id].len(),
                fixed_word_id, // Use the result of the check
                fixed_glyph_counts_by_cell: if is_fixed {
                    Some(glyph_counts_by_cell.clone())
                } else {
                    None
                },
                glyph_counts_by_cell,
            })
        })
        // Collect into a Result and propagate error with ?
        .collect::<Result<Vec<Slot>, FillFailure>>()?;

    // Initialize crossing weights
    let mut crossing_weights: Vec<f32> = (0..config.crossing_count).map(|_| 1.0).collect();

    // Establish initial arc consistency without timing
    let slot_weights = calculate_slot_weights(config, &slots, &crossing_weights);
    
    if !maintain_arc_consistency_wasm(
        config,
        &mut slots,
        &mut crossing_weights,
        &slot_weights,
        &ArcConsistencyMode::Initial,
        elimination_sets,
    ) {
        return Err(FillFailure::HardFailure);
    }

    // Initial max_backtracks value
    let mut max_backtracks: usize = 500;

    // Try to fill the grid with a maximum number of retries
    const MAX_RETRIES: u64 = 100000;
    for retry_num in 0..MAX_RETRIES {
        match find_fill_for_seed_wasm(
            config,
            &slots,
            max_backtracks,
            retry_num,
            &mut crossing_weights,
            elimination_sets,
        ) {
            Ok(mut result) => {
                result.statistics.retries = retry_num as usize;
                return Ok(result);
            }
            Err(FillFailure::ExceededBacktrackLimit(_)) => {
                // Increase max_backtracks for the next attempt
                max_backtracks = (max_backtracks + 1)
                    .max((max_backtracks as f32 * RETRY_GROWTH_FACTOR) as usize);
            }
            other_error => {
                return other_error;
            }
        }
    }

    // If we've exhausted all retries, return a hard failure
    Err(FillFailure::HardFailure)
}

// WASM-compatible version of maintain_arc_consistency that doesn't use Instant
fn maintain_arc_consistency_wasm(
    config: &GridConfig,
    slots: &mut [Slot],
    crossing_weights: &mut [f32],
    slot_weights: &[f32],
    mode: &ArcConsistencyMode,
    elimination_sets: &mut [EliminationSet],
) -> bool {
    struct Adapter<'a> {
        config: &'a GridConfig<'a>,
        slots: &'a mut [Slot],
    }

    use crate::arc_consistency::ArcConsistencyAdapter;
    use crate::types::WordId;
    use crate::grid_config::SlotId;
    use crate::util::GlyphCountsByCell;

    impl ArcConsistencyAdapter for Adapter<'_> {
        fn is_word_eliminated(&self, slot_id: SlotId, word_id: WordId) -> bool {
            self.slots[slot_id].eliminations[word_id].is_some()
        }

        fn get_glyph_counts(&self, slot_id: SlotId) -> GlyphCountsByCell {
            self.slots[slot_id]
                .fixed_glyph_counts_by_cell
                .clone()
                .unwrap_or_else(|| self.slots[slot_id].glyph_counts_by_cell.clone())
        }

        fn get_single_option(
            &self,
            slot_id: SlotId,
            eliminations: &EliminationSet,
        ) -> Option<WordId> {
            self.slots[slot_id].fixed_word_id.or_else(|| {
                self.config.slot_options[slot_id]
                    .iter()
                    .find(|&word_id| {
                        self.slots[slot_id].eliminations[*word_id].is_none()
                            && !eliminations.contains(*word_id)
                    })
                    .copied()
            })
        }
    }

    // First, if we're testing a choice or elimination, update the relevant state provisionally
    match mode {
        ArcConsistencyMode::Choice(choice) => {
            slots[choice.slot_id].choose_word(config, choice.word_id);
        }
        ArcConsistencyMode::Elimination(choice, blamed_slot_id) => {
            slots[choice.slot_id].add_elimination(config, choice.word_id, *blamed_slot_id);
        }
        ArcConsistencyMode::Initial => {}
    };

    let remaining_option_counts = slots
        .iter()
        .map(|slot| {
            if slot.fixed_word_id.is_some() {
                1
            } else {
                slot.remaining_option_count
            }
        })
        .collect::<Vec<_>>();

    let fixed_slots: Vec<bool> = match mode {
        ArcConsistencyMode::Initial => {
            // When establishing initial consistency, only slots whose contents were provided verbatim
            // should be considered fixed
            slots
                .iter()
                .map(|slot| slot.fixed_word_id.is_some())
                .collect()
        }
        _ => {
            // When maintaining consistency later on, we can treat all slots with exactly one option as fixed
            slots
                .iter()
                .map(|slot| remaining_option_counts[slot.id] == 1)
                .collect()
        }
    };

    let starting_slot_id = match mode {
        ArcConsistencyMode::Initial => None,
        ArcConsistencyMode::Choice(choice) | ArcConsistencyMode::Elimination(choice, _) => {
            Some(choice.slot_id)
        }
    };

    let blamed_slot_id = match mode {
        ArcConsistencyMode::Initial => None,
        ArcConsistencyMode::Choice(choice) => Some(choice.slot_id),
        ArcConsistencyMode::Elimination(_, blamed_slot_id) => *blamed_slot_id,
    };

    match crate::arc_consistency::establish_arc_consistency(
        config,
        &Adapter { config, slots },
        &remaining_option_counts,
        crossing_weights,
        slot_weights,
        &fixed_slots,
        starting_slot_id,
        elimination_sets,
    ) {
        // If we succeeded, apply the new eliminations to each slot
        Ok(()) => {
            for (slot_id, eliminations) in elimination_sets.iter().enumerate() {
                for &word_id in &eliminations.eliminated_ids {
                    slots[slot_id].add_elimination(config, word_id, blamed_slot_id);
                }
            }
            true
        }
        // If we failed, undo any provisional changes and update crossing weights
        Err(crate::arc_consistency::ArcConsistencyFailure { weight_updates }) => {
            match mode {
                ArcConsistencyMode::Choice(choice) => {
                    slots[choice.slot_id].clear_choice();
                }
                ArcConsistencyMode::Elimination(choice, ..) => {
                    slots[choice.slot_id].remove_elimination(config, choice.word_id);
                }
                ArcConsistencyMode::Initial => {}
            };

            for (slot_id, weight) in crossing_weights.iter_mut().enumerate() {
                *weight = 1.0
                    + ((*weight - 1.0) * WEIGHT_AGE_FACTOR)
                    + weight_updates.get(&slot_id).unwrap_or(&0.0);
            }
            false
        }
    }
}

// WASM-compatible version of find_fill_for_seed that doesn't use Instant
fn find_fill_for_seed_wasm(
    config: &GridConfig,
    slots: &Vec<Slot>,
    max_backtracks: usize,
    rng_seed: u64,
    crossing_weights: &mut [f32],
    elimination_sets: &mut [EliminationSet],
) -> Result<FillSuccess, FillFailure> {
    use rand::prelude::*;
    use rand::distributions::WeightedIndex;
    use std::sync::atomic::Ordering;
    use crate::grid_config::{Choice, SlotId};
    use crate::types::WordId;
    use crate::backtracking_search::*;

    // Initialize RNG with seed
    let mut rng: SmallRng = SeedableRng::seed_from_u64(rng_seed);
    let mut statistics = Statistics::default();

    let mut slots: Vec<Slot> = (*slots).clone();

    // Track slot choices made so far
    let mut choices: Vec<Choice> = Vec::with_capacity(config.slot_configs.len());

    let mut last_slot_id: Option<SlotId> = None;
    let mut last_starting_word_idx: Option<usize> = None;

    let slot_dist = WeightedIndex::new(RANDOM_SLOT_WEIGHTS).unwrap();
    let word_dist = WeightedIndex::new(RANDOM_WORD_WEIGHTS).unwrap();

    // Main loop
    loop {
        statistics.states += 1;

        if statistics.states % INTERRUPT_FREQUENCY == 0 {
            if let Some(abort) = config.abort {
                if abort.load(Ordering::Relaxed) {
                    return Err(FillFailure::Abort);
                }
            }
        }

        // Choose which slot to fill
        let slot_weights = calculate_slot_weights(config, &slots, crossing_weights);
        let Some(slot_id) = choose_next_slot(
            &slots,
            &slot_weights,
            last_slot_id,
            &mut rng,
            &slot_dist,
            &mut statistics,
        ) else {
            // If no more slots to fill, we're done
            // Build final choices array, checking each slot
            let mut final_choices = Vec::with_capacity(slots.len());
            for slot in slots {
                match slot.get_choice(config) {
                    Some(choice) => final_choices.push(choice),
                    None => {
                        // If any slot doesn't have a single choice, it's a hard failure
                        // This prevents the panic from the previous .expect()
                        return Err(FillFailure::HardFailure);
                    }
                }
            }

            return Ok(FillSuccess {
                statistics,
                choices: final_choices,
            });
        };

        // If still on same slot, start from where we left off
        let starting_word_idx: usize = if Some(slot_id) == last_slot_id {
            last_starting_word_idx.unwrap_or(0)
        } else {
            0
        };

        // Get candidate words
        let word_candidates: Vec<(usize, &WordId)> = config.slot_options[slot_id]
            .iter()
            .enumerate()
            .skip(starting_word_idx)
            .filter(|&(_, &word_id)| slots[slot_id].eliminations[word_id].is_none())
            .take(RANDOM_WORD_WEIGHTS.len())
            .collect();

        if word_candidates.is_empty() {
            // use web_sys::console; // Already commented out at top level
            // console::log_1(&JsValue::from_str(&format!(
            //     "No valid candidates found for slot {:?}",
            //     slots[slot_id]
            // )));
            return Err(FillFailure::HardFailure);
        }

        // Choose one candidate at random
        let (_, &word_id) =
            word_candidates[word_dist.sample(&mut rng).min(word_candidates.len() - 1)];

        // Record position for next iteration
        last_slot_id = Some(slot_id);
        last_starting_word_idx = Some(word_candidates[0].0);

        let choice = Choice { slot_id, word_id };

        // Try to propagate choice
        if maintain_arc_consistency_wasm(
            config,
            &mut slots,
            crossing_weights,
            &slot_weights,
            &ArcConsistencyMode::Choice(choice.clone()),
            elimination_sets,
        ) {
            // If successful, record choice and continue
            choices.push(choice);
            continue;
        }

        // If unsuccessful, rule out this option and try to backtrack
        let mut undoing_choice = choice;
        loop {
            statistics.backtracks += 1;

            if maintain_arc_consistency_wasm(
                config,
                &mut slots,
                crossing_weights,
                &slot_weights,
                &ArcConsistencyMode::Elimination(
                    undoing_choice.clone(),
                    choices.last().map(|choice| choice.slot_id),
                ),
                elimination_sets,
            ) {
                // If successful with elimination, done backtracking
                break;
            }

            // If unsuccessful, undo previous choice
            let Some(last_choice) = choices.pop() else {
                // If no previous choices, grid is unsolvable
                return Err(FillFailure::HardFailure);
            };
            undoing_choice = last_choice;

            slots[undoing_choice.slot_id].clear_choice();

            for slot in &mut slots {
                if slot.id != undoing_choice.slot_id && slot.fixed_word_id.is_none() {
                    slot.clear_eliminations(config, undoing_choice.slot_id);
                }
            }

            // Check if we've exceeded backtrack limit
            if statistics.backtracks > max_backtracks {
                return Err(FillFailure::ExceededBacktrackLimit(statistics.backtracks));
            }

            // Reset cached position
            last_slot_id = None;
            last_starting_word_idx = None;
        }
    }
}
