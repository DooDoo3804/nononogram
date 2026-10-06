// tests/phone-commit.mjs — which build a reading belongs to.
//
// A perf number with no commit attached cannot be re-read later, and this tree keeps
// several branches in flight at once, so "measured on the phone" is not enough: the
// record has to say which bytes the phone ran.

import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

export function gitCommit(cwd = ROOT) {
  try {
    const git = (args) => execFileSync('git', args, { cwd }).toString().trim();
    const sha = git(['rev-parse', '--short', 'HEAD']);
    // Tracked changes only. The artifact is built in a throwaway worktree whose
    // `node_modules` is a symlink, and git counts that symlink as an untracked file —
    // stamping every deploy `+dirty` over a build input would make the flag noise, and
    // a flag that is always on stops being read. What invalidates the stamp is tracked
    // source differing from the commit, which is exactly what this asks.
    const dirty = git(['status', '--porcelain', '--untracked-files=no']);
    return dirty ? `${sha}+dirty` : sha;
  } catch {
    return null;
  }
}
