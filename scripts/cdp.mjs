// scripts/cdp.mjs — the bit of Chrome DevTools Protocol plumbing that both
// `verify-browser.mjs` (no-regression gate) and `bench-render.mjs` (perf gate) need.
//
// Deliberately dependency-free: Chrome will speak CDP down a plain pipe, so
// `child_process` is the whole transport, and a perf gate that pulls puppeteer would add
// 150MB to a repo whose whole point is that it builds and runs offline.
//
//   const browser = await launchChrome({ gl: 'auto', offline: true });
//   const page = await browser.newPage();
//   await page.goto('http://127.0.0.1:4173/');
//   const v = await page.evaluate('1 + 1');
//   console.log(await page.glRenderer());   // never infer the backend from the flags
//   await browser.close();

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function findChrome() {
  return process.env.CHROME_PATH ?? CHROME_CANDIDATES.find((path) => existsSync(path)) ?? null;
}

/**
 * The oldest node this repo's toolchain accepts: eslint 9 wants >=18.18, vite 6 and
 * vitest 3 want >=18. The harness itself is plain pipes and files, so it is not the
 * binding constraint.
 *
 * Checked explicitly because the failure this replaces lied about its cause (DOO-37).
 * The transport used to be the global `WebSocket`, which node only ships by default
 * from 22, so a gate run under an nvm default of 18 died with
 * `ReferenceError: WebSocket is not defined` 150 lines into a file nobody suspected —
 * while the same command in the next shell worked, because that shell's PATH found a
 * different node. A version mismatch should name itself, and name which node it is.
 */
export const MIN_NODE = '18.18.0';

export function assertNodeSupport(found = process.versions.node) {
  const parse = (v) => v.split('.').map(Number);
  const [fMajor, fMinor, fPatch] = parse(found);
  const [rMajor, rMinor, rPatch] = parse(MIN_NODE);
  const ok =
    fMajor > rMajor ||
    (fMajor === rMajor && (fMinor > rMinor || (fMinor === rMinor && fPatch >= rPatch)));
  if (!ok) {
    throw new Error(
      `node ${found} is too old for this harness — needs >= ${MIN_NODE}.\n` +
        `  running: ${process.execPath}\n` +
        '  PATH order is usually the culprit; `nvm use 22` or call a newer node directly.',
    );
  }
}

/**
 * Every browser this process launched and has not closed, and the one set of handlers
 * that tears them down. The registry is module-level rather than per-launch because
 * `gpu-bench.mjs` opens a browser per GL backend in a loop, and N launches must not mean
 * N signal handlers each re-raising the signal N times.
 */
const liveBrowsers = new Set();
const DEATH_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
let teardownInstalled = false;

/** How often the parent-death watchdog reads `process.ppid`. */
export const PARENT_WATCH_MS = 1000;

/**
 * Four layers, because no one of them covers every way a run can end (DOO-37).
 *
 * 1. `--remote-debugging-pipe` (in `launchChrome`). Chrome quits when the CDP pipe
 *    reaches EOF, and the kernel closes that pipe however this process dies — including
 *    `kill -9`, which no handler can intercept. This is the only layer that covers a
 *    SIGKILL, and SIGKILL is what the heartbeat/scratch teardown sends. Before it, eight
 *    orphaned browsers aged up to 15h29m held this machine at load 270 while three QA
 *    runs in a row recorded that as "the machine is slow" (DOO-8 §17).
 * 2. Signal handlers. `exit` listeners do not run on SIGTERM/SIGINT/SIGHUP, and EOF
 *    alone leaves the throwaway profile dir behind, so these kill the browser, remove
 *    the profile, and re-raise so the process still dies *of* the signal it was sent.
 * 3. The `exit` listener. Covers the ordinary paths: a throw out of a gate script, and
 *    `process.exit(1)` after a failed check.
 * 4. The parent-death watchdog. Layers 1-3 all assume the signal arrives *here*. The run
 *    that stranded DOO-8 never sent one: Paperclip killed the run, the driver shell
 *    outlived it (`errorCode=orphaned_running_run`), and the harness node under it kept
 *    sweeping — so the pipe stayed open and the browser was correctly kept alive, for a
 *    measurement nobody was reading. Confirmed live on this machine while fixing it:
 *    `91308 ppid=1 zsh qa-out/doo8/rerun-v.sh` driving a 24-minute `playtest.mjs`.
 */
function installTeardown() {
  if (teardownInstalled) return;
  teardownInstalled = true;

  process.on('exit', () => {
    for (const browser of [...liveBrowsers]) browser.tearDown();
  });

  for (const signal of DEATH_SIGNALS) {
    const onSignal = () => {
      for (const browser of [...liveBrowsers]) browser.tearDown();
      // Re-raise with our listener gone so node takes the default action and the exit
      // status is still 128+n. Only ours is removed: a caller with its own handler for
      // this signal keeps it, and keeps deciding what the signal means.
      process.removeListener(signal, onSignal);
      process.kill(process.pid, signal);
    };
    process.on(signal, onSignal);
  }

  installParentWatch();
}

/**
 * Exit when whoever started this harness is gone.
 *
 * `process.ppid` is read live, not cached at startup, so reparenting is visible here:
 * when the parent dies the kernel hands the orphan to init and the value becomes 1
 * (verified by measurement, not by the docs). A change is therefore the one signal
 * available for "my launcher died without telling me", and an orphaned measurement has
 * no consumer by definition — nothing downstream is left to read what it produces.
 *
 * Deliberately narrow, because this exits a live process:
 *   - only a *change* counts. A harness whose ppid is already 1 (launchd, a detached
 *     supervisor) is indistinguishable from an orphan, so it is never armed.
 *   - the timer is `unref`'d, so it cannot by itself keep a finished gate alive.
 *   - `NONOGRAM_CDP_NO_PARENT_WATCH=1` opts out, for a run meant to outlive its shell.
 *
 * The exit is `process.exit`, which runs the layer-3 listener above, which closes the
 * browsers and makes one unblocking attempt at their profiles — the dir is never worth
 * delaying this exit for, and the first version of it delayed the exit by 17.2s. See
 * `removeProfile`. 143 = 128+SIGTERM: not killed by a signal, but the same meaning, and
 * distinguishable from a gate's own failure codes.
 */
export function shouldWatchParent(launcher, env = process.env) {
  if (env.NONOGRAM_CDP_NO_PARENT_WATCH === '1') return false;
  return Number.isInteger(launcher) && launcher > 1;
}

function installParentWatch() {
  const launcher = process.ppid;
  if (!shouldWatchParent(launcher)) return;

  const timer = setInterval(() => {
    if (process.ppid === launcher) return;
    clearInterval(timer);
    process.stderr.write(
      `cdp: launcher pid ${launcher} is gone (ppid is now ${process.ppid}) — ` +
        `closing ${liveBrowsers.size} browser(s) and exiting. Nothing is reading this run.\n`,
    );
    process.exit(143);
  }, PARENT_WATCH_MS);
  timer.unref();
}

/**
 * GL backend selection, and why the names matter (DOO-20).
 *
 * `auto` was documented for months as "software rasterization, reproducible on any
 * machine". It is not. `--enable-unsafe-swiftshader` only *permits* a software
 * fallback — Chrome still prefers the real GPU, and on this machine `auto` is
 * byte-for-byte indistinguishable from passing no GL flags at all:
 *
 *   auto / --use-angle=metal / no flags  -> ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro)
 *   software                             -> ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...))
 *
 * So `auto` means "whatever this box has", which is the right default for a
 * regression gate (it measures the machine you are on) and the wrong thing to quote
 * as a cross-machine floor. The flag is still worth keeping: on a GPU-less CI box
 * Chrome refuses WebGL outright without it, so it buys the fallback, not the floor.
 *
 * Never describe a run's backend from its flags. Read `page.glRenderer()`.
 */
export const GL_FLAGS = {
  // Use ANGLE, and allow the software fallback if there is no usable GPU.
  auto: ['--use-gl=angle', '--enable-unsafe-swiftshader'],
  // Force SwiftShader. Reproducible everywhere and slower at fill than any phone GPU.
  software: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};

/**
 * CDP over the pipe Chrome opens under `--remote-debugging-pipe`: it reads fd 3 and
 * writes fd 4, one JSON message per NUL byte. Same `{ events, onEvent, send }` shape as
 * the WebSocket transport it replaces, so no call site changes.
 *
 * Framing is the whole job. A `Page.captureScreenshot` reply is megabytes of base64
 * spread over many chunks, while a short `Runtime.evaluate` reply can share one chunk
 * with the event behind it — so scan every chunk for terminators and carry the
 * remainder, instead of assuming chunks and messages line up. Decoding is deferred
 * until a whole message is in hand for the same reason: this app answers in Korean, and
 * a chunk boundary inside a 3-byte character would otherwise corrupt the shape name.
 *
 * Exported for `tests/cdp-pipe.test.js`, which drives it over a pair of fake pipes —
 * the failure modes here are silent, so they get a test rather than a gate.
 */
export function pipeConnection(proc) {
  const toChrome = proc.stdio[3];
  const fromChrome = proc.stdio[4];
  if (!toChrome || !fromChrome) throw new Error('Chrome was spawned without its CDP pipe fds');

  let nextId = 1;
  const pending = new Map();
  const events = [];
  const listeners = new Set();
  let dead = null;

  /**
   * Once the browser is gone, fail the outstanding calls instead of hanging on them.
   * A gate that hangs gets killed by hand, and DOO-37 is the story of what those kills
   * left running.
   */
  const die = (reason) => {
    if (dead) return;
    dead = new Error(reason);
    for (const { reject } of pending.values()) reject(dead);
    pending.clear();
  };

  let partial = [];
  fromChrome.on('data', (chunk) => {
    let start = 0;
    for (let end = chunk.indexOf(0, start); end !== -1; end = chunk.indexOf(0, start)) {
      partial.push(chunk.subarray(start, end));
      const msg = JSON.parse(Buffer.concat(partial).toString('utf8'));
      partial = [];
      start = end + 1;
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        events.push(msg);
        for (const fn of listeners) fn(msg);
      }
    }
    if (start < chunk.length) partial.push(chunk.subarray(start));
  });

  fromChrome.on('close', () => die('Chrome closed the CDP pipe'));
  toChrome.on('error', (err) => die(`CDP pipe write failed: ${err.message}`));
  proc.on('error', (err) => die(`Chrome failed to start: ${err.message}`));
  proc.on('exit', (code, signal) => die(`Chrome exited (code ${code}, signal ${signal})`));

  return {
    events,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send(method, params = {}, sessionId) {
      if (dead) return Promise.reject(dead);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        toChrome.write(`${JSON.stringify({ id, method, params, sessionId })}\0`, (err) => {
          if (!err) return;
          pending.delete(id);
          reject(err);
        });
      });
    },
    /** Closing our end is also how Chrome is told to quit: it exits on pipe EOF. */
    end() {
      toChrome.end();
    },
  };
}

/**
 * Remove profile dirs left by launchers that are gone.
 *
 * SIGKILL is the one death with no cleanup — no handler runs, so the ~2.8MB throwaway
 * profile stays in TMPDIR. Nothing else will collect it: `tests/reap-chrome.mjs` finds
 * dirs by way of the *process* holding them, and on this path there is no process. So
 * each launch picks up after the last one.
 *
 * The launcher pid in the dir name is the whole test, and it is deliberately
 * conservative: a dir is only removed if that pid is gone, so a concurrent run's profile
 * is never a candidate. A recycled pid means a stale dir survives a round, which costs
 * nothing.
 */
/**
 * `rmSync` options for removing a profile dir. `patient` was first written backwards.
 *
 * The retries do block — that part was right — but blocking is exactly wrong on the
 * death paths, because what waits on them is the process's own exit. Measured: the
 * orphan watchdog fired in under a second and killed the browser, then the `exit`
 * listener sat in rmSync's backoff and the harness node stayed alive for **17.2s** in 2
 * of 3 runs — and the dir was still there afterwards, 53 files of it. The full
 * 300ms × (1+2+…+10) budget, spent to fail. So an orphaned run went on existing for 17
 * seconds after it had already decided to stop, which is the leak this file exists to
 * close.
 *
 * Patience belongs only to `close()`, where a caller is awaiting a promise and nothing
 * is trying to die. Everywhere else: one pass, keep what it got, leave the rest.
 * `sweepStaleProfiles` collects the remainder at the next launch — the same contract
 * SIGKILL has always had, and it costs ~2.8MB in TMPDIR for one round.
 */
export function profileRemoval({ patient }) {
  const base = { recursive: true, force: true };
  return patient ? { ...base, maxRetries: 10, retryDelay: 300 } : base;
}

function sweepStaleProfiles() {
  let entries = [];
  try {
    entries = readdirSync(tmpdir());
  } catch {
    return;
  }
  for (const name of entries) {
    const pid = /^nonogram-cdp-(\d+)-\d+$/.exec(name)?.[1];
    if (!pid || Number(pid) === process.pid) continue;
    try {
      process.kill(Number(pid), 0);
      continue; // launcher still running — its browser is alive and this is not ours
    } catch (err) {
      if (err.code === 'EPERM') continue; // exists, just not ours to signal
    }
    try {
      rmSync(join(tmpdir(), name), { recursive: true, force: true });
    } catch { /* someone else got there first */ }
  }
}

/**
 * Start headless Chrome and attach to it.
 *
 * The connection is a pipe, not a port. A fixed port looks simpler right up until a
 * crashed run leaves a browser holding it: the next run then silently attaches to the
 * *old* browser and inherits its localStorage, which surfaces as a baffling failure in
 * an unrelated check. `--remote-debugging-port=0` plus the `DevToolsActivePort` file
 * fixed that by making each run's browser unambiguously its own;
 * `--remote-debugging-pipe` goes further and is why this function changed:
 *
 *   - there is no port, so two gates can never collide and nothing has to be polled —
 *     the browser is up exactly when it answers on the pipe;
 *   - the pipe is a lifeline. Chrome exits when it reaches EOF, which the kernel
 *     guarantees when this process dies, `kill -9` included. See `installTeardown`.
 *
 * @param {object} opts
 * @param {boolean} [opts.offline]  map every host except 127.0.0.1 to NOTFOUND, so a
 *                                  passing run also proves the app needs no CDN
 * @param {keyof GL_FLAGS} [opts.gl] which backend to ask for — 'auto' (default, the
 *                                  machine's own GPU) or 'software' (forced
 *                                  SwiftShader). See GL_FLAGS; the request is not a
 *                                  guarantee, so confirm with `page.glRenderer()`.
 * @param {string[]} [opts.gpuFlags] raw GL flags, overriding `gl`
 */
export async function launchChrome({ offline = false, gl = 'auto', gpuFlags, windowSize = '1280,860' } = {}) {
  assertNodeSupport();
  const chrome = findChrome();
  if (!chrome) throw new Error(`no Chrome found. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);
  if (!gpuFlags && !GL_FLAGS[gl]) throw new Error(`unknown gl: ${gl}. Expected ${Object.keys(GL_FLAGS).join(' | ')}`);

  sweepStaleProfiles();

  // The `nonogram-cdp-<launcher pid>-<n>` shape is load-bearing: `tests/reap-chrome.mjs`
  // uses it, and the pid inside it, to tell a browser of ours whose launcher is gone
  // from one that is still working, and `sweepStaleProfiles` reads the same pid. Do not
  // rename it without fixing both.
  const profile = join(tmpdir(), `nonogram-cdp-${process.pid}-${Math.floor(process.hrtime()[1] / 1000)}`);
  mkdirSync(profile, { recursive: true });

  const args = [
    '--headless=new',
    '--remote-debugging-pipe',
    `--user-data-dir=${profile}`,
    `--window-size=${windowSize}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu-sandbox',
    ...(gpuFlags ?? GL_FLAGS[gl]),
    ...(offline ? ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] : []),
    'about:blank',
  ];

  // fds 3 and 4 are the CDP pipe. stdout is noise; stderr is kept for the one message
  // worth having when a launch fails.
  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  const conn = pipeConnection(proc);

  let down = false;
  /** Synchronous and idempotent — the signal path has no event loop left to await on. */
  const shutDown = (signal) => {
    if (down) return false;
    down = true;
    liveBrowsers.delete(browser);
    try { conn.end(); } catch { /* pipe already gone */ }
    try { proc.kill(signal); } catch { /* already dead */ }
    return true;
  };
  const removeProfile = ({ patient }) => {
    try {
      rmSync(profile, profileRemoval({ patient }));
    } catch { /* a profile dir left in TMPDIR is the reaper's problem, not a run's */ }
  };

  const browser = {
    executable: chrome,
    profile,
    pid: proc.pid,
    conn,
    async newPage() {
      const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
      return makePage(conn, sessionId);
    },
    async close() {
      shutDown('SIGTERM');
      await sleep(500); // let Chrome finish flushing, then take the whole dir with it
      removeProfile({ patient: true });
    },
    /**
     * The teardown the exit and signal handlers call. Never await this.
     *
     * SIGKILL rather than SIGTERM, which is not impatience: a Chrome shutting down
     * gracefully rewrites its profile *after* the removal, and on this path there is no
     * 500ms to wait it out. Measured on node 18 — 234 files, removed, 51 of them back.
     * So the browser loses the ability to write instead of being raced for it.
     *
     * And it does not wait for the dir to actually go: see `removeProfile`. Dying fast
     * is this path's whole job; the dir is the next launch's problem.
     */
    tearDown() {
      if (shutDown('SIGKILL')) removeProfile({ patient: false });
    },
  };

  liveBrowsers.add(browser);
  installTeardown();

  // No port file to poll: the browser is up exactly when it answers. The race also
  // covers the Chrome that starts and then dies — `conn` rejects on pipe close, so a
  // bad launch reports itself instead of waiting out the timeout.
  await Promise.race([
    conn.send('Browser.getVersion'),
    sleep(30_000, null, { ref: false }).then(() => {
      throw new Error(`Chrome never answered on the CDP pipe.\n${stderr}`);
    }),
  ]).catch((err) => {
    browser.tearDown();
    throw err;
  });

  return browser;
}

function makePage(conn, sessionId) {
  const call = (method, params) => conn.send(method, params, sessionId);
  const ready = (async () => {
    await call('Page.enable');
    await call('Runtime.enable');
    await call('Log.enable');
    await call('Network.enable');
  })();

  const page = {
    sessionId,
    call,
    events: conn.events,

    async evaluate(expression) {
      await ready;
      const res = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (res.exceptionDetails) {
        const d = res.exceptionDetails;
        throw new Error(`page threw: ${d.exception?.description ?? d.text}`);
      }
      return res.result.value;
    },

    async goto(url, { settleMs = 600 } = {}) {
      await ready;
      const { errorText } = await call('Page.navigate', { url });
      // A navigation that never landed must say so here. Chrome serves its own error
      // document instead, and that document answers `document.readyState === 'complete'`
      // like any other, so the poll below is satisfied and the failure surfaces several
      // calls later as whatever the caller touches first — for a dead server, three runs
      // of `SecurityError: Failed to read the 'localStorage' property`, because an error
      // page is an opaque origin. No call site navigates somewhere it expects to fail.
      if (errorText) throw new Error(`navigation to ${url} failed: ${errorText}`);
      for (let i = 0; i < 100; i++) {
        const state = await page.evaluate('document.readyState').catch(() => null);
        if (state === 'complete') break;
        await sleep(100);
      }
      // let the module graph boot and a few frames render
      await sleep(settleMs);
    },

    /** Poll a boolean expression until it is true. Throws on timeout. */
    async waitFor(expression, { timeoutMs = 60_000, everyMs = 250 } = {}) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await page.evaluate(expression).catch(() => false)) return true;
        await sleep(everyMs);
      }
      throw new Error(`timed out after ${timeoutMs}ms waiting for: ${expression}`);
    },

    async screenshot() {
      await ready;
      const { data } = await call('Page.captureScreenshot', { format: 'png' });
      return Buffer.from(data, 'base64');
    },

    /**
     * The GL backend this page actually got, e.g.
     *   "ANGLE (Apple, ANGLE Metal Renderer: Apple M1 Pro, Unspecified Version)"
     *   "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device ...), SwiftShader driver)"
     *
     * Any run that quotes a timing number should record this next to it. Launch flags
     * are a request; this is the answer, and DOO-20 happened because the two were
     * assumed to be the same thing. Uses a throwaway canvas so it is safe to call on
     * a page that is mid-measurement.
     */
    async glRenderer() {
      return page.evaluate(`(() => {
        const gl = document.createElement('canvas').getContext('webgl2')
          ?? document.createElement('canvas').getContext('webgl');
        const info = gl && gl.getExtension('WEBGL_debug_renderer_info');
        return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unknown';
      })()`);
    },

    /** Emulate a device: viewport, pixel ratio, touch, and a CPU slowdown factor. */
    async emulate({ width, height, deviceScaleFactor = 1, mobile = false, cpuThrottle = 1 }) {
      await ready;
      await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor, mobile });
      await call('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
    },

    /** Console errors and uncaught exceptions seen so far, newest last. */
    errors() {
      return conn.events
        .filter(
          (e) =>
            e.method === 'Runtime.exceptionThrown' ||
            (e.method === 'Log.entryAdded' && e.params.entry.level === 'error'),
        )
        .map((e) =>
          e.method === 'Runtime.exceptionThrown'
            ? (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text)
            : `${e.params.entry.url ?? ''} ${e.params.entry.text}`,
        );
    },

    /** Every URL the page requested that did not come from `base`. */
    externalRequests(base) {
      return conn.events
        .filter((e) => e.method === 'Network.requestWillBeSent')
        .map((e) => e.params.request.url)
        .filter((u) => !u.startsWith(base) && !u.startsWith('data:') && !u.startsWith('blob:'));
    },
  };

  return page;
}

/**
 * A tiny pass/fail recorder shared by both gates.
 *
 * `advisory` exists for checks whose *input* can be invalid — a frame time read off a
 * machine that is running six other jobs says nothing about the code. Such a check
 * still prints and still lands in the JSON, but it does not set the exit code, so the
 * gate keeps red-lighting only things a commit can cause. A gate that red-lights half
 * its runs gets ignored, which costs more than the check was worth.
 */
export function checklist() {
  const checks = [];
  return {
    checks,
    check(name, pass, detail = '', { advisory = false } = {}) {
      checks.push({ name, pass: !!pass, advisory, detail });
      console.log(
        `${pass ? '  ok  ' : advisory ? ' warn ' : ' FAIL '} ${name}${detail ? `  — ${detail}` : ''}`,
      );
      return !!pass;
    },
    report() {
      const failed = checks.filter((c) => !c.pass && !c.advisory);
      const warned = checks.filter((c) => !c.pass && c.advisory);
      const passed = checks.filter((c) => c.pass).length;
      console.log(
        `\n${passed}/${checks.length} checks passed` +
          (warned.length ? `, ${warned.length} advisory (not gating)` : ''),
      );
      return failed;
    },
  };
}
