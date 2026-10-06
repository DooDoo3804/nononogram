// tests/sfx.test.js — the sound bag, against a fake AudioContext.
//
// The behaviour worth pinning is the *mute contract*: muted is the default, and a muted
// bag must never construct an AudioContext at all. A player who never unmutes should
// pay nothing — no context, no autoplay-policy warning in the console, no decode.

import { describe, it, expect, vi } from 'vitest';
import { SFX_NAMES, createSfx } from '../audio/sfx.js';

/** The slice of the WebAudio API createSfx actually uses. */
function fakeAudioContext() {
  const made = { oscillators: 0, gains: 0, resumes: 0 };
  const param = () => ({
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });

  class Ctx {
    static instances = 0;
    constructor() {
      Ctx.instances++;
      this.state = 'running';
      this.currentTime = 0;
      this.destination = { kind: 'destination' };
      this.made = made;
    }
    createOscillator() {
      made.oscillators++;
      return {
        type: '',
        frequency: param(),
        connect: vi.fn(function () {
          return this;
        }),
        start: vi.fn(),
        stop: vi.fn(),
      };
    }
    createGain() {
      made.gains++;
      const node = { gain: { value: 0, ...param() }, connect: vi.fn(() => node) };
      return node;
    }
    resume() {
      made.resumes++;
      return Promise.resolve();
    }
    close() {}
  }
  return { Ctx, made };
}

describe('sfx', () => {
  it('defaults to muted', () => {
    expect(createSfx().muted()).toBe(true);
  });

  it('builds no AudioContext at all while muted', () => {
    const { Ctx } = fakeAudioContext();
    const sfx = createSfx({ muted: true, AudioCtx: Ctx });

    for (const name of SFX_NAMES) expect(sfx.play(name)).toBe(false);
    expect(Ctx.instances).toBe(0);
  });

  it('plays every named voice once unmuted', () => {
    const { Ctx, made } = fakeAudioContext();
    const sfx = createSfx({ muted: false, AudioCtx: Ctx });

    for (const name of SFX_NAMES) expect(sfx.play(name), name).toBe(true);
    expect(Ctx.instances).toBe(1); // lazily built once, then reused
    expect(made.oscillators).toBeGreaterThanOrEqual(SFX_NAMES.length);
  });

  it('ignores a name that is not a voice', () => {
    const { Ctx } = fakeAudioContext();
    const sfx = createSfx({ muted: false, AudioCtx: Ctx });
    expect(sfx.play('nope')).toBe(false);
  });

  it('reports a mute change exactly once per transition', () => {
    const changes = [];
    const sfx = createSfx({ muted: true, onMutedChange: (m) => changes.push(m) });

    sfx.setMuted(true); // no change
    expect(sfx.toggleMuted()).toBe(false);
    sfx.setMuted(false); // no change
    expect(sfx.toggleMuted()).toBe(true);

    expect(changes).toEqual([false, true]);
  });

  it('resumes a suspended context rather than giving up on it', () => {
    const { Ctx, made } = fakeAudioContext();
    class Suspended extends Ctx {
      constructor() {
        super();
        this.state = 'suspended';
      }
    }
    const sfx = createSfx({ muted: false, AudioCtx: Suspended });
    sfx.play('fill');
    expect(made.resumes).toBeGreaterThan(0);
  });

  it('stays silent instead of throwing when there is no audio API', () => {
    const sfx = createSfx({ muted: false, AudioCtx: null });
    // No globalThis.AudioContext in the node test environment either.
    expect(() => sfx.play('clear')).not.toThrow();
    expect(sfx.play('clear')).toBe(false);
  });

  it('survives a constructor that throws (audio blocked by policy)', () => {
    class Broken {
      constructor() {
        throw new Error('NotAllowedError');
      }
    }
    const sfx = createSfx({ muted: false, AudioCtx: Broken });
    expect(() => sfx.play('clear')).not.toThrow();
    expect(sfx.play('clear')).toBe(false);
  });
});
