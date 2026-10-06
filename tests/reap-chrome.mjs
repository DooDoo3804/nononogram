// Kill headless Chromes this repo's harness left behind.
//
// Why this exists (DOO-8 report §17): three consecutive QA runs measured a machine at
// load 270-400 on 8 cores and each blamed "the machine". The load was ours. Eight
// orphaned headless Chromes were running, aged 52 minutes to 15 hours 29 minutes, each
// with a GPU and a renderer helper at 9-13% CPU. Clearing them took load 270 -> 13 and
// made the `reach` sweep 1.6x faster (8.3 -> 13.2 steps/min).
//
// `launchChrome` in `scripts/cdp.mjs` already does:
//
//     process.on('exit', () => proc.kill());
//
// and that covers the normal path and `process.exit(1)` after a failed check. It does
// *not* cover signal death: `exit` listeners do not run when the node process takes
// SIGTERM/SIGINT/SIGHUP, and nothing can run on SIGKILL. So a harness run that is killed
// -- by a heartbeat ending, by scratch teardown, or by a QA run clearing what it thought
// were stuck sweeps -- leaves Chrome alive and reparented to launchd. §16.5 did exactly
// that: it killed the `playtest` parents and inherited their browsers.
//
// Fixing the source belongs to the platform track (`scripts/cdp.mjs` is shared by its own
// verify/bench scripts, 13 call sites) -> DOO-37. This script is the QA-side sweeper so
// the next run does not start at load 300. Run it before any measurement.
//
//     node tests/reap-chrome.mjs          # report only
//     node tests/reap-chrome.mjs --kill    # actually kill
//
// Identification is deliberately narrow. A Chrome is ours-and-dead only if BOTH hold:
//
//   1. its `--user-data-dir` is a `nonogram-cdp-<pid>-<n>` profile, which is the naming
//      `launchChrome` uses and nothing else does; and
//   2. the `<pid>` embedded in that path -- the node process that launched it -- is gone,
//      or the Chrome has been reparented to init (ppid 1).
//
// A live sweep's Chrome fails both: its launcher is alive and it is still that
// launcher's child. That is the property this script leans on, and `--kill` was
// validated against a live sweep to confirm it is left alone.

import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const KILL = process.argv.includes('--kill');

/** Every process whose command line mentions a nonogram CDP profile. */
function harnessChromes() {
  let out = '';
  try {
    out = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,etime=,command='], { encoding: 'utf8', maxBuffer: 1 << 26 });
  } catch {
    return [];
  }
  const rows = [];
  for (const line of out.split('\n')) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/);
    if (!m) continue;
    const [, pid, ppid, etime, command] = m;
    // Only the top-level browser process carries --headless=new *and* the profile flag;
    // its helpers (GPU, renderer, utility) inherit --user-data-dir but are typed with
    // --type=. Killing the parent takes the helpers with it, so skip them here.
    if (!command.includes('--headless=new')) continue;
    if (/--type=/.test(command)) continue;
    const prof = command.match(/--user-data-dir=(\S*nonogram-cdp-(\d+)-\d+)/);
    if (!prof) continue;
    rows.push({ pid: Number(pid), ppid: Number(ppid), etime, profile: prof[1], launcher: Number(prof[2]) });
  }
  return rows;
}

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM means it exists but is not ours to signal -- still alive.
    return e.code === 'EPERM';
  }
}

/** Seconds from `ps` etime, which is [[dd-]hh:]mm:ss. */
function etimeSeconds(etime) {
  const [days, rest] = etime.includes('-') ? etime.split('-') : [0, etime];
  const parts = rest.split(':').map(Number);
  while (parts.length < 3) parts.unshift(0);
  return Number(days) * 86400 + parts[0] * 3600 + parts[1] * 60 + parts[2];
}

const found = harnessChromes();
const orphans = found.filter((c) => c.ppid === 1 || !alive(c.launcher));
const live = found.filter((c) => !orphans.includes(c));

console.log(`harness Chromes: ${found.length}  (live ${live.length}, orphaned ${orphans.length})`);
for (const c of live) {
  console.log(`  live    pid=${c.pid} ppid=${c.ppid} age=${c.etime} launcher=${c.launcher} (alive)`);
}
for (const c of orphans) {
  const why = c.ppid === 1 ? 'reparented to init' : `launcher ${c.launcher} gone`;
  console.log(`  orphan  pid=${c.pid} ppid=${c.ppid} age=${c.etime} -- ${why}`);
}

if (!orphans.length) {
  console.log('nothing to reap.');
  process.exit(0);
}

const oldest = Math.max(...orphans.map((c) => etimeSeconds(c.etime)));
console.log(`oldest orphan: ${(oldest / 3600).toFixed(1)}h`);

if (!KILL) {
  console.log('report only -- pass --kill to terminate the orphans above.');
  process.exit(0);
}

for (const c of orphans) {
  try {
    process.kill(c.pid, 'SIGTERM');
    console.log(`  TERM ${c.pid}`);
  } catch (e) {
    console.log(`  TERM ${c.pid} failed: ${e.code}`);
  }
}

await new Promise((r) => setTimeout(r, 3000));
const stubborn = orphans.filter((c) => alive(c.pid));
for (const c of stubborn) {
  try {
    process.kill(c.pid, 'SIGKILL');
    console.log(`  KILL ${c.pid} (ignored SIGTERM)`);
  } catch { /* already gone */ }
}

const remaining = harnessChromes().filter((c) => c.ppid === 1 || !alive(c.launcher));
console.log(`reaped ${orphans.length - remaining.length}/${orphans.length}; ${remaining.length} remain`);

// `close()` removes the profile dir; a killed run never got there. Only the dirs of the
// Chromes just reaped are touched -- the path comes from that process's own command line,
// so a live sweep's profile is never a candidate.
let freed = 0;
for (const c of orphans) {
  if (alive(c.pid)) continue;
  try {
    freed += Number(execFileSync('du', ['-sk', c.profile], { encoding: 'utf8' }).split(/\s+/)[0]) || 0;
    rmSync(c.profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch { /* already gone, or not ours to remove */ }
}
if (freed) console.log(`removed ${(freed / 1024).toFixed(1)}MB of abandoned profile dirs`);

process.exit(remaining.length ? 1 : 0);
