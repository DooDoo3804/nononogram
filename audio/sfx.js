// audio/sfx.js — the game's sound effects, synthesised in WebAudio.
//
// OWNER: game-design track.
//
// Not a single audio file ships. Every sound here is a few oscillators with a gain
// envelope, which buys three things the team's budget cares about: no request on the
// first-paint path (the 2s budget), no decode cost, and nothing to 404 when the app is
// served from an arbitrary subdirectory (`base: './'`).
//
// Two browser realities shape the API:
//   - An AudioContext created before a user gesture starts `suspended`, so the context
//     is built lazily on the first sound that actually plays and `resume()`d each time.
//   - Muted is the **default** (음소거 기본 존중). A muted sfx bag never constructs a
//     context at all, so a player who never unmutes pays nothing.
//
// Public API — createSfx({ muted, storage }) returns:
//   .play(name)       fire and forget; unknown names are ignored
//   .muted()          -> boolean
//   .setMuted(bool)   -> boolean   (persists through the injected setter)
//   .toggleMuted()    -> boolean
//   .dispose()

const MASTER_GAIN = 0.16;

// Equal-temperament helper so the voices below read as notes, not magic numbers.
const note = (semitonesFromA4) => 440 * 2 ** (semitonesFromA4 / 12);
const A4 = 0;
const C5 = 3;
const E5 = 7;
const G5 = 10;
const C6 = 15;
const E6 = 19;

/**
 * Each voice is a list of partials: { type, freq, at, dur, gain, slideTo }.
 * `at`/`dur` are seconds relative to the trigger.
 */
const VOICES = {
  // placing a block — a short, bright, woody tap
  fill: [{ type: 'triangle', freq: note(C5), at: 0, dur: 0.07, gain: 1, slideTo: note(E5) }],
  // the player's "definitely empty" mark — duller, lower, clearly not a fill
  mark: [{ type: 'sine', freq: note(A4 - 12), at: 0, dur: 0.06, gain: 0.8 }],
  // back to blank
  erase: [{ type: 'sine', freq: note(A4 - 17), at: 0, dur: 0.05, gain: 0.55 }],
  // a wrong fill left standing: a small falling two-tone, not a buzzer
  mistake: [
    { type: 'sawtooth', freq: note(A4 - 5), at: 0, dur: 0.09, gain: 0.35 },
    { type: 'sawtooth', freq: note(A4 - 12), at: 0.08, dur: 0.14, gain: 0.3 },
  ],
  // hint stage 1: a questioning rise
  hint: [{ type: 'triangle', freq: note(E5), at: 0, dur: 0.12, gain: 0.5, slideTo: note(G5) }],
  // hint stage 2: the same rise, resolved — you got an answer
  reveal: [
    { type: 'triangle', freq: note(G5), at: 0, dur: 0.08, gain: 0.5 },
    { type: 'triangle', freq: note(C6), at: 0.07, dur: 0.16, gain: 0.45 },
  ],
  // the clear: a major arpeggio that lands on the octave
  clear: [
    { type: 'triangle', freq: note(C5), at: 0, dur: 0.18, gain: 0.8 },
    { type: 'triangle', freq: note(E5), at: 0.1, dur: 0.18, gain: 0.8 },
    { type: 'triangle', freq: note(G5), at: 0.2, dur: 0.2, gain: 0.8 },
    { type: 'triangle', freq: note(C6), at: 0.32, dur: 0.5, gain: 0.9 },
    { type: 'sine', freq: note(E6), at: 0.32, dur: 0.5, gain: 0.35 },
  ],
  // a level opened up
  unlock: [
    { type: 'sine', freq: note(C5), at: 0, dur: 0.3, gain: 0.6 },
    { type: 'sine', freq: note(G5), at: 0.06, dur: 0.34, gain: 0.5 },
  ],
  // generic UI blip for the clear card's buttons
  tap: [{ type: 'sine', freq: note(E5), at: 0, dur: 0.04, gain: 0.4 }],
};

export const SFX_NAMES = Object.freeze(Object.keys(VOICES));

export function createSfx({ muted = true, onMutedChange = null, AudioCtx = null } = {}) {
  let isMuted = !!muted;
  let ctx = null;
  let master = null;

  const Ctor =
    AudioCtx ?? globalThis.AudioContext ?? globalThis.webkitAudioContext ?? null;

  function ensureContext() {
    if (!Ctor) return null;
    if (!ctx) {
      try {
        ctx = new Ctor();
        master = ctx.createGain();
        master.gain.value = MASTER_GAIN;
        master.connect(ctx.destination);
      } catch {
        ctx = null; // no audio in this context — stay silent rather than throw
        return null;
      }
    }
    // Autoplay policy parks the context until a gesture; this is the cheap retry.
    if (ctx.state === 'suspended') ctx.resume?.().catch(() => {});
    return ctx;
  }

  function playPartial(audio, p, t0) {
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = p.type;
    osc.frequency.setValueAtTime(p.freq, t0 + p.at);
    if (p.slideTo) osc.frequency.linearRampToValueAtTime(p.slideTo, t0 + p.at + p.dur);

    // A 4ms attack is enough to kill the click an instantaneous gain step makes.
    const peak = p.gain ?? 1;
    gain.gain.setValueAtTime(0, t0 + p.at);
    gain.gain.linearRampToValueAtTime(peak, t0 + p.at + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + p.at + p.dur);

    osc.connect(gain).connect(master);
    osc.start(t0 + p.at);
    osc.stop(t0 + p.at + p.dur + 0.02);
  }

  return {
    play(name) {
      if (isMuted) return false;
      const voice = VOICES[name];
      if (!voice) return false;
      const audio = ensureContext();
      if (!audio) return false;
      try {
        const t0 = audio.currentTime + 0.005;
        for (const p of voice) playPartial(audio, p, t0);
        return true;
      } catch {
        return false;
      }
    },

    muted: () => isMuted,

    setMuted(next) {
      const value = !!next;
      if (value === isMuted) return isMuted;
      isMuted = value;
      onMutedChange?.(isMuted);
      return isMuted;
    },

    toggleMuted() {
      return this.setMuted(!isMuted);
    },

    dispose() {
      try {
        ctx?.close?.();
      } catch {
        // already closed
      }
      ctx = null;
      master = null;
    },
  };
}
