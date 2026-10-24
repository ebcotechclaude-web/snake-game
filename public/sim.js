'use strict';
// Snake Game simulation. Shared by the browser (local mode) and the Node server (online mode).
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.SnakeSim = factory();
})(this, function () {
  const WORLD_R = 2500;
  const FOOD_TARGET = 2000;
  const FOOD_MAX = 3500;
  const BASE_SPEED = 150;
  const BOOST_SPEED = 300;
  const BOOST_COST = 6;      // mass per second
  const MIN_MASS = 10;
  const TAU = Math.PI * 2;

  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const normAngle = a => { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; };

  const radiusFor = mass => 8 + Math.min(14, (mass - MIN_MASS) * 0.03);
  const segCountFor = mass => Math.min(600, Math.floor(12 + (mass - MIN_MASS) * 0.6));
  const maxTurn = r => 3.8 / (1 + (r - 8) * 0.08);
  // ---------- Skins (colours + accessories). Ids are what travels over the network. ----------
  // a/b = the two alternating body stripe colours, rim = optional outline for dark snakes,
  // hue = tint of the energy particles this snake drops.
  const SKINS = {
    colors: [
      { id: 'white',  name: 'White',      a: '#ffffff', b: '#d3d8e2', hue: 200 },
      { id: 'black',  name: 'Black',      a: '#3b3b46', b: '#1d1d24', rim: '#9a9aae', hue: 260 },
      { id: 'rose',   name: 'Rose red',   a: '#e8325a', b: '#bf1f46', hue: 345 },
      { id: 'gold',   name: 'Golden',     a: '#ffd23f', b: '#e0a800', hue: 46 },
      { id: 'night',  name: 'Night blue', a: '#2f45b3', b: '#1d2b82', rim: '#7d8fe8', hue: 228 },
      { id: 'cyan',   name: 'Cyan',       a: '#2de2e6', b: '#18b4bf', hue: 185 },
      { id: 'orange', name: 'Orange',     a: '#ff9a1f', b: '#e07400', hue: 30 },
      { id: 'pink',   name: 'Pink',       a: '#ff7ac8', b: '#e757ab', hue: 320 },
      { id: 'green',  name: 'Green',      a: '#4cd964', b: '#2fa84a', hue: 130 },
      { id: 'purple', name: 'Purple',     a: '#9b5cff', b: '#7a3fe0', hue: 268 },
      { id: 'lime',   name: 'Lime',       a: '#b6f23a', b: '#8fc41f', hue: 78 },
      { id: 'brown',  name: 'Brown',      a: '#b07445', b: '#8a5530', hue: 25 },
    ],
    hats: [
      { id: 'none', name: 'No hat' }, { id: 'crown', name: 'Crown' }, { id: 'tophat', name: 'Top hat' },
      { id: 'cowboy', name: 'Cowboy' }, { id: 'party', name: 'Party' }, { id: 'wizard', name: 'Wizard' },
      { id: 'beanie', name: 'Beanie' }, { id: 'propeller', name: 'Propeller' },
    ],
    eyewear: [
      { id: 'none', name: 'No glasses' }, { id: 'round', name: 'Round' }, { id: 'shades', name: 'Shades' },
      { id: 'monocle', name: 'Monocle' }, { id: 'goggles', name: 'Goggles' }, { id: 'heart', name: 'Hearts' },
    ],
    mustaches: [
      { id: 'none', name: 'No mustache' }, { id: 'classic', name: 'Classic' }, { id: 'handlebar', name: 'Handlebar' },
      { id: 'walrus', name: 'Walrus' }, { id: 'pencil', name: 'Pencil' }, { id: 'goatee', name: 'Goatee' },
    ],
  };
  const skinColor = id => SKINS.colors.find(c => c.id === id) || SKINS.colors[8];
  const has = (list, id) => list.some(x => x.id === id);
  // Never trust a skin that came from a client: anything not in the lists falls back to a default.
  function sanitizeSkin(s) {
    s = s && typeof s === 'object' ? s : {};
    return {
      color: has(SKINS.colors, s.color) ? s.color : 'green',
      hat: has(SKINS.hats, s.hat) ? s.hat : 'none',
      eyewear: has(SKINS.eyewear, s.eyewear) ? s.eyewear : 'none',
      mustache: has(SKINS.mustaches, s.mustache) ? s.mustache : 'none',
    };
  }

  // NPC names (shown on the leaderboard only, never above the head)
  const NAME_WORDS = {
    fruit: ['Mango', 'Banana', 'Barbecue', 'Peach', 'Lychee', 'Durian', 'Cherry', 'Papaya', 'Guava', 'Kiwi', 'Melon', 'Plum', 'Coconut', 'Lemon', 'Apricot', 'Pomelo'],
    first: ['James', 'Emma', 'Liam', 'Olivia', 'Noah', 'Mia', 'Lucas', 'Sofia', 'Ethan', 'Chloe', 'Aiden', 'Zoe', 'Ryan', 'Lily', 'Jack', 'Nina'],
    last: ['Parker', 'Smith', 'Lee', 'Tan', 'Brown', 'Wong', 'Taylor', 'Miller', 'Carter', 'Lim', 'Davis', 'Clark', 'Young', 'King', 'Ng', 'Hill'],
    adj: ['Sneaky', 'Hungry', 'Happy', 'Lazy', 'Crazy', 'Tiny', 'Mighty', 'Spicy', 'Sleepy', 'Wild', 'Cool', 'Swift'],
  };
  function randomNPCName() {
    const r = Math.random();
    if (r < 0.3) return pick(NAME_WORDS.fruit);
    if (r < 0.6) return `${pick(NAME_WORDS.first)} ${pick(NAME_WORDS.last)}`;
    if (r < 0.8) return `${pick(NAME_WORDS.adj)} ${pick(NAME_WORDS.fruit)}`;
    return `${pick(NAME_WORDS.adj)} ${pick(NAME_WORDS.first)} ${pick(NAME_WORDS.last)}`;
  }

  function createWorld({ npcCount = 22 } = {}) {
    const world = { snakes: [], food: [], npcCount, onDeath: null };
    let nextId = 1;

    // ---------- Snakes ----------
    function makeSnake({ x, y, mass, isPlayer, name, skin }) {
      const angle = rand(0, TAU);
      skin = skin || sanitizeSkin({ color: pick(SKINS.colors).id }); // NPCs: random colour, no accessories
      const s = {
        id: nextId++, isPlayer, name, color: skin.color, skin, hue: skinColor(skin.color).hue,
        angle, targetAngle: angle, mass, boosting: false, alive: true,
        segs: [], dropAcc: 0, r: radiusFor(mass), spacing: 0,
        thinkT: rand(0, 0.12), wander: rand(-1, 1),
      };
      s.spacing = s.r * 0.7;
      for (let i = 0; i < segCountFor(mass); i++) s.segs.push({ x: x - Math.cos(angle) * i * s.spacing, y: y - Math.sin(angle) * i * s.spacing });
      return s;
    }

    function moveSnake(s, dt) {
      const diff = normAngle(s.targetAngle - s.angle);
      const step = maxTurn(s.r) * dt;
      s.angle += Math.abs(diff) < step ? diff : Math.sign(diff) * step;

      if (s.boosting && s.mass > MIN_MASS + 0.5) {
        s.mass -= BOOST_COST * dt;
        s.dropAcc += BOOST_COST * dt;
        while (s.dropAcc >= 1) {
          s.dropAcc -= 1;
          const t = s.segs[s.segs.length - 1];
          addFood(t.x + rand(-4, 4), t.y + rand(-4, 4), 1, s.hue);
        }
      } else {
        s.boosting = false;
      }
      s.r = radiusFor(s.mass);
      s.spacing = s.r * 0.7;

      const speed = s.boosting ? BOOST_SPEED : BASE_SPEED;
      const head = s.segs[0];
      head.x += Math.cos(s.angle) * speed * dt;
      head.y += Math.sin(s.angle) * speed * dt;

      const n = segCountFor(s.mass);
      while (s.segs.length < n) s.segs.push({ ...s.segs[s.segs.length - 1] });
      while (s.segs.length > n) s.segs.pop();

      for (let i = 1; i < s.segs.length; i++) {
        const p = s.segs[i - 1], c = s.segs[i];
        const dx = p.x - c.x, dy = p.y - c.y;
        const d = Math.hypot(dx, dy);
        if (d > s.spacing) {
          const k = (d - s.spacing) / d;
          c.x += dx * k;
          c.y += dy * k;
        }
      }
    }

    // ---------- Food ----------
    function addFood(x, y, value, hue) {
      if (world.food.length >= FOOD_MAX) return;
      world.food.push({ x, y, value, hue: hue === undefined ? Math.floor(rand(0, 360)) : hue });
    }
    function spawnNaturalFood() {
      const a = rand(0, TAU), d = Math.sqrt(Math.random()) * (WORLD_R - 40);
      addFood(Math.cos(a) * d, Math.sin(a) * d, Math.random() < 0.2 ? 2 : 1);
    }
    function killSnake(s) {
      if (!s.alive) return;
      s.alive = false;
      const stride = 2;
      const pieces = Math.max(1, Math.floor(s.segs.length / stride));
      const each = Math.max(1, (s.mass * 0.8) / pieces);
      for (let i = 0; i < s.segs.length; i += stride) {
        addFood(s.segs[i].x + rand(-6, 6), s.segs[i].y + rand(-6, 6), Math.min(each, 4), s.hue);
      }
      if (world.onDeath) world.onDeath(s);
    }

    // ---------- NPC AI ----------
    function thinkNPC(s) {
      const { snakes, food } = world;
      const head = s.segs[0];
      const distC = Math.hypot(head.x, head.y);
      let target = null;
      s.boosting = false;

      if (distC > WORLD_R - 260) target = Math.atan2(-head.y, -head.x);

      let ax = 0, ay = 0;
      const fx = Math.cos(s.angle), fy = Math.sin(s.angle);
      for (const o of snakes) {
        if (o === s || !o.alive) continue;
        const hx = o.segs[0].x - head.x, hy = o.segs[0].y - head.y;
        if (Math.abs(hx) > o.segs.length * o.spacing + 200 || Math.abs(hy) > o.segs.length * o.spacing + 200) continue;
        const danger = s.r + o.r + 70;
        for (let i = 0; i < o.segs.length; i += 2) {
          const dx = o.segs[i].x - head.x, dy = o.segs[i].y - head.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < danger * danger && dx * fx + dy * fy > -10) {
            const d = Math.sqrt(d2) || 1;
            ax -= dx / d / d;
            ay -= dy / d / d;
          }
        }
      }
      if (ax !== 0 || ay !== 0) target = Math.atan2(ay, ax);

      if (target === null) {
        let prey = null, preyD = 450;
        if (s.mass > 25) {
          for (const o of snakes) {
            if (o === s || !o.alive || o.mass > s.mass * 0.7) continue;
            const d = Math.hypot(o.segs[0].x - head.x, o.segs[0].y - head.y);
            if (d < preyD) { preyD = d; prey = o; }
          }
        }
        if (prey) {
          const ph = prey.segs[0];
          target = Math.atan2(ph.y + Math.sin(prey.angle) * 120 - head.y, ph.x + Math.cos(prey.angle) * 120 - head.x);
          if (preyD < 320 && s.mass > 30) s.boosting = true;
        } else {
          let best = null, bestScore = 0;
          for (const f of food) {
            const dx = f.x - head.x, dy = f.y - head.y;
            const d2 = dx * dx + dy * dy;
            if (d2 > 380 * 380) continue;
            const sc = f.value / (Math.sqrt(d2) + 40);
            if (sc > bestScore) { bestScore = sc; best = f; }
          }
          if (best) target = Math.atan2(best.y - head.y, best.x - head.x);
        }
      }

      if (target === null) {
        s.wander = Math.max(-1, Math.min(1, s.wander + rand(-0.4, 0.4)));
        target = s.angle + s.wander * 0.9;
      }
      s.targetAngle = target;
    }

    // ---------- Spawning ----------
    function spawnPos(avoidDist) {
      let x, y, tries = 0, ok;
      do {
        const a = rand(0, TAU), d = Math.sqrt(Math.random()) * (WORLD_R - 300);
        x = Math.cos(a) * d; y = Math.sin(a) * d;
        ok = true;
        for (const o of world.snakes) {
          if (o.alive && o.isPlayer && Math.hypot(x - o.segs[0].x, y - o.segs[0].y) < avoidDist) { ok = false; break; }
        }
      } while (!ok && ++tries < 20);
      return { x, y };
    }
    function spawnNPC(mass) {
      const p = spawnPos(700);
      world.snakes.push(makeSnake({ x: p.x, y: p.y, mass: mass || rand(10, 40), isPlayer: false, name: randomNPCName() }));
    }
    world.addPlayer = function (name, skin) {
      const a = rand(0, TAU), d = rand(0, WORLD_R * 0.5);
      const s = makeSnake({ x: Math.cos(a) * d, y: Math.sin(a) * d, mass: MIN_MASS, isPlayer: true, name, skin: sanitizeSkin(skin) });
      world.snakes.push(s);
      return s;
    };
    world.kill = killSnake;

    for (let i = 0; i < FOOD_TARGET; i++) spawnNaturalFood();
    for (let i = 0; i < npcCount; i++) spawnNPC(rand(10, 60));

    // ---------- Step ----------
    world.step = function (dt) {
      const { snakes, food } = world;
      for (const s of snakes) {
        if (!s.alive) continue;
        if (!s.isPlayer) {
          s.thinkT -= dt;
          if (s.thinkT <= 0) { s.thinkT = 0.1 + Math.random() * 0.05; thinkNPC(s); }
        }
        moveSnake(s, dt);
      }

      for (const s of snakes) {
        if (!s.alive) continue;
        const h = s.segs[0];
        const reach = s.r + 12;
        for (let i = food.length - 1; i >= 0; i--) {
          const f = food[i];
          const dx = f.x - h.x, dy = f.y - h.y;
          const fr = 4 + f.value * 1.5;
          if (dx * dx + dy * dy < (reach + fr) * (reach + fr)) {
            s.mass += f.value;
            food[i] = food[food.length - 1];
            food.pop();
          }
        }
      }

      // Collisions: find which snake each head ran into (the closest one if several).
      const dead = new Set();
      const hitBy = new Map(); // snake -> the snake whose body/head it ran into
      for (const a of snakes) {
        if (!a.alive) continue;
        const h = a.segs[0];
        if (Math.hypot(h.x, h.y) > WORLD_R) { dead.add(a); continue; }
        let best = null, bestD2 = Infinity;
        for (const b of snakes) {
          if (b === a || !b.alive) continue;
          const lim = (a.r + b.r) * 0.75;
          for (let i = 0; i < b.segs.length; i++) {
            const dx = b.segs[i].x - h.x, dy = b.segs[i].y - h.y;
            const d2 = dx * dx + dy * dy;
            if (d2 < lim * lim && d2 < bestD2) { bestD2 = d2; best = b; }
          }
        }
        if (best) hitBy.set(a, best);
      }
      // Head-to-head (both ran into each other in the same tick): only one dies.
      // The bigger snake wins; on an exact tie it is a coin flip.
      for (const [a, b] of hitBy) {
        if (hitBy.get(b) === a) {
          if (a.id > b.id) continue; // resolve each pair once
          const loser = a.mass === b.mass ? (Math.random() < 0.5 ? a : b) : (a.mass < b.mass ? a : b);
          dead.add(loser);
        } else {
          dead.add(a);
        }
      }
      for (const s of dead) killSnake(s);

      world.snakes = world.snakes.filter(s => s.alive);
      let npcs = 0;
      for (const s of world.snakes) if (!s.isPlayer) npcs++;
      for (; npcs < world.npcCount; npcs++) spawnNPC();
      let guard = 0;
      while (world.food.length < FOOD_TARGET && guard++ < 5) spawnNaturalFood();
    };

    return world;
  }

  return { WORLD_R, MIN_MASS, TAU, normAngle, radiusFor, SKINS, skinColor, sanitizeSkin, createWorld };
});
