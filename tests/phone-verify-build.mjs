// tests/phone-verify-build.mjs — add the phone measurement page to a built artifact.
//
//   npm run build && node tests/phone-verify-build.mjs
//
// Writes `dist/verify/` — the same page the LAN harness serves, minus the laptop. The
// board approved a public deploy (DOO-12) precisely so the measurement stops depending
// on a phone being on the same Wi-Fi as this machine: with this in the artifact, one URL
// on any phone produces the full record and a copy button that pastes it into the issue.
//
// It writes only into `dist/` (a build output, gitignored) and reads only from `tests/`,
// so it adds a page to the deploy without touching production source or the Vite config
// — those belong to the platform track.
//
// Flags:
//   --prune-maps   delete *.js.map from the artifact. The build emits sourcemaps, which
//                  embed the full original source; a public host does not need them to
//                  run the bench, and this keeps the deploy to the compiled game.

import { readFile, writeFile, mkdir, readdir, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { phonePageHtml } from './phone-page.mjs';
import { gitCommit } from './phone-commit.mjs';

const ROOT = resolve(import.meta.dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(DIST, 'verify');
const pruneMaps = process.argv.includes('--prune-maps');

if (!existsSync(join(DIST, 'bench', 'index.html'))) {
  console.error('dist/bench/index.html is missing — run `npm run build` first.');
  process.exit(1);
}

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

await mkdir(OUT, { recursive: true });

const sha = gitCommit(ROOT);
const builtAt = new Date().toISOString();

// Served from dist/verify/, so the bench page is one level up. The game's own build is
// `base: './'`, which is what lets the whole artifact sit under a Pages subpath.
const config = {
  benchPath: '../bench/',
  reportPath: null, // no server on this route — the page judges and offers a copy button
  commit: sha,
  builtAt,
};

await writeFile(join(OUT, 'index.html'), phonePageHtml({ config, runnerSrc: './phone-runner.js' }));

// `.mjs` → `.js` on the way out. Static hosts are inconsistent about the content type
// they serve `.mjs` with, and a module that arrives as the wrong MIME is a blank screen
// — on the one route where nobody is standing next to a console to see why.
const verdict = await readFile(join(import.meta.dirname, 'phone-verdict.mjs'), 'utf8');
await writeFile(join(OUT, 'phone-verdict.js'), verdict);

const runner = await readFile(join(import.meta.dirname, 'phone-runner.js'), 'utf8');
const rewritten = runner.replace("from './phone-verdict.mjs'", "from './phone-verdict.js'");
if (rewritten === runner) {
  console.error('phone-runner.js no longer imports ./phone-verdict.mjs — fix the rewrite in this script.');
  process.exit(1);
}
await writeFile(join(OUT, 'phone-runner.js'), rewritten);

let pruned = 0;
if (pruneMaps) {
  for (const file of await walk(DIST)) {
    if (file.endsWith('.map')) {
      await rm(file);
      pruned++;
    }
  }
  // The `//# sourceMappingURL=` comments would now 404. Harmless to the run, but they
  // land in the phone's console as errors — in the one place a tester is told to look.
  for (const file of await walk(DIST)) {
    if (!file.endsWith('.js')) continue;
    const body = await readFile(file, 'utf8');
    const stripped = body.replace(/\n?\/\/# sourceMappingURL=.*$/gm, '');
    if (stripped !== body) await writeFile(file, stripped);
  }
}

const files = await walk(DIST);
let bytes = 0;
for (const f of files) bytes += (await stat(f)).size;

console.log(`\n  dist/verify/ written — commit ${sha ?? 'unknown'}, built ${builtAt}`);
if (pruned) console.log(`  pruned ${pruned} sourcemap(s) and their trailing comments`);
console.log(`  artifact: ${files.length} files, ${(bytes / 1024).toFixed(0)}kB\n`);
console.log('  measurement page:  <deploy>/verify/');
console.log('  bench panel only:  <deploy>/bench/?suite=3x3x3,4x4x4,5x5x5,6x6x6&sec=4');
console.log('  game + overlay:    <deploy>/?perf=1\n');
for (const f of files.filter((f) => relative(DIST, f).startsWith('verify'))) {
  console.log(`    ${relative(DIST, f)}`);
}
console.log('');
