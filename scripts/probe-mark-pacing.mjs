// scripts/probe-mark-pacing.mjs — falsification rail for DOO-41.
//
// Two claims about the "first playable board" number in `verify-browser.mjs`, each of
// which is only worth anything if it can be shown false:
//
//   1. the raw `first-puzzle` mark tracks the *harness's* pacing roughly 1:1, so it is
//      not a product measurement at all. Falsified if adding a sleep before the click
//      leaves the mark where it was.
//   2. the stamped delta (`mark - openedAt`) does not move when the harness paces
//      differently, but does move when the product's work gets more expensive.
//      Falsified if the delta tracks the sleep, or if it ignores CPU throttling.
//
//   node scripts/probe-mark-pacing.mjs [baseUrl]
//
// Prints a table and exits non-zero if either claim fails to hold.

import { setTimeout as sleep } from 'node:timers/promises';
import { launchChrome, checklist } from './cdp.mjs';

const BASE = process.argv[2] ?? 'http://127.0.0.1:4173';
const { check, report } = checklist();

/**
 * One cold load -> first playable board, with `padMs` of harness pacing injected.
 *
 * A browser per run, not a tab per run: `makePage` has no close, and a leftover tab keeps
 * its rAF loop alive, which is exactly the kind of background cost this probe is trying
 * to read differences of a few ms against.
 */
async function run({ padMs = 0, cpu = 1 }) {
  const browser = await launchChrome({ offline: true });
  const page = await browser.newPage();
  try {
    if (cpu > 1) await page.call('Emulation.setCPUThrottlingRate', { rate: cpu });
    await page.goto(`${BASE}/?perf=1`);
    // Stand-in for the sleeps and round-trips the real gate spends on its way to the
    // click. Only the harness is slower here; the app is untouched.
    if (padMs) await sleep(padMs);
    const openedAt = await page.evaluate(`(() => {
      const t0 = performance.now();
      document.getElementById('btn-start').click();
      document.querySelectorAll('#levels-grid .level-card')[0].click();
      document.querySelectorAll('#puzzles-grid .puzzle-card')[0].click();
      return t0;
    })()`);
    await sleep(400);
    const p = await page.evaluate(`(() => {
      const s = window.__nonogram.perf();
      return { firstFrameMs: s.firstFrameMs, rawMarkMs: s.marks['first-puzzle'] };
    })()`);
    return { padMs, cpu, openedAt, ...p, openMs: p.rawMarkMs - openedAt };
  } finally {
    await browser.close();
  }
}

const PAD_MS = 1500;
const CPU = 20;

const base = await run({});
const padded = await run({ padMs: PAD_MS });
const throttled = await run({ cpu: CPU });

for (const r of [base, padded, throttled]) {
  console.log(
    `  pad ${String(r.padMs).padStart(4)}ms  cpu/${String(r.cpu).padStart(2)}  ` +
      `raw ${r.rawMarkMs.toFixed(0).padStart(5)}ms  openedAt ${r.openedAt.toFixed(0).padStart(5)}ms  ` +
      `openMs ${r.openMs.toFixed(1).padStart(6)}ms  firstFrame ${r.firstFrameMs.toFixed(0)}ms`,
  );
}
console.log();

// Claim 1. The pad is pure harness, so a product measurement would not see it. The raw
// mark sees essentially all of it — hence it is measuring the harness.
const rawDelta = padded.rawMarkMs - base.rawMarkMs;
check(
  'the raw mark absorbs the harness pacing it should be blind to',
  rawDelta > PAD_MS * 0.8,
  `+${PAD_MS}ms of harness sleep moved the raw mark by +${rawDelta.toFixed(0)}ms (${((rawDelta / PAD_MS) * 100).toFixed(0)}% of it)`,
);

// Claim 2a. The stamped delta must not absorb the pad. Not asserted as "unchanged":
// waiting 1.5s longer lets the tab settle, and a settled tab opens its first board tens
// of ms *cheaper* than a cold one. So the delta does move — a few percent of the pad, and
// measured in the opposite direction from absorbing it. The number that separates this
// from the raw mark is the share, which is why both checks are written as one.
const openDelta = padded.openMs - base.openMs;
const openShare = Math.abs(openDelta) / PAD_MS;
check(
  'the stamped delta does not absorb the harness pacing',
  openShare < 0.1,
  `openMs ${base.openMs.toFixed(1)}ms -> ${padded.openMs.toFixed(1)}ms under +${PAD_MS}ms of harness sleep ` +
    `(Δ${openDelta > 0 ? '+' : ''}${openDelta.toFixed(1)}ms = ${(openShare * 100).toFixed(0)}% of the pad, ` +
    `vs ${((rawDelta / PAD_MS) * 100).toFixed(0)}% for the raw mark)`,
);

// Claim 2b. A product that got slower has to show up, or the replacement is just a
// smaller number and not a measurement. CPU throttling is the cheapest honest regression.
check(
  `the stamped delta still tracks the product getting slower (cpu/${CPU})`,
  throttled.openMs > base.openMs * 2,
  `openMs ${base.openMs.toFixed(1)}ms -> ${throttled.openMs.toFixed(1)}ms at cpu/${CPU} ` +
    `(${(throttled.openMs / base.openMs).toFixed(1)}x)`,
);

process.exit(report().length ? 1 : 0);
