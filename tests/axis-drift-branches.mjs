// tests/axis-drift-branches.mjs — the axis-colour drift guard, widened to every branch.
//
// `tests/axis-colors.test.js` (DOO-11) checks the four copies in *one* tree: whichever
// branch you happen to have checked out. That is what the release ships from, so it is
// the right scope for a unit test — but it is not the question DOO-23 asked, which was
// "how many branches are drifted?" A per-tree guard answers that only if you check out
// all of them, and the workspace is shared: checking out branches under another agent's
// run would yank files out from under it.
//
// So this reads every branch through `git show` and never touches the working tree or
// the index, and it simulates the integration merge through `git merge-tree` +
// `git commit-tree`, which write dangling objects and move no refs.
//
// Two things it reports that the per-tree guard structurally cannot:
//
//   1. A merge whose copies all AGREE but agree on the pre-DOO-9 value. The guard only
//      compares copies to each other, so that merge is green while the accessibility
//      correction is silently absent. LIGHT clears WCAG 3:1 too — by 0.03 on the y axis.
//   2. Which DIRECTION each branch drifted. t-render-family has stale CSS, t-ui-family
//      has a stale gizmo. "Just fix the CSS" is right on one family and wrong on the other.
//
// Usage:  node tests/axis-drift-branches.mjs [--json]
// Exit:   0 if no branch is red, 1 otherwise. Read-only; safe to run during another run.

import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Two git exit codes here are information rather than failure, and both have to survive
// execFileSync's habit of throwing on anything non-zero:
//
//   `git show` on a missing path  — a fact about the branch (master has no render/gizmo.js
//                                   yet). Wants null, and wants its stderr swallowed.
//   `git merge-tree` exit 1       — "merged, with conflicts". It still WRITES the tree and
//                                   still prints the oid on stdout. Throwing that away is
//                                   how you end up reporting "no tree" for precisely the
//                                   merges worth looking at, so keep err.stdout.
function git(args, { allowFail = false } = {}) {
  try {
    return execFileSync('git', args, {
      cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    if (err.stdout) return err.stdout;
    if (allowFail) return null;
    throw err;
  }
}
const show = (rev, path) => git(['show', `${rev}:${path}`], { allowFail: true });

// --- colour maths (WCAG 2.1), same formulas as axis-colors.test.js --------------------

const norm = (hex) => {
  const h = hex.trim().toLowerCase().replace('#', '');
  return `#${h.length === 3 ? [...h].map((c) => c + c).join('') : h}`;
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

// The two triads this repo has actually shipped, so the report can name them instead of
// printing six hexes per row. Anything else prints as its literal values.
const LIGHT = ['#b5533f', '#5f8a52', '#4a6fa5']; // pre-DOO-9
const DARK = ['#9e3f2c', '#436a39', '#3d5c8c']; // DOO-9, the accessibility correction
const sameTriad = (a, b) => a.length === 3 && b.length === 3 && a.every((v, i) => v === b[i]);
const label = (triad) => {
  if (!triad.length) return 'absent';
  if (sameTriad(triad, LIGHT)) return 'LIGHT(pre-DOO-9)';
  if (sameTriad(triad, DARK)) return 'DARK(DOO-9)';
  return triad.join('/');
};

// --- reading the copies out of an arbitrary tree-ish ----------------------------------

function readTree(rev) {
  const css = show(rev, 'style.css');
  const gizmo = show(rev, 'render/gizmo.js');
  const scene = show(rev, 'render/scene.js');
  const thumb = show(rev, 'render/thumbnail.js');

  // A merge-tree result can carry conflict markers. That is a finding, not a parse
  // error — but every hex read out of such a file is both sides at once, so say so.
  const markers = [css, gizmo].some((s) => s && /^<{7} /m.test(s));

  const cssAxes = [...(css ?? '').matchAll(/--axis-[xyz]:\s*(#[0-9a-f]{3,8})\s*;/gi)].map((m) => norm(m[1]));
  const gizmoBlock = (gizmo ?? '').match(/AXIS_COLORS\s*=\s*\{([^}]*)\}/);
  const gizmoAxes = gizmoBlock
    ? [...gizmoBlock[1].matchAll(/'(#[0-9a-f]{3,6})'/gi)].map((m) => norm(m[1]))
    : [];

  const paper = ((css ?? '').match(/--paper:\s*(#[0-9a-f]{3,8})\s*;/i) ?? [])[1];
  const jsLiteral = (src, name) => {
    const m = (src ?? '').match(new RegExp(`${name}\\s*=\\s*(?:0x([0-9a-f]{6})|'(#[0-9a-f]{3,6})')`, 'i'));
    return m ? norm(m[1] ? `#${m[1]}` : m[2]) : null;
  };

  // The hand-expanded rgba() copies of the axis colours, checked only inside rules that
  // also name an axis variable — the rest of the stylesheet's rgba() is shadows.
  const byAxis = Object.fromEntries(
    [...(css ?? '').matchAll(/--axis-([xyz]):\s*(#[0-9a-f]{3,8})\s*;/gi)].map((m) => [m[1], rgbOf(m[2])]),
  );
  let staleRgba = 0;
  let rgbaChecked = 0;
  for (const block of (css ?? '').split('}')) {
    const named = new Set([...block.matchAll(/var\(--axis-([xyz])\)/g)].map((m) => m[1]));
    const literals = [...block.matchAll(/rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,/g)]
      .map((m) => [Number(m[1]), Number(m[2]), Number(m[3])])
      .filter(([r, g, b]) => !(r === 255 && g === 255 && b === 255));
    if (!literals.length || named.size !== 1) continue;
    const want = byAxis[[...named][0]];
    for (const got of literals) {
      rgbaChecked++;
      if (want && got.join() !== want.join()) staleRgba++;
    }
  }

  // Duplicate declarations of one variable: the cascade silently picks one, so "the
  // value" stops being a single thing. A conflicted merge produces exactly this.
  const dupes = ['x', 'y', 'z'].filter(
    (a) => [...(css ?? '').matchAll(new RegExp(`--axis-${a}:`, 'g'))].length > 1,
  );

  const drift = ['x', 'y', 'z']
    .map((a, i) => [a, cssAxes[i], gizmoAxes[i]])
    .filter(([, c, g]) => c && g && c !== g)
    .map(([a, c, g]) => `${a}: css ${c} vs gizmo ${g} — only ${contrast(c, g).toFixed(2)}:1 apart`);

  const thin = paper
    ? ['x', 'y', 'z']
        .map((a, i) => [a, cssAxes[i]])
        .filter(([, c]) => c && contrast(c, paper) < 3)
        .map(([a, c]) => `--axis-${a} ${contrast(c, paper).toFixed(2)}:1 on ${paper}`)
    : [];

  const paperDrift = [];
  const bg = jsLiteral(scene, 'BACKGROUND');
  const thumbBg = ((thumb ?? '').match(/background:\s*'(#[0-9a-f]{3,6})'/i) ?? [])[1];
  if (paper && bg && norm(paper) !== bg) paperDrift.push(`--paper ${norm(paper)} vs scene.js ${bg}`);
  if (paper && thumbBg && norm(paper) !== norm(thumbBg)) {
    paperDrift.push(`--paper ${norm(paper)} vs thumbnail ${norm(thumbBg)}`);
  }

  const red = drift.length > 0 || staleRgba > 0 || thin.length > 0 || dupes.length > 0 || paperDrift.length > 0;
  return { cssAxes, gizmoAxes, paper: paper ? norm(paper) : null, staleRgba, rgbaChecked, dupes, drift, thin, paperDrift, markers, red };
}

// --- the three passes ------------------------------------------------------------------

const branches = git(['for-each-ref', '--format=%(refname:short)', 'refs/heads']).trim().split('\n');
const INTEGRATION_BASE = branches.includes('master') ? 'master' : branches[0];
const feature = branches.filter((b) => b !== INTEGRATION_BASE);

const perBranch = branches.map((b) => ({ branch: b, ...readTree(b) }));

// Pairwise: what each branch would do to the release branch on its own. These merges are
// the decision-relevant ones — a red here is a merge that the guard will stop.
const pairwise = feature.map((b) => {
  const out = git(['merge-tree', '--write-tree', INTEGRATION_BASE, b], { allowFail: true });
  const tree = out?.split('\n')[0]?.trim();
  if (!tree || !/^[0-9a-f]{40}$/.test(tree)) return { branch: b, error: 'merge-tree produced no tree' };
  return { branch: b, tree, ...readTree(tree) };
});

// Sequential: the integration merge itself. Each step has to become a real commit before
// the next merge-tree will accept it as a side — merge-tree takes commits, not trees, and
// feeding it a tree makes `git show <tree>:path` fall through to reading the index.
const sequential = [];
let base = INTEGRATION_BASE;
for (const b of feature) {
  const out = git(['merge-tree', '--write-tree', base, b], { allowFail: true });
  const tree = out?.split('\n')[0]?.trim();
  if (!tree || !/^[0-9a-f]{40}$/.test(tree)) {
    sequential.push({ branch: b, error: 'merge-tree produced no tree' });
    break;
  }
  const conflicted = [
    ...new Set(
      (out.split('\n').slice(1).join('\n').match(/(?:style\.css|render\/gizmo\.js|render\/scene\.js)/g) ?? []),
    ),
  ];
  sequential.push({ branch: b, tree, conflicted, ...readTree(tree) });
  const commit = git(['commit-tree', tree, '-p', base, '-p', b, '-m', `drift-sim merge ${b}`], { allowFail: true });
  if (!commit) break;
  base = commit.trim();
}

// --- report ----------------------------------------------------------------------------

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ base: INTEGRATION_BASE, perBranch, pairwise, sequential }, null, 1));
} else {
  const row = (name, r) =>
    r.error
      ? `  ${name.padEnd(20)} ${r.error}`
      : `  ${name.padEnd(20)} ${(r.red ? 'RED' : 'green').padEnd(6)} css=${label(r.cssAxes).padEnd(17)} ` +
        `gizmo=${label(r.gizmoAxes).padEnd(17)} staleRgba=${r.staleRgba}` +
        `${r.dupes.length ? ` dupes=${r.dupes.join(',')}` : ''}${r.markers ? ' CONFLICT-MARKERS' : ''}`;

  console.log(`\naxis-colour drift across ${branches.length} branches (release base: ${INTEGRATION_BASE})\n`);
  console.log('per branch, as committed:');
  for (const r of perBranch) console.log(row(r.branch, r));

  console.log(`\npairwise — ${INTEGRATION_BASE} + <branch>:`);
  for (const r of pairwise) console.log(row(r.branch, r));

  console.log(`\nsequential — ${INTEGRATION_BASE} <- each branch in turn:`);
  for (const r of sequential) {
    console.log(row(`+ ${r.branch}`, r) + (r.conflicted?.length ? `  [conflict: ${r.conflicted.join(', ')}]` : ''));
  }

  const greenButStale = pairwise.filter((r) => !r.error && !r.red && sameTriad(r.cssAxes, LIGHT));
  if (greenButStale.length) {
    console.log(
      `\nguard-green but carrying the pre-DOO-9 triad (the guard cannot see this):\n` +
        greenButStale.map((r) => `  ${INTEGRATION_BASE} + ${r.branch}`).join('\n'),
    );
    const paper = perBranch.find((r) => r.paper)?.paper;
    if (paper) {
      console.log(`\n  contrast on ${paper}:`);
      for (const [i, a] of ['x', 'y', 'z'].entries()) {
        console.log(
          `    ${a}  LIGHT ${LIGHT[i]} ${contrast(LIGHT[i], paper).toFixed(2)}:1` +
            `   DARK ${DARK[i]} ${contrast(DARK[i], paper).toFixed(2)}:1`,
        );
      }
    }
  }

  const reds = perBranch.filter((r) => r.red);
  console.log(`\n${reds.length} of ${perBranch.length} branches red${reds.length ? `: ${reds.map((r) => r.branch).join(', ')}` : ''}`);
  for (const r of reds) {
    for (const d of [...r.drift, ...r.paperDrift, ...r.thin]) console.log(`  ${r.branch}  ${d}`);
  }
  console.log();
}

process.exitCode = perBranch.some((r) => r.red) ? 1 : 0;
