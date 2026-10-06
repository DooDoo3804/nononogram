// tests/axis-colors.test.js — the axis-color drift guard (DOO-11).
//
// The X/Y/Z triad lives in four places, and nothing in the build ties them together:
//
//   style.css  `--axis-x/y/z`          clue-panel dots, tab underlines
//   style.css  `rgba(r, g, b, 0.12)`   the same three colors a second time, hand-
//                                      expanded into the active-tab gradients
//   render/gizmo.js  `AXIS_COLORS`     the 3D gizmo lines and their X/Y/Z sprites
//   render/scene.js  `BACKGROUND`      the parchment those gizmo lines sit on, which
//                                      is what makes the contrast figure true or false
//
// A split between copies is near-impossible to spot by eye: the pairs that have
// actually drifted here measure 1.3-1.6:1 against *each other*, so both look like
// "the red axis" in a screenshot. That is why this is a test and not a review note.
//
// It has happened twice already. DOO-5 darkened the CSS hexes for contrast; DOO-9
// darkened `AXIS_COLORS` to match — on a different branch. The two edits have never
// been in the same tree, so whichever branch you check out, one side is stale.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AXIS_COLORS } from '../render/gizmo.js';
import { THUMB_THEME } from '../render/thumbnail.js';

const repoFile = (rel) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');

const CSS = repoFile('style.css');
const AXES = ['x', 'y', 'z'];

// --- colour maths (WCAG 2.1 relative luminance / contrast ratio) ----------------

const norm = (hex) => {
  const h = hex.trim().toLowerCase().replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  return `#${full}`;
};
const rgbOf = (hex) => {
  const n = parseInt(norm(hex).slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const luminance = (hex) => {
  const [r, g, b] = rgbOf(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (hi + 0.05) / (lo + 0.05);
};

// --- reading the copies ---------------------------------------------------------

// Declarations of a custom property, in source order. Returning every hit rather
// than the first is deliberate: two declarations of the same variable is itself the
// bug (the cascade silently picks one), and a first-match helper would hide it.
function cssVarDecls(name) {
  const re = new RegExp(`--${name}:\\s*(#[0-9a-f]{3,8})\\s*;`, 'gi');
  return [...CSS.matchAll(re)].map((m) => norm(m[1]));
}
function cssVar(name) {
  const found = cssVarDecls(name);
  expect(found, `style.css declares no --${name}`).not.toHaveLength(0);
  return found[0];
}

// A JS colour literal, read out of the source instead of imported, because these
// are module-private constants and QA does not get to add exports to production
// code to make its own assertions convenient.
function jsColorLiteral(rel, name) {
  const src = repoFile(rel);
  const m = src.match(new RegExp(`${name}\\s*=\\s*(?:0x([0-9a-f]{6})|'(#[0-9a-f]{3,6})')`, 'i'));
  expect(m, `${rel} has no colour literal named ${name}`).not.toBeNull();
  return norm(m[1] ? `#${m[1]}` : m[2]);
}

const PAPER = cssVar('paper');

describe('axis colours — one triad, four copies', () => {
  it('style.css --axis-* and render/gizmo.js AXIS_COLORS name the same three colours', () => {
    const css = Object.fromEntries(AXES.map((a) => [a, cssVar(`axis-${a}`)]));
    const js = Object.fromEntries(AXES.map((a) => [a, norm(AXIS_COLORS[a])]));

    // Compared as one object so a failure prints all three pairs at once, and
    // annotated with the cross-contrast, which is the reason this needs a test:
    // a drifted pair is two shades of the same hue, not a visible mistake.
    const drift = AXES.filter((a) => css[a] !== js[a]).map(
      (a) => `  ${a}: style.css ${css[a]} vs gizmo.js ${js[a]} ` +
             `— only ${contrast(css[a], js[a]).toFixed(2)}:1 apart, indistinguishable on screen`,
    );
    expect(drift.join('\n'), `axis colours have drifted:\n${drift.join('\n')}\n`).toBe('');
    expect(js).toEqual(css);
  });

  // 4.5:1, not the 3:1 this used to assert, because the triad draws two different kinds
  // of mark and the stricter one binds: `createAxisGizmo` paints the lines (non-text,
  // 3:1) AND fills the X/Y/Z label glyphs with the same colour (text, AA 4.5:1). The
  // comment on `makeAxisLabelSprite` is about exactly this — the letters once landed
  // ~2:1 on the parchment while the lines beside them were ~5:1.
  //
  // Raising the floor is also what makes a green run mean something. The two triads this
  // repo has shipped BOTH clear 3:1 — pre-DOO-9 `#b5533f/#5f8a52/#4a6fa5` does it by
  // 0.03 on the y axis (3.03:1). So at 3:1 every assertion in this file passes on a tree
  // that quietly lost DOO-9's correction: the copies all agree, they just agree on the
  // old value. 4.5:1 is the line that separates them (old: 3.03-3.87, DOO-9: 4.73-5.11).
  //
  // This pins the choice DOO-9 already made; it does not make a new one. If the palette
  // is retuned the number moves with it — but then it moves deliberately, in a diff.
  it('clears WCAG AA 4.5:1 against the parchment — the axis colour also draws label text', () => {
    const measured = AXES.map((a) => [a, contrast(cssVar(`axis-${a}`), PAPER)]);
    const thin = measured.filter(([, c]) => c < 4.5);
    expect(
      thin
        .map(([a, c]) => `--axis-${a} is ${c.toFixed(2)}:1 on ${PAPER}, under the 4.5:1 AA floor for the X/Y/Z labels`)
        .join('; '),
    ).toBe('');
    for (const [, c] of measured) expect(c).toBeGreaterThanOrEqual(4.5);
  });

  it('declares each axis variable exactly once, so "the value" is unambiguous', () => {
    for (const a of AXES) expect(cssVarDecls(`axis-${a}`)).toHaveLength(1);
  });

  // The tab gradients spell the axis colour out as `rgba(181, 83, 63, 0.12)` because
  // CSS cannot take an alpha off a hex variable. That makes them a hand-maintained
  // copy inside the same file as the original — the cheapest of all the copies to
  // leave behind, and the one that is stale today on t-ui.
  it('spells the tab gradients with the same rgb as the --axis-* hex they sit next to', () => {
    const problems = [];
    let checked = 0;

    for (const block of CSS.split('}')) {
      const named = new Set([...block.matchAll(/var\(--axis-([xyz])\)/g)].map((m) => m[1]));
      const literals = [...block.matchAll(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/g)]
        .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
        // The white veil every gradient fades up through is not an axis colour.
        .filter(([r, g, b]) => !(r === 255 && g === 255 && b === 255));

      // Most of the stylesheet's rgba() is shadows and veils on the dark hub shell —
      // only a rule that also names an axis variable is making a claim about an axis.
      if (!literals.length || named.size === 0) continue;
      if (named.size > 1) {
        // Not a failure of the colours, a failure of this guard's reach: a rule that
        // names two axes leaves us unable to say which hex an rgba() should match.
        problems.push(`a rule names ${named.size} axes beside ${literals.length} rgba() ` +
                      `literal(s); split it so the pairing stays checkable:\n    ${block.trim().slice(0, 120)}`);
        continue;
      }
      const axis = [...named][0];
      const want = rgbOf(cssVar(`axis-${axis}`));
      for (const got of literals) {
        checked++;
        if (got.join() !== want.join()) {
          problems.push(`rgba(${got.join(', ')}, ...) sits in a --axis-${axis} rule, ` +
                        `but --axis-${axis} is rgb(${want.join(', ')})`);
        }
      }
    }

    expect(problems.join('\n  '), `tab gradients disagree with their axis variable:\n  ${problems.join('\n  ')}\n`).toBe('');
    // If a refactor replaces the gradients with colour-mix() this drops to 0 and the
    // guard quietly stops guarding, so assert it still found something to check.
    expect(checked, 'found no rgba() axis literals to check — did the selectors move?').toBeGreaterThan(0);
  });
});

// --paper is the other half of every contrast figure above. style.css owns the value;
// the renderer re-types it as a number for three.js and as a string for the 2D
// thumbnails. Darken --paper alone and the 3:1 assertion above keeps passing while
// the gizmo is actually drawn on the old background.
describe('--paper — the backdrop those contrast figures are measured against', () => {
  it('matches the three.js clear colour in render/scene.js', () => {
    expect(jsColorLiteral('render/scene.js', 'BACKGROUND')).toBe(PAPER);
  });

  it('matches the thumbnail background in render/thumbnail.js', () => {
    expect(norm(THUMB_THEME.background)).toBe(PAPER);
  });
});
