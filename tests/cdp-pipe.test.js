// tests/cdp-pipe.test.js — the CDP pipe transport's framing and failure paths (DOO-37).
//
// `launchChrome` is proven by the gates that drive a real browser. This file covers the
// part no gate can see failing: a framing bug does not throw, it hands a caller the
// wrong bytes. So the transport is driven over a pair of fake pipes with the chunk
// boundaries placed exactly where they hurt.

import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  pipeConnection,
  assertNodeSupport,
  MIN_NODE,
  shouldWatchParent,
  profileRemoval,
} from '../scripts/cdp.mjs';

/** A stand-in for the Chrome child process: fd 3 we write, fd 4 it writes. */
function fakeChrome() {
  const proc = new EventEmitter();
  const toChrome = new PassThrough();
  const fromChrome = new PassThrough();
  proc.stdio = [null, null, null, toChrome, fromChrome];
  const conn = pipeConnection(proc);
  return {
    conn,
    proc,
    /** What the transport wrote, as parsed CDP messages. */
    async sent() {
      const chunks = [];
      for (const part of toChrome.read()?.toString('utf8').split('\0') ?? []) {
        if (part) chunks.push(JSON.parse(part));
      }
      return chunks;
    },
    /** Feed bytes back as Chrome would, in exactly these chunks. */
    reply(...chunks) {
      for (const c of chunks) fromChrome.write(Buffer.from(c));
    },
  };
}

const frame = (obj) => `${JSON.stringify(obj)}\0`;

describe('CDP pipe framing', () => {
  it('writes NUL-terminated JSON and resolves the matching id', async () => {
    const chrome = fakeChrome();
    const pending = chrome.conn.send('Browser.getVersion');
    expect(await chrome.sent()).toEqual([
      { id: 1, method: 'Browser.getVersion', params: {} },
    ]);
    chrome.reply(frame({ id: 1, result: { product: 'Chrome/154' } }));
    expect(await pending).toEqual({ product: 'Chrome/154' });
  });

  it('reassembles one message split across chunks', async () => {
    const chrome = fakeChrome();
    const pending = chrome.conn.send('Page.captureScreenshot');
    const whole = frame({ id: 1, result: { data: 'AAAABBBBCCCC' } });
    // the split a megabyte screenshot always hits
    chrome.reply(whole.slice(0, 11), whole.slice(11, 24), whole.slice(24));
    expect(await pending).toEqual({ data: 'AAAABBBBCCCC' });
  });

  it('delivers two messages that share one chunk', async () => {
    const chrome = fakeChrome();
    const first = chrome.conn.send('Runtime.evaluate');
    const second = chrome.conn.send('Runtime.evaluate');
    chrome.reply(frame({ id: 1, result: { value: 1 } }) + frame({ id: 2, result: { value: 2 } }));
    expect([await first, await second]).toEqual([{ value: 1 }, { value: 2 }]);
  });

  it('keeps a multi-byte character intact across a chunk boundary', async () => {
    const chrome = fakeChrome();
    const pending = chrome.conn.send('Runtime.evaluate');
    // '깃발' is 3 bytes per character in UTF-8. Decoding per chunk instead of per
    // message would hand the caller U+FFFD here, and every shape name in this app is
    // Korean.
    const bytes = Buffer.from(frame({ id: 1, result: { value: '깃발' } }), 'utf8');
    const mid = bytes.indexOf(Buffer.from('깃', 'utf8')) + 1; // mid-character
    chrome.reply(bytes.subarray(0, mid), bytes.subarray(mid));
    expect(await pending).toEqual({ value: '깃발' });
  });

  it('routes events to listeners and records them, without touching pending calls', async () => {
    const chrome = fakeChrome();
    const seen = [];
    chrome.conn.onEvent((msg) => seen.push(msg.method));
    const pending = chrome.conn.send('Runtime.evaluate');
    chrome.reply(
      frame({ method: 'Log.entryAdded', params: { entry: { level: 'error' } } }) +
        frame({ id: 1, result: { value: 7 } }),
    );
    expect(await pending).toEqual({ value: 7 });
    expect(seen).toEqual(['Log.entryAdded']);
    expect(chrome.conn.events.map((e) => e.method)).toEqual(['Log.entryAdded']);
  });

  it('rejects a call that comes back as a CDP error', async () => {
    const chrome = fakeChrome();
    const pending = chrome.conn.send('Nope.nope');
    chrome.reply(frame({ id: 1, error: { code: -32601, message: 'not found' } }));
    await expect(pending).rejects.toThrow(/not found/);
  });
});

describe('CDP pipe failure paths', () => {
  // A gate that hangs gets killed by hand, and DOO-37 is the story of what those kills
  // left running. So the browser going away has to surface as a rejection, not a wait.
  it('fails the outstanding calls when Chrome closes the pipe', async () => {
    const chrome = fakeChrome();
    const pending = chrome.conn.send('Runtime.evaluate');
    chrome.proc.stdio[4].end();
    await expect(pending).rejects.toThrow(/closed the CDP pipe/);
  });

  it('fails outstanding calls when Chrome exits', async () => {
    const chrome = fakeChrome();
    const pending = chrome.conn.send('Runtime.evaluate');
    chrome.proc.emit('exit', 1, null);
    await expect(pending).rejects.toThrow(/Chrome exited/);
  });

  it('reports a spawn failure instead of waiting out the launch timeout', async () => {
    const chrome = fakeChrome();
    chrome.proc.emit('error', new Error('ENOENT'));
    await expect(chrome.conn.send('Browser.getVersion')).rejects.toThrow(/failed to start/);
  });

  it('refuses a transport with no pipe fds', () => {
    const proc = new EventEmitter();
    proc.stdio = [null, null, null];
    expect(() => pipeConnection(proc)).toThrow(/without its CDP pipe fds/);
  });
});

describe('node version floor', () => {
  // The transport no longer needs node 22's global WebSocket, so this is the toolchain's
  // floor, not the harness's. It is checked so a mismatch names itself at the door
  // instead of 150 lines deep (DOO-37).
  it('accepts the versions this repo is run on', () => {
    for (const v of [MIN_NODE, '18.19.1', '20.11.0', '22.22.0', '24.21.0']) {
      expect(() => assertNodeSupport(v)).not.toThrow();
    }
  });

  it('rejects anything older, and says which node it is', () => {
    for (const v of ['18.17.1', '16.20.2', '14.0.0']) {
      expect(() => assertNodeSupport(v)).toThrow(new RegExp(`node ${v} is too old`));
    }
    expect(() => assertNodeSupport('16.20.2')).toThrow(new RegExp(process.execPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });
});

describe('parent-death watchdog arming', () => {
  // The watchdog exits a live process, so when it arms matters as much as that it works.
  // The firing path needs real reparenting and is proven by the signal matrix in DOO-37,
  // not here; this covers the guard that decides whether to arm at all.
  it('arms under an ordinary launcher', () => {
    expect(shouldWatchParent(4321, {})).toBe(true);
  });

  it('stays disarmed when ppid is already 1 — init-parented is not distinguishable from orphaned', () => {
    expect(shouldWatchParent(1, {})).toBe(false);
    expect(shouldWatchParent(0, {})).toBe(false);
  });

  it('honours the opt-out, for a run meant to outlive its shell', () => {
    expect(shouldWatchParent(4321, { NONOGRAM_CDP_NO_PARENT_WATCH: '1' })).toBe(false);
    // Only the exact opt-in value counts — a stray empty or "0" must not disarm it.
    expect(shouldWatchParent(4321, { NONOGRAM_CDP_NO_PARENT_WATCH: '0' })).toBe(true);
    expect(shouldWatchParent(4321, { NONOGRAM_CDP_NO_PARENT_WATCH: '' })).toBe(true);
  });
});

describe('profile removal', () => {
  // The measured regression, locked down: rmSync's retries are a blocking sleep, so on
  // the paths that run while the process is dying they held an orphaned harness node
  // alive for 17.2s — and still left the dir behind. Nothing may wait for a dir there;
  // `sweepStaleProfiles` takes what is left at the next launch.
  it('never blocks on the paths that run while the process is dying', () => {
    const opts = profileRemoval({ patient: false });
    expect(opts.maxRetries).toBeUndefined();
    expect(opts.retryDelay).toBeUndefined();
    expect(opts.recursive).toBe(true);
  });

  it('retries only for close(), where a caller is awaiting it', () => {
    expect(profileRemoval({ patient: true }).maxRetries).toBe(10);
  });
});
