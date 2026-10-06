// ui/screens.js — screen switching. Every top-level view in index.html carries
// `.screen`; exactly one is visible at a time.
//
// Public API — mountScreens() returns { show(id), current() }

export function mountScreens() {
  const screens = [...document.querySelectorAll('.screen')];
  let current = screens.find((el) => !el.hidden)?.id ?? null;

  return {
    show(id) {
      for (const el of screens) el.hidden = el.id !== id;
      current = id;
    },
    current: () => current,
  };
}
