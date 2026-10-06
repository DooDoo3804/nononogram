// state/cells.js — the three cell states, cycled by clicking:
// BLANK -> FILLED -> MARKED (player's "not a block" note) -> BLANK.
//
// Kept in its own zero-dependency module so render/ can import the constants
// without pulling in the whole session (and without a circular import).
export const BLANK = 0;
export const FILLED = 1;
export const MARKED = 2;

export const CELL_STATE_COUNT = 3;
