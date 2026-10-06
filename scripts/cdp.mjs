// scripts/cdp.mjs — the bit of Chrome DevTools Protocol plumbing that both
// `verify-browser.mjs` (no-regression gate) and `bench-render.mjs` (perf gate) need.
//
// Deliberately dependency-free: node's built-in WebSocket and fetch are enough, and
// a perf gate that pulls puppeteer would add 150MB to a repo whose whole point is
// that it builds and runs offline.
//
//   const browser = await launchChrome({ gl: 'metal', offline: true });
//   const page = await browser.newPage();
//   await page.goto('http://127.0.0.1:4173/');
//   const v = await page.evaluate('1 + 1');
//   await browser.close();

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
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

function connection(ws) {
  let nextId = 1;
  const pending = new Map();
  const events = [];
  const listeners = new Set();

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) {
      events.push(msg);
      for (const fn of listeners) fn(msg);
    }
  });

  return {
    events,
    onEvent(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    send(method, params = {}, sessionId) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params, sessionId }));
      });
    },
  };
}

/**
 * Start headless Chrome and attach to it.
 *
 * Chrome picks its own debug port (`--remote-debugging-port=0`) and announces it in
 * `DevToolsActivePort` inside the throwaway profile. A fixed port looks simpler right
 * up until a crashed run leaves a browser holding it: the next run then silently
 * attaches to the *old* browser and inherits its localStorage, which shows up as a
 * baffling failure in an unrelated check. Reading the port back makes each run's
 * browser unambiguously its own, and lets two gates run at once.
 *
 * @param {object} opts
 * @param {boolean} [opts.offline]  map every host except 127.0.0.1 to NOTFOUND, so a
 *                                  passing run also proves the app needs no CDN
 * @param {string[]} [opts.gpuFlags] GL flags; defaults to software rasterization,
 *                                  which is reproducible on any machine and CI box
 */
export async function launchChrome({ offline = false, gpuFlags, windowSize = '1280,860' } = {}) {
  const chrome = findChrome();
  if (!chrome) throw new Error(`no Chrome found. Looked in:\n  ${CHROME_CANDIDATES.join('\n  ')}`);

  const profile = join(tmpdir(), `nonogram-cdp-${process.pid}-${Math.floor(process.hrtime()[1] / 1000)}`);
  mkdirSync(profile, { recursive: true });

  const args = [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    `--window-size=${windowSize}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu-sandbox',
    ...(gpuFlags ?? ['--use-gl=angle', '--enable-unsafe-swiftshader']),
    ...(offline ? ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1'] : []),
    'about:blank',
  ];

  const proc = spawn(chrome, args, { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr += d; });
  // A failed check throws out of the gate script before close() runs; without this the
  // browser outlives the run.
  process.on('exit', () => proc.kill());

  const portFile = join(profile, 'DevToolsActivePort');
  let wsUrl = null;
  for (let i = 0; i < 120; i++) {
    try {
      // line 1 is the port, line 2 the browser ws path
      const [port] = readFileSync(portFile, 'utf8').split('\n');
      const res = await fetch(`http://127.0.0.1:${port.trim()}/json/version`);
      wsUrl = (await res.json()).webSocketDebuggerUrl;
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!wsUrl) throw new Error(`Chrome never opened a debug port.\n${stderr}`);

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve);
    ws.addEventListener('error', reject);
  });
  const conn = connection(ws);

  return {
    executable: chrome,
    conn,
    async newPage() {
      const { targetId } = await conn.send('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await conn.send('Target.attachToTarget', { targetId, flatten: true });
      return makePage(conn, sessionId);
    },
    async close() {
      ws.close();
      proc.kill();
      await sleep(500); // Chrome is still flushing its profile dir
      rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
    },
  };
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
      await call('Page.navigate', { url });
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

/** A tiny pass/fail recorder shared by both gates. */
export function checklist() {
  const checks = [];
  return {
    checks,
    check(name, pass, detail = '') {
      checks.push({ name, pass: !!pass, detail });
      console.log(`${pass ? '  ok  ' : ' FAIL '} ${name}${detail ? `  — ${detail}` : ''}`);
      return !!pass;
    },
    report() {
      const failed = checks.filter((c) => !c.pass);
      console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
      return failed;
    },
  };
}
