// ui/hud.js — the game screen's chrome: dims label, status line, undo button, and the
// rotate/paint switch.
//
// Public API — mountHud({ onUndo, onToggleMode }) returns:
//   .setStatus(text) .setDims(text)
//   .setMode(mode, { transient })   reflect the gesture layer's mode

const MODE_LABEL = { rotate: '회전', paint: '칠하기' };
const MODE_ICON = { rotate: '✥', paint: '✎' };

export function mountHud({ onUndo, onToggleMode } = {}) {
  const statusEl = document.getElementById('status');
  const dimsEl = document.getElementById('dims-label');
  const undoBtn = document.getElementById('undo');
  const modeBtn = document.getElementById('btn-mode');
  const modeText = modeBtn?.querySelector('.mode-btn__text');
  const modeIcon = modeBtn?.querySelector('.mode-btn__icon');

  if (onUndo) undoBtn.addEventListener('click', onUndo);
  if (onToggleMode) modeBtn?.addEventListener('click', onToggleMode);

  return {
    setStatus(text) {
      statusEl.textContent = text;
    },
    setDims(text) {
      dimsEl.textContent = text;
    },

    // The button is the display, not the source of truth: ui/gestures.js owns the mode
    // and calls back through here, so the `P` key, hold-Shift and a click all end up
    // rendering the same way.
    setMode(mode, { transient = false } = {}) {
      if (!modeBtn) return;
      modeBtn.setAttribute('aria-pressed', String(mode === 'paint'));
      // Shift-to-paint is a hold, so say so — otherwise the button looks stuck on
      // for as long as the key is down.
      modeBtn.setAttribute(
        'aria-label',
        `${MODE_LABEL[mode]} 모드${transient ? ' (Shift 누르는 동안)' : ''}. 누르면 전환`,
      );
      if (modeText) modeText.textContent = MODE_LABEL[mode];
      if (modeIcon) modeIcon.textContent = MODE_ICON[mode];
    },
  };
}
