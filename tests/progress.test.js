// tests/progress.test.js — the save format is a compatibility contract with
// browsers that already have progress stored, so it is pinned here explicitly.

import { describe, it, expect, beforeEach } from 'vitest';
import { loadProgress, saveProgress, setStorage } from '../state/progress.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
  };
}

describe('progress persistence', () => {
  let store;

  beforeEach(() => {
    store = memoryStorage();
    setStorage(store);
  });

  it('round-trips a board and its solved flag', () => {
    saveProgress('l1-1', new Uint8Array([0, 1, 2, 1]), true);
    expect(loadProgress('l1-1')).toEqual({ state: [0, 1, 2, 1], solved: true });
  });

  it('keys storage as no-nonogram:<puzzleId>', () => {
    saveProgress('l1-7', new Uint8Array([1]), false);
    expect([...store.map.keys()]).toEqual(['no-nonogram:l1-7']);
    expect(store.map.get('no-nonogram:l1-7')).toBe('{"state":[1],"solved":false}');
  });

  it('returns null for a puzzle that was never played', () => {
    expect(loadProgress('never-played')).toBeNull();
  });

  it('returns null instead of throwing on corrupt JSON', () => {
    store.map.set('no-nonogram:l1-1', '{not json');
    expect(loadProgress('l1-1')).toBeNull();
  });

  it('degrades to no-op when storage is unavailable', () => {
    setStorage(null);
    expect(() => saveProgress('l1-1', new Uint8Array([1]), false)).not.toThrow();
    expect(loadProgress('l1-1')).toBeNull();
  });

  it('survives a storage that throws on write (quota / private mode)', () => {
    setStorage({
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    });
    expect(() => saveProgress('l1-1', new Uint8Array([1]), false)).not.toThrow();
  });
});
