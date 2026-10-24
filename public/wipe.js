'use strict';
// Screen transition: a circle grows out of the clicked button until it covers the screen,
// the action runs underneath (start the game, open Customize...), then the cover fades away.
window.SnakeWipe = (() => {
  const el = document.getElementById('wipe');
  const GROW_MS = 480, FADE_MS = 320, MAX_WAIT_MS = 8000;
  let busy = false;

  // fromEl: the button that was clicked. action(): may return a promise (e.g. waiting for the
  // server); the cover stays until it settles.
  function run(fromEl, color, action) {
    if (busy) return;
    busy = true;
    const b = fromEl.getBoundingClientRect();
    const x = b.left + b.width / 2, y = b.top + b.height / 2;
    const r = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y)) + 10;

    el.style.transition = 'none';
    el.style.background = color;
    el.style.opacity = '1';
    el.style.clipPath = `circle(0px at ${x}px ${y}px)`;
    el.getBoundingClientRect(); // commit the starting frame before animating
    el.style.transition = `clip-path ${GROW_MS}ms cubic-bezier(.5,0,.75,.4)`;
    el.style.clipPath = `circle(${r}px at ${x}px ${y}px)`;

    const covered = new Promise(res => setTimeout(res, GROW_MS));
    covered.then(() => {
      let ready;
      try { ready = Promise.resolve(action()); } catch (e) { ready = Promise.resolve(); }
      const timeout = new Promise(res => setTimeout(res, MAX_WAIT_MS));
      return Promise.race([ready, timeout]);
    }).catch(() => {}).then(() => {
      el.style.transition = `opacity ${FADE_MS}ms ease-out`;
      el.style.opacity = '0';
      setTimeout(() => { el.style.clipPath = 'circle(0px at 50% 50%)'; busy = false; }, FADE_MS + 30);
    });
  }

  return { run };
})();
