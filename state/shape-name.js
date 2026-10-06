// state/shape-name.js — what to call the shape the player just uncovered.
//
// OWNER: game-design track. The clear celebration's headline is the shape's name, and
// there are two possible sources for it, tried in order:
//
//   1. `spec.name` on the puzzle spec. This is the seam DOO-4 is expected to fill when
//      it wires the hand-authored catalogue into levels.js, and it wins when present.
//   2. A **fingerprint lookup** against the shape catalogue: dims plus the exact filled
//      cells. The solution a session holds is byte-identical to the catalogue shape it
//      came from, so this resolves the name without levels.js having to carry it.
//
// Path 2 exists so the celebration is not blocked on another track's file. Whichever
// way DOO-4 lands — adding `name` to each spec or just pointing `solutionFor` at a
// catalogue shape — the name shows up with no change here.
//
// Nothing to match (today's seeded-random puzzles) falls back to the puzzle's position
// in its level, which is what the puzzle grid already calls it.
//
// Public API:
//   fingerprint(dims, cells)                  -> string
//   buildNameIndex(catalogue)                 -> Map<fingerprint, name>
//   resolveShapeName(spec, cells, { index, fallback }) -> { name, source }

/** dims + filled cells, as a compact stable key. */
export function fingerprint(dims, cells) {
  let bits = '';
  for (let i = 0; i < cells.length; i++) bits += cells[i] ? '1' : '0';
  return `${dims.x}x${dims.y}x${dims.z}:${bits}`;
}

/** Index a `[{ name, dims, cells }]` catalogue by fingerprint. */
export function buildNameIndex(catalogue) {
  const index = new Map();
  for (const shape of catalogue ?? []) {
    if (!shape?.dims || !shape?.cells) continue;
    const key = fingerprint(shape.dims, shape.cells);
    // First definition wins, so a later duplicate cannot rename an existing shape.
    if (!index.has(key)) index.set(key, shape.name ?? shape.id);
  }
  return index;
}

export function resolveShapeName(spec, cells, { index = null, fallback = null } = {}) {
  if (spec?.name) return { name: spec.name, source: 'spec' };

  if (index && cells) {
    const hit = index.get(fingerprint(spec.dims, cells));
    if (hit) return { name: hit, source: 'catalogue' };
  }

  return { name: fallback ?? spec?.id ?? '???', source: 'fallback' };
}
