// ui/hud.js — the game screen's chrome: dims label, status line, undo button.
//
// Public API — mountHud({ onUndo }) returns { setStatus(text), setDims(text) }

export function mountHud({ onUndo } = {}) {
  const statusEl = document.getElementById('status');
  const dimsEl = document.getElementById('dims-label');
  const undoBtn = document.getElementById('undo');

  if (onUndo) undoBtn.addEventListener('click', onUndo);

  return {
    setStatus(text) {
      statusEl.textContent = text;
    },
    setDims(text) {
      dimsEl.textContent = text;
    },
  };
}
