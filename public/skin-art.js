'use strict';
// Snake Game: canvas art for the head accessories (hats, glasses, mustaches) and the skin preview.
// Everything is drawn in "head units": the head circle has radius 1, so it scales with the snake.
window.SkinArt = (() => {
  const TAU = Math.PI * 2;

  // top of each hat above the head centre, in head units (used to lift the nickname above it)
  const HAT_H = { none: 0, crown: 1.7, tophat: 1.95, cowboy: 1.7, party: 2.1, wizard: 2.3, beanie: 1.8, propeller: 2.1 };

  function fill(ctx, color) { ctx.fillStyle = color; ctx.fill(); }
  function stroke(ctx, color, w) { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke(); }

  // ---------- Hats (drawn upright, origin = head centre, y < 0 is up) ----------
  const hats = {
    crown(ctx) {
      ctx.beginPath();
      ctx.moveTo(-0.7, -0.75); ctx.lineTo(-0.75, -1.55); ctx.lineTo(-0.38, -1.2); ctx.lineTo(0, -1.7);
      ctx.lineTo(0.38, -1.2); ctx.lineTo(0.75, -1.55); ctx.lineTo(0.7, -0.75); ctx.closePath();
      fill(ctx, '#ffd23f'); ctx.lineJoin = 'round'; stroke(ctx, '#b8860b', 0.08);
      for (const [x, y, c] of [[0, -1.05, '#e63946'], [-0.4, -0.98, '#3a86ff'], [0.4, -0.98, '#3a86ff']]) {
        ctx.beginPath(); ctx.arc(x, y, 0.09, 0, TAU); fill(ctx, c);
      }
    },
    tophat(ctx) {
      ctx.fillStyle = '#1f1f26';
      ctx.fillRect(-1.0, -0.95, 2.0, 0.22);
      ctx.fillRect(-0.6, -1.95, 1.2, 1.05);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(-0.6, -1.2, 1.2, 0.2);
    },
    cowboy(ctx) {
      ctx.beginPath(); ctx.ellipse(0, -0.88, 1.4, 0.32, 0, 0, TAU); fill(ctx, '#9a6a37');
      ctx.beginPath();
      ctx.moveTo(-0.6, -0.9); ctx.quadraticCurveTo(-0.7, -1.8, -0.2, -1.55);
      ctx.quadraticCurveTo(0, -1.35, 0.2, -1.55); ctx.quadraticCurveTo(0.7, -1.8, 0.6, -0.9); ctx.closePath();
      fill(ctx, '#b88049');
      ctx.beginPath(); ctx.moveTo(-0.6, -1.02); ctx.lineTo(0.6, -1.02); ctx.lineCap = 'butt'; stroke(ctx, '#5a3a1a', 0.12);
    },
    party(ctx) {
      ctx.beginPath(); ctx.moveTo(-0.62, -0.8); ctx.lineTo(0, -2.0); ctx.lineTo(0.62, -0.8); ctx.closePath(); fill(ctx, '#ff5db1');
      for (const [x, y] of [[-0.2, -1.15], [0.2, -1.4], [0.02, -0.98], [-0.05, -1.65]]) {
        ctx.beginPath(); ctx.arc(x, y, 0.07, 0, TAU); fill(ctx, '#fff3a3');
      }
      ctx.beginPath(); ctx.arc(0, -2.0, 0.17, 0, TAU); fill(ctx, '#ffe066');
    },
    wizard(ctx) {
      ctx.beginPath(); ctx.ellipse(0, -0.85, 1.15, 0.24, 0, 0, TAU); fill(ctx, '#33298a');
      ctx.beginPath();
      ctx.moveTo(-0.75, -0.85); ctx.quadraticCurveTo(-0.2, -1.6, 0.35, -2.3);
      ctx.quadraticCurveTo(0.45, -1.5, 0.75, -0.85); ctx.closePath(); fill(ctx, '#4a3bb5');
      for (const [x, y, r] of [[0.02, -1.4, 0.09], [0.28, -1.1, 0.07], [-0.2, -1.1, 0.06]]) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); fill(ctx, '#ffe066');
      }
    },
    beanie(ctx, time, color) {
      ctx.beginPath(); ctx.arc(0, -0.7, 0.95, Math.PI, TAU); ctx.closePath(); fill(ctx, color || '#e74c3c');
      ctx.fillStyle = '#f5f5f5'; ctx.fillRect(-0.95, -0.8, 1.9, 0.24);
      if (!color) { ctx.beginPath(); ctx.arc(0, -1.7, 0.22, 0, TAU); fill(ctx, '#f5f5f5'); }
    },
    propeller(ctx, time) {
      hats.beanie(ctx, time, '#3b82f6');
      ctx.beginPath(); ctx.moveTo(0, -1.62); ctx.lineTo(0, -1.8); ctx.lineCap = 'round'; stroke(ctx, '#444', 0.1);
      ctx.save();
      ctx.translate(0, -1.82);
      ctx.beginPath(); ctx.ellipse(0, 0, 0.8 * Math.abs(Math.cos(time / 90)) + 0.05, 0.11, 0, 0, TAU); fill(ctx, '#ffd23f');
      ctx.beginPath(); ctx.arc(0, 0, 0.1, 0, TAU); fill(ctx, '#e63946');
      ctx.restore();
    },
  };

  // ---------- Glasses (heading frame: +x is forward, eyes at x=0.35, y=+-0.5) ----------
  function heart(ctx, cx, cy, s) {
    ctx.save(); ctx.translate(cx, cy); ctx.rotate(Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(0, s * 0.4);
    ctx.bezierCurveTo(-s * 0.95, -s * 0.1, -s * 0.5, -s * 0.8, 0, -s * 0.3);
    ctx.bezierCurveTo(s * 0.5, -s * 0.8, s * 0.95, -s * 0.1, 0, s * 0.4);
    fill(ctx, '#ff2e63'); ctx.lineJoin = 'round'; stroke(ctx, '#9c1038', 0.05);
    ctx.restore();
  }
  function temples(ctx, color) {
    ctx.lineCap = 'round';
    for (const side of [-1, 1]) { ctx.beginPath(); ctx.moveTo(0.0, side * 0.62); ctx.lineTo(-0.7, side * 0.92); stroke(ctx, color, 0.08); }
  }
  const eyewear = {
    round(ctx) {
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(0.35, side * 0.5, 0.5, 0, TAU); fill(ctx, 'rgba(255,255,255,.14)'); stroke(ctx, '#222', 0.1);
      }
      temples(ctx, '#222');
    },
    shades(ctx) {
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.ellipse(0.35, side * 0.5, 0.52, 0.47, 0, 0, TAU); fill(ctx, '#111');
        ctx.beginPath(); ctx.arc(0.5, side * 0.35, 0.1, 0, TAU); fill(ctx, 'rgba(255,255,255,.45)');
      }
      ctx.beginPath(); ctx.moveTo(0.35, -0.08); ctx.lineTo(0.35, 0.08); stroke(ctx, '#111', 0.14);
      temples(ctx, '#111');
    },
    monocle(ctx) {
      ctx.beginPath(); ctx.arc(0.35, 0.5, 0.56, 0, TAU); fill(ctx, 'rgba(190,225,255,.25)'); stroke(ctx, '#d4a017', 0.11);
      ctx.beginPath(); ctx.moveTo(0.1, 1.0); ctx.quadraticCurveTo(-0.4, 1.4, -0.75, 0.95); ctx.lineCap = 'round'; stroke(ctx, '#d4a017', 0.05);
    },
    goggles(ctx) {
      ctx.beginPath(); ctx.arc(0, 0, 1.04, Math.PI * 0.6, Math.PI * 1.4); ctx.lineCap = 'butt'; stroke(ctx, '#a85a14', 0.18);
      for (const side of [-1, 1]) {
        ctx.beginPath(); ctx.arc(0.35, side * 0.5, 0.55, 0, TAU); fill(ctx, 'rgba(110,210,255,.35)'); stroke(ctx, '#e67e22', 0.15);
      }
    },
    heart(ctx) {
      for (const side of [-1, 1]) heart(ctx, 0.35, side * 0.5, 0.62);
      temples(ctx, '#9c1038');
    },
  };

  // ---------- Mustaches (heading frame; drawn on the front of the head) ----------
  const mustaches = {
    classic(ctx) {
      ctx.fillStyle = '#3a2415';
      ctx.beginPath(); ctx.ellipse(-0.38, 0.02, 0.44, 0.17, -0.25, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.ellipse(0.38, 0.02, 0.44, 0.17, 0.25, 0, TAU); ctx.fill();
    },
    handlebar(ctx) {
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const sx of [-1, 1]) {
        ctx.save(); ctx.scale(sx, 1);
        ctx.beginPath(); ctx.moveTo(0, 0);
        ctx.bezierCurveTo(0.3, 0.12, 0.7, 0.05, 0.85, -0.28);
        ctx.bezierCurveTo(0.92, -0.45, 0.76, -0.56, 0.62, -0.46);
        stroke(ctx, '#2b1a0f', 0.15);
        ctx.restore();
      }
    },
    walrus(ctx) {
      ctx.beginPath();
      ctx.moveTo(-0.95, -0.2); ctx.quadraticCurveTo(0, 0.5, 0.95, -0.2);
      ctx.quadraticCurveTo(0.6, -0.5, 0, -0.12); ctx.quadraticCurveTo(-0.6, -0.5, -0.95, -0.2);
      fill(ctx, '#74552f');
    },
    pencil(ctx) {
      ctx.beginPath(); ctx.moveTo(-0.62, 0); ctx.lineTo(0.62, 0); ctx.lineCap = 'round'; stroke(ctx, '#111', 0.08);
    },
    goatee(ctx) {
      mustaches.classic(ctx);
      ctx.beginPath(); ctx.ellipse(0, 0.55, 0.17, 0.3, 0, 0, TAU); fill(ctx, '#3a2415');
    },
  };

  // Draw a head's eyes + accessories. skin may be null (NPC): just the eyes.
  function drawHead(ctx, x, y, r, angle, skin, time) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(r, r);

    ctx.save();
    ctx.rotate(angle);
    for (const side of [-1, 1]) {
      ctx.beginPath(); ctx.arc(0.35, side * 0.5, 0.38, 0, TAU); fill(ctx, '#fff');
      ctx.beginPath(); ctx.arc(0.49, side * 0.5, 0.2, 0, TAU); fill(ctx, '#111');
    }
    if (skin) {
      if (skin.mustache && mustaches[skin.mustache]) {
        // sits across the front of the face, overlapping the eyes a little so it reads from above
        ctx.save(); ctx.translate(0.72, 0); ctx.rotate(-Math.PI / 2); ctx.scale(1.1, 1.6); mustaches[skin.mustache](ctx); ctx.restore();
      }
      if (skin.eyewear && eyewear[skin.eyewear]) eyewear[skin.eyewear](ctx);
    }
    ctx.restore();

    if (skin && skin.hat && hats[skin.hat]) hats[skin.hat](ctx, time || 0);
    ctx.restore();
  }

  // Preview of a whole skin: a short snake facing right. opts.body=false draws just the head (for icons).
  function renderPreview(canvas, skin, time, opts = {}) {
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    ctx.clearRect(0, 0, w, h);
    const c = window.SnakeSim.skinColor(skin.color);
    const r = opts.r || Math.min(w, h) * 0.17;
    const cx = opts.cx !== undefined ? opts.cx : w * 0.66, cy = opts.cy !== undefined ? opts.cy : h * 0.62;
    const n = opts.body === false ? 0 : 16;
    for (let i = n; i >= 1; i--) {
      const x = cx - i * r * 0.72, y = cy + Math.sin(i * 0.45) * r * 0.55 * Math.min(1, i / 8);
      if (c.rim) { ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, TAU); fill(ctx, c.rim); }
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); fill(ctx, (Math.floor(i / 3) & 1) ? c.b : c.a);
    }
    if (c.rim) { ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, TAU); fill(ctx, c.rim); }
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, TAU); fill(ctx, c.a);
    drawHead(ctx, cx, cy, r, 0, skin, time);
  }

  return { HAT_H, drawHead, renderPreview, hatHeight: id => HAT_H[id] || 0 };
})();
