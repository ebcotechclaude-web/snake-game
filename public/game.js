'use strict';
// Snake Game client. Local mode runs the shared simulation in the browser (works offline);
// online mode renders snapshots streamed from the server.
(() => {
  const Sim = window.SnakeSim;
  const { WORLD_R, MIN_MASS, TAU, normAngle } = Sim;
  const TICK = 1 / 60;
  const NPC_COUNT = 22;
  const INTERP_DELAY = 100; // ms behind the newest snapshot, for smooth online movement

  const IS_TOUCH = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
  if (IS_TOUCH) document.body.classList.add('touch');

  // ---------- State ----------
  let mode = 'local';          // 'local' | 'online'
  let playing = false;
  let world = null;            // local mode only
  let localPlayer = null;
  let lastView = null;         // last frame's view (kept on screen after death)
  let camera = { x: 0, y: 0, zoom: 1 };

  // online
  let ws = null, myId = null, joined = false, snapBuf = [], onlineDead = false;

  // ---------- Input ----------
  const input = { mouseAngle: null, mouseDown: false, space: false, left: false, right: false };
  // Touch: a floating joystick (first finger on the left half) steers; any other finger held
  // for a moment (long press) boosts.
  const JOY_R = 60, JOY_DEAD = 12, LONG_PRESS_MS = 200;
  const touch = { joyId: null, baseX: 0, baseY: 0, knobX: 0, knobY: 0, angle: null, holds: new Map() };
  const touchBoosting = () => {
    const now = performance.now();
    for (const t0 of touch.holds.values()) if (now - t0 >= LONG_PRESS_MS) return true;
    return false;
  };

  // The steering target is sticky: it only changes while the player is actively steering.
  // Letting go of the joystick / keys / mouse keeps the snake heading where it was last directed
  // (it never snaps back to a stale mouse position or to "right").
  let steer = null;
  let lastTouchAt = -1e9;
  const KEY_TURN_RATE = 3;   // rad/s the target swings while an arrow key is held
  const KEY_MAX_LEAD = 0.8;  // target never gets further than this ahead of the snake's heading

  function computeInput(currentAngle, dt) {
    if (steer === null) steer = currentAngle;
    if (input.left !== input.right) {
      steer += (input.left ? -1 : 1) * KEY_TURN_RATE * dt;
      const lead = normAngle(steer - currentAngle);
      if (Math.abs(lead) > KEY_MAX_LEAD) steer = currentAngle + Math.sign(lead) * KEY_MAX_LEAD;
    } else if (touch.joyId !== null) {
      if (touch.angle !== null) steer = touch.angle;   // inside the dead zone: keep the last target
    } else if (input.mouseAngle !== null) {
      steer = input.mouseAngle;
    }
    return { a: steer, b: input.mouseDown || input.space || touchBoosting() };
  }

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  function resize() {
    dpr = window.devicePixelRatio || 1;
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.floor(W * dpr); canvas.height = Math.floor(H * dpr);
  }
  window.addEventListener('resize', resize);
  resize();

  // Touch screens also fire emulated mouse events; ignore those so they can't hijack the steering.
  const fromTouch = () => performance.now() - lastTouchAt < 1000;
  window.addEventListener('mousemove', e => {
    if (fromTouch()) return;
    input.mouseAngle = Math.atan2(e.clientY - H / 2, e.clientX - W / 2);
  });
  window.addEventListener('mousedown', e => { if (e.button === 0 && e.target === canvas && !fromTouch()) input.mouseDown = true; });
  window.addEventListener('mouseup', e => { if (e.button === 0) input.mouseDown = false; });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
  window.addEventListener('keydown', e => {
    if (!playing || e.target.tagName === 'INPUT') return;
    if (e.code === 'Space') { input.space = true; e.preventDefault(); }
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') { input.left = true; e.preventDefault(); }
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { input.right = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', e => {
    if (e.code === 'Space') input.space = false;
    if (e.code === 'ArrowLeft' || e.code === 'KeyA') input.left = false;
    if (e.code === 'ArrowRight' || e.code === 'KeyD') input.right = false;
  });
  function clearTouch() { touch.joyId = null; touch.angle = null; touch.holds.clear(); }
  window.addEventListener('blur', () => { input.mouseDown = input.space = input.left = input.right = false; clearTouch(); });

  canvas.addEventListener('touchstart', e => {
    e.preventDefault();
    lastTouchAt = performance.now();
    input.mouseAngle = null;
    input.mouseDown = false;
    for (const t of e.changedTouches) {
      if (touch.joyId === null && t.clientX < W / 2) {
        touch.joyId = t.identifier;
        touch.baseX = touch.knobX = t.clientX; touch.baseY = touch.knobY = t.clientY;
        touch.angle = null;
      } else {
        touch.holds.set(t.identifier, performance.now());
      }
    }
  }, { passive: false });
  canvas.addEventListener('touchmove', e => {
    e.preventDefault();
    for (const t of e.changedTouches) {
      if (t.identifier !== touch.joyId) continue;
      let dx = t.clientX - touch.baseX, dy = t.clientY - touch.baseY;
      const d = Math.hypot(dx, dy);
      if (d > JOY_R) { dx *= JOY_R / d; dy *= JOY_R / d; }
      touch.knobX = touch.baseX + dx; touch.knobY = touch.baseY + dy;
      touch.angle = d > JOY_DEAD ? Math.atan2(dy, dx) : null;
    }
  }, { passive: false });
  const touchEnd = e => {
    e.preventDefault();
    lastTouchAt = performance.now();
    for (const t of e.changedTouches) {
      if (t.identifier === touch.joyId) { touch.joyId = null; touch.angle = null; }
      touch.holds.delete(t.identifier);
    }
  };
  canvas.addEventListener('touchend', touchEnd, { passive: false });
  canvas.addEventListener('touchcancel', touchEnd, { passive: false });

  // ---------- Views (what the renderer draws) ----------
  function decorate(s) {
    const c = Sim.skinColor(s.color);
    s.colorA = c.a; s.colorB = c.b; s.rim = c.rim || null; s.hue = c.hue;
    s.r = Sim.radiusFor(s.mass);
    return s;
  }

  function buildLocalView() {
    const alive = world.snakes;
    for (const s of alive) decorate(s);
    decorate(localPlayer);
    const ranked = alive.slice().sort((a, b) => b.mass - a.mass);
    return {
      snakes: alive,
      food: world.food,
      me: localPlayer,
      lb: ranked.slice(0, 10).map(s => ({ name: s.name, mass: Math.floor(s.mass), isPlayer: s.isPlayer, isMe: s === localPlayer })),
      rank: localPlayer.alive ? ranked.indexOf(localPlayer) + 1 : 0,
      total: ranked.length,
      mm: alive.filter(s => s !== localPlayer).map(s => [s.segs[0].x, s.segs[0].y]),
    };
  }

  function lerpSnake(sa, sb, t) {
    const segs = [];
    const na = sa.s.length / 2, nb = sb.s.length / 2;
    for (let i = 0; i < nb; i++) {
      const ia = Math.min(i, na - 1);
      const bx = sb.s[i * 2], by = sb.s[i * 2 + 1];
      segs.push({ x: sa.s[ia * 2] + (bx - sa.s[ia * 2]) * t, y: sa.s[ia * 2 + 1] + (by - sa.s[ia * 2 + 1]) * t });
    }
    return {
      id: sb.i, name: sb.n, isPlayer: !!sb.p, color: sb.c, boosting: !!sb.b,
      skin: sb.k ? { hat: sb.k[0], eyewear: sb.k[1], mustache: sb.k[2] } : null,
      mass: sa.m + (sb.m - sa.m) * t, angle: sa.a + normAngle(sb.a - sa.a) * t, segs,
    };
  }
  function plainSnake(sb) { return lerpSnake(sb, sb, 0); }

  function buildOnlineView(now) {
    if (!snapBuf.length) return null;
    const rt = now - INTERP_DELAY;
    let i = snapBuf.length - 1;
    while (i > 0 && snapBuf[i].rt > rt) i--;
    while (i > 1) { snapBuf.shift(); i--; }
    const a = snapBuf[i], b = snapBuf[i + 1] || a;
    const t = b === a ? 0 : Math.min(1, Math.max(0, (rt - a.rt) / (b.rt - a.rt)));

    const aMap = new Map();
    for (const s of a.snakes) aMap.set(s.i, s);
    const snakes = [];
    let me = null;
    for (const sb of b.snakes) {
      const sa = aMap.get(sb.i);
      const s = decorate(sa ? lerpSnake(sa, sb, t) : plainSnake(sb));
      snakes.push(s);
      if (sb.i === myId) me = s;
    }
    const food = [];
    for (let k = 0; k < b.food.length; k += 4) food.push({ x: b.food[k], y: b.food[k + 1], value: b.food[k + 2], hue: b.food[k + 3] });
    const mm = [];
    for (let k = 0; k < b.mm.length; k += 2) mm.push([b.mm[k], b.mm[k + 1]]);
    if (!me) return lastView && lastView.me ? { ...lastView, snakes, food } : null;
    return {
      snakes, food, me, mm, rank: b.rank, total: b.total,
      lb: b.lb.map(r => ({ name: r[0], mass: r[1], isPlayer: !!r[2], isMe: r[3] === myId })),
    };
  }

  // ---------- Rendering ----------
  function draw(time) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2a0b12';
    ctx.fillRect(0, 0, W, H);

    let view = null;
    if (playing) {
      view = mode === 'local' ? (localPlayer ? buildLocalView() : null) : buildOnlineView(time);
    }
    if (!view) view = lastView;
    if (!view) return;
    lastView = view;

    const me = view.me;
    const head = me.segs[0];
    camera.x = head.x; camera.y = head.y;
    // zoom out a little on small screens (phones) so portrait mode still shows enough of the arena
    const screenScale = Math.min(1, Math.max(0.6, Math.min(W, H) / 720));
    const targetZoom = screenScale * Math.max(0.5, 1 / (1 + (me.mass - MIN_MASS) * 0.0012));
    camera.zoom += (targetZoom - camera.zoom) * 0.05;
    const z = camera.zoom;
    const vw = W / z / 2 + 60, vh = H / z / 2 + 60;
    view.vw = vw; view.vh = vh;
    const inView = (x, y, pad) => Math.abs(x - camera.x) < vw + pad && Math.abs(y - camera.y) < vh + pad;

    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.scale(z, z);
    ctx.translate(-camera.x, -camera.y);

    // arena
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_R, 0, TAU);
    ctx.fillStyle = '#12122a';
    ctx.fill();
    ctx.save();
    ctx.clip();
    const gx = 64, gy = 56;
    const x0 = Math.floor((camera.x - vw) / gx) * gx, x1 = camera.x + vw;
    const y0 = Math.floor((camera.y - vh) / gy) * gy, y1 = camera.y + vh;
    ctx.fillStyle = '#242450';
    ctx.beginPath();
    for (let y = y0, row = Math.round(y0 / gy); y < y1; y += gy, row++) {
      const off = (row & 1) ? gx / 2 : 0;
      for (let x = x0 + off; x < x1; x += gx) {
        ctx.moveTo(x + 3, y);
        ctx.arc(x, y, 3, 0, TAU);
      }
    }
    ctx.fill();
    ctx.restore();
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#ff3b5c';
    ctx.shadowColor = '#ff3b5c';
    ctx.shadowBlur = 30;
    ctx.beginPath();
    ctx.arc(0, 0, WORLD_R, 0, TAU);
    ctx.stroke();
    ctx.shadowBlur = 0;

    // food
    for (const f of view.food) {
      if (!inView(f.x, f.y, 20)) continue;
      const r = 4 + f.value * 1.5;
      const pulse = 1 + Math.sin(time / 300 + f.x * 0.37 + f.y * 0.11) * 0.12;
      ctx.fillStyle = `hsla(${f.hue},90%,60%,0.28)`;
      ctx.beginPath(); ctx.arc(f.x, f.y, r * 1.9 * pulse, 0, TAU); ctx.fill();
      ctx.fillStyle = `hsl(${f.hue},90%,62%)`;
      ctx.beginPath(); ctx.arc(f.x, f.y, r * pulse, 0, TAU); ctx.fill();
    }

    // snakes (smaller first so big ones overlap on top)
    const order = view.snakes.slice().sort((a, b) => a.mass - b.mass);
    for (const s of order) drawSnake(s, inView, time);
    for (const s of order) drawName(s, inView);

    ctx.restore();
    drawHUD(view);
  }

  function drawSnake(s, inView, time) {
    const segs = s.segs;
    for (let i = segs.length - 1; i >= 0; i--) {
      const p = segs[i];
      if (!inView(p.x, p.y, s.r)) continue;
      if (s.boosting && i % 4 === 0) {
        ctx.fillStyle = `hsla(${s.hue},90%,60%,0.18)`;
        ctx.beginPath(); ctx.arc(p.x, p.y, s.r * 1.6, 0, TAU); ctx.fill();
      }
      if (s.rim) {
        ctx.fillStyle = s.rim;
        ctx.beginPath(); ctx.arc(p.x, p.y, s.r + 1.5, 0, TAU); ctx.fill();
      }
      ctx.fillStyle = (Math.floor(i / 3) & 1) ? s.colorB : s.colorA;
      ctx.beginPath(); ctx.arc(p.x, p.y, s.r, 0, TAU); ctx.fill();
    }
    const h = segs[0];
    if (!inView(h.x, h.y, s.r * 2.5)) return;
    SkinArt.drawHead(ctx, h.x, h.y, s.r, s.angle, s.skin, time);
  }

  // Only real players have a nickname above the head; NPCs have none.
  function drawName(s, inView) {
    const h = s.segs[0];
    if (!s.isPlayer || !s.name || !inView(h.x, h.y, 100)) return;
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 4;
    ctx.strokeStyle = 'rgba(0,0,0,.7)';
    ctx.fillStyle = '#fff';
    const hatH = s.skin ? SkinArt.hatHeight(s.skin.hat) : 0; // lift the name above any hat
    const y = h.y - s.r * Math.max(1, hatH) - 12;
    ctx.strokeText(s.name, h.x, y);
    ctx.fillText(s.name, h.x, y);
  }

  function drawHUD(view) {
    const me = view.me;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.textBaseline = 'alphabetic';

    ctx.textAlign = 'left';
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('Your length:', 16, H - 36);
    ctx.font = '800 26px system-ui, sans-serif';
    ctx.fillText(Math.floor(me.mass), 16, H - 10);

    // Compact HUD for narrow (portrait phone) screens: smaller panel, top 5 only.
    const compact = W < 600;
    const lbW = compact ? Math.min(190, Math.floor(W * 0.5)) : 270;
    const lbX = W - lbW - (compact ? 8 : 14), lbY = compact ? 8 : 12;
    const rows = Math.min(view.lb.length, compact ? 5 : 10);
    const rowH = compact ? 16 : 20, fs = compact ? 11 : 14, headH = compact ? 24 : 34;
    ctx.fillStyle = 'rgba(0,0,0,.35)';
    ctx.fillRect(lbX, lbY, lbW, headH + rowH * rows + 4);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#fff';
    ctx.font = `700 ${compact ? 13 : 16}px system-ui, sans-serif`;
    ctx.fillText('Leaderboard', lbX + lbW / 2, lbY + (compact ? 17 : 22));
    ctx.font = `${fs}px system-ui, sans-serif`;
    for (let i = 0; i < rows; i++) {
      const r = view.lb[i], y = lbY + headH + 12 + i * rowH - (compact ? 4 : 0);
      ctx.fillStyle = r.isMe ? '#ffe45a' : (r.isPlayer ? '#fff' : 'rgba(255,255,255,.55)');
      ctx.textAlign = 'left';
      let label = `${i + 1}. ${r.isPlayer ? r.name : r.name + ' (NPC)'}`;
      while (label.length > 3 && ctx.measureText(label).width > lbW - (compact ? 40 : 64)) label = label.slice(0, -2) + '…';
      ctx.fillText(label, lbX + (compact ? 8 : 12), y);
      ctx.textAlign = 'right';
      ctx.fillText(r.mass, lbX + lbW - (compact ? 8 : 12), y);
    }
    if (view.rank > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#fff';
      ctx.font = `${compact ? 11 : 13}px system-ui, sans-serif`;
      ctx.fillText(`Your rank: ${view.rank} / ${view.total}`, W - (compact ? 10 : 16), lbY + headH + rowH * rows + (compact ? 16 : 20));
    }

    const mr = compact ? 42 : 56, mx = W - mr - (compact ? 10 : 18), my = H - mr - (compact ? 10 : 18);
    ctx.fillStyle = 'rgba(0,0,0,.45)';
    ctx.beginPath(); ctx.arc(mx, my, mr, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.35)'; ctx.lineWidth = 2; ctx.stroke();
    const k = mr / WORLD_R;
    ctx.fillStyle = 'rgba(255,255,255,.35)';
    for (const p of view.mm) ctx.fillRect(mx + p[0] * k - 1, my + p[1] * k - 1, 2, 2);
    ctx.fillStyle = '#ffe45a';
    ctx.beginPath(); ctx.arc(mx + me.segs[0].x * k, my + me.segs[0].y * k, 3, 0, TAU); ctx.fill();

    drawJoystick();
  }

  function drawJoystick() {
    if (!IS_TOUCH || !playing || onlineDead) return;
    const active = touch.joyId !== null;
    const bx = active ? touch.baseX : 100, by = active ? touch.baseY : H - 100;
    ctx.lineWidth = 3;
    ctx.strokeStyle = active ? 'rgba(255,255,255,.55)' : 'rgba(255,255,255,.2)';
    ctx.fillStyle = 'rgba(255,255,255,.08)';
    ctx.beginPath(); ctx.arc(bx, by, JOY_R, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = active ? 'rgba(255,255,255,.6)' : 'rgba(255,255,255,.2)';
    ctx.beginPath(); ctx.arc(active ? touch.knobX : bx, active ? touch.knobY : by, 26, 0, TAU); ctx.fill();
    if (touchBoosting()) {
      ctx.fillStyle = '#ffe45a'; ctx.textAlign = 'center'; ctx.font = '700 18px system-ui, sans-serif';
      ctx.fillText('BOOST', W / 2, H - 24);
    }
  }

  // ---------- Loop ----------
  let last = performance.now(), acc = 0;
  function frame(now) {
    acc += Math.min(0.1, (now - last) / 1000);
    last = now;
    if (playing && mode === 'local') {
      while (acc >= TICK) {
        if (localPlayer.alive) {
          const inp = computeInput(localPlayer.angle, TICK);
          localPlayer.targetAngle = inp.a;
          localPlayer.boosting = inp.b;
        }
        world.step(TICK);
        acc -= TICK;
      }
    } else {
      acc = 0;
    }
    draw(now);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---------- Game start / end ----------
  const menu = document.getElementById('menu');
  const dead = document.getElementById('dead');
  const deadTitle = document.getElementById('dead-title');
  const deadScore = document.getElementById('dead-score');
  const menuMsg = document.getElementById('menu-msg');
  const nick = document.getElementById('nick');
  try { nick.value = localStorage.getItem('snake-nick') || ''; } catch (e) { /* storage unavailable */ }

  function showEnd(title, text, delay) {
    input.mouseDown = input.space = false;
    deadTitle.textContent = title;
    deadScore.textContent = text;
    setTimeout(() => { if (playing) dead.classList.remove('hidden'); }, delay);
  }
  let startDone = null;
  function settleStart() { if (startDone) { const f = startDone; startDone = null; f(); } }
  function showMenu(msg) {
    playing = false;
    dead.classList.add('hidden');
    menu.classList.remove('hidden');
    menuMsg.textContent = msg || '';
    nick.focus();
    settleStart();
    // drop the "in a game" history entry so the Back button doesn't land on a dead game screen
    if (history.state && history.state.screen === 'game') history.back();
  }

  // The phone's Back button while in a game (or on the death screen) goes to the menu instead of quitting.
  history.replaceState({ screen: 'menu' }, '');
  window.addEventListener('popstate', () => {
    if (!menu.classList.contains('hidden') || !document.getElementById('custom').classList.contains('hidden')) return;
    if (ws) { const old = ws; ws = null; old.close(); }
    playing = false; onlineDead = false;
    input.mouseDown = input.space = false;
    dead.classList.add('hidden');
    menu.classList.remove('hidden');
    menuMsg.textContent = '';
    settleStart();
  });

  function startLocal(name) {
    world = Sim.createWorld({ npcCount: NPC_COUNT });
    world.onDeath = s => { if (s === localPlayer) showEnd('You died', `Final length: ${Math.floor(s.mass)}`, 700); };
    localPlayer = world.addPlayer(name, SnakeCustomize.get());
    camera.zoom = 1;
    lastView = null;
    playing = true;
  }

  function startOnline(name) {
    menuMsg.textContent = 'Connecting…';
    const sock = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host);
    ws = sock; joined = false; onlineDead = false; snapBuf = []; myId = null; lastView = null; camera.zoom = 1;

    sock.onopen = () => sock.send(JSON.stringify({ t: 'join', name, skin: SnakeCustomize.get() }));
    sock.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.t === 'joined') {
        joined = true; myId = m.id; playing = true;
        menu.classList.add('hidden'); dead.classList.add('hidden'); menuMsg.textContent = '';
        settleStart();
      } else if (m.t === 's') {
        m.rt = performance.now();
        snapBuf.push(m);
        if (snapBuf.length > 30) snapBuf.shift();
      } else if (m.t === 'dead') {
        onlineDead = true;
        showEnd('You died', `Final length: ${m.mass}`, 700);
        // the server keeps streaming for ~1.5s so the death burst stays visible, then we hang up
        setTimeout(() => sock.close(), 1500);
      } else if (m.t === 'full') {
        sock.close();
        showMenu('Server is full, try again in a moment.');
      }
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      if (!joined) showMenu('Could not connect to the server. Local mode works without internet.');
      else if (!onlineDead) { onlineDead = true; showEnd('Disconnected', 'Lost connection to the server.', 0); }
    };
  }

  // send input to the server 20x per second
  setInterval(() => {
    if (mode !== 'online' || !joined || onlineDead || !ws || ws.readyState !== 1 || !lastView) return;
    const inp = computeInput(lastView.me.angle, 0.05);
    ws.send(JSON.stringify({ t: 'in', a: Math.round(inp.a * 1000) / 1000, b: inp.b ? 1 : 0, vw: Math.round(lastView.vw || 700), vh: Math.round(lastView.vh || 450) }));
  }, 50);

  // done() is called once the game is on screen (or the attempt failed), so the screen cover can lift.
  function startGame(done) {
    startDone = done || null;
    if (!history.state || history.state.screen !== 'game') history.pushState({ screen: 'game' }, '');
    const name = nick.value.trim().slice(0, 16) || 'Player';
    try { localStorage.setItem('snake-nick', nick.value.trim()); } catch (e) { /* ignore */ }
    mode = modeSwitch.checked ? 'online' : 'local';
    steer = null; // new game: start by heading wherever the new snake spawns facing
    if (ws) { const old = ws; ws = null; old.close(); }
    playing = false;
    if (mode === 'local') {
      menu.classList.add('hidden'); dead.classList.add('hidden');
      startLocal(name);
      settleStart();
    } else {
      dead.classList.add('hidden');
      startOnline(name);
    }
  }

  // Offline / Online switch
  const modeSwitch = document.getElementById('mode-switch');
  const MODE_HINTS = {
    local: 'Play alone against NPC snakes. Works without internet.',
    online: 'Play with other real players and NPCs. Needs internet.',
  };
  function syncModeSwitch() {
    document.getElementById('lbl-off').classList.toggle('active', !modeSwitch.checked);
    document.getElementById('lbl-on').classList.toggle('active', modeSwitch.checked);
    document.getElementById('mode-hint').textContent = MODE_HINTS[modeSwitch.checked ? 'online' : 'local'];
  }
  modeSwitch.addEventListener('change', syncModeSwitch);
  document.getElementById('lbl-off').addEventListener('click', () => { modeSwitch.checked = false; syncModeSwitch(); });
  document.getElementById('lbl-on').addEventListener('click', () => { modeSwitch.checked = true; syncModeSwitch(); });
  syncModeSwitch();

  // every start goes through the circle transition, growing out of the button that was used
  const withWipe = (btn, color) => SnakeWipe.run(btn, color, () => new Promise(res => startGame(res)));
  document.getElementById('menu-form').addEventListener('submit', e => { e.preventDefault(); withWipe(document.getElementById('play'), '#2fc96b'); });
  document.getElementById('again').addEventListener('click', e => withWipe(e.currentTarget, '#2fc96b'));
  document.getElementById('to-menu').addEventListener('click', e => SnakeWipe.run(e.currentTarget, '#2a2a4a', () => showMenu('')));
  nick.focus();

  // read-only test hook, only when the page is opened with ?debug
  if (location.search.includes('debug')) {
    window.__snake = { me: () => (lastView && lastView.me), steer: () => steer, mode: () => mode, touch: () => ({ joyId: touch.joyId, angle: touch.angle }), alive: () => !!(localPlayer && localPlayer.alive) };
  }

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
})();
