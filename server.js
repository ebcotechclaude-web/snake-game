// Snake Game server: serves ./public and runs the online multiplayer world over WebSocket.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');
const Sim = require('./public/sim.js');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_PLAYERS = 40;
const TICK = 1 / 60;
const SNAPSHOT_EVERY = 3; // ticks -> 20 snapshots/s

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

// ---------- Static files ----------
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; img-src 'self' data:; frame-ancestors 'none'",
};

const server = http.createServer((req, res) => {
  const fail = (code, text) => {
    res.writeHead(code, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS });
    res.end(text);
  };
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405, 'Method not allowed');
  if (req.url === '/healthz') return fail(200, 'ok'); // used by hosting health checks

  let urlPath;
  try { urlPath = decodeURIComponent(req.url.split('?')[0]); } catch (e) { return fail(400, 'Bad request'); }
  if (urlPath.includes('\0')) return fail(400, 'Bad request');

  const rel = urlPath === '/' ? 'index.html' : urlPath;
  const filePath = path.join(PUBLIC_DIR, path.normalize(rel));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) return fail(403, 'Forbidden');

  fs.readFile(filePath, (err, data) => {
    if (err) return fail(404, 'Not found');
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      ...SECURITY_HEADERS,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// ---------- Game world ----------
const world = Sim.createWorld({ npcCount: 22 });
const players = new Map(); // ws -> { snake, vw, vh }

world.onDeath = snake => {
  for (const [ws, p] of players) {
    if (p.snake === snake) {
      p.snake = null;
      // keep streaming the world around the death spot for a moment so the player sees the energy burst
      p.deathPos = { x: snake.segs[0].x, y: snake.segs[0].y };
      p.spectateUntil = Date.now() + 1500;
      send(ws, { t: 'dead', mass: Math.floor(snake.mass) });
    }
  }
};

function send(ws, msg) {
  if (ws.readyState === 1) ws.send(JSON.stringify(msg));
}

// ---------- Connection safety limits ----------
const MAX_CONNECTIONS = 100;
const MAX_PER_IP = 6;
const MAX_MSGS_PER_SEC = 60;
const JOIN_TIMEOUT_MS = 10000;
const perIp = new Map();

// Behind a proxy every connection arrives from the proxy's address, so the per-IP limit needs the real
// client address from a forwarded header. That is only trusted when the connection comes from localhost
// (the Cloudflare tunnel) or when TRUST_PROXY=1 is set (hosts like Render, where a proxy always sits in front).
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
function clientIp(req) {
  const remote = req.socket.remoteAddress || '';
  const loopback = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (loopback || TRUST_PROXY) {
    const fwd = req.headers['cf-connecting-ip'] || String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (fwd) return fwd;
  }
  return remote;
}

const wss = new WebSocketServer({
  server,
  maxPayload: 1024,
  // Only accept connections from pages served by this same server (blocks other websites from driving it).
  verifyClient: ({ req }) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch (e) { return false; }
  },
});

wss.on('connection', (ws, req) => {
  const ip = clientIp(req);
  if (wss.clients.size > MAX_CONNECTIONS || (perIp.get(ip) || 0) >= MAX_PER_IP) return ws.close(1013, 'busy');
  perIp.set(ip, (perIp.get(ip) || 0) + 1);

  const p = { snake: null, vw: 700, vh: 450, msgs: 0 };
  players.set(ws, p);
  const rateTimer = setInterval(() => { p.msgs = 0; }, 1000);
  const joinTimer = setTimeout(() => { if (!p.snake && !p.spectateUntil) ws.close(); }, JOIN_TIMEOUT_MS);

  ws.on('message', raw => {
    if (++p.msgs > MAX_MSGS_PER_SEC) return ws.close(1008, 'too many messages');
    let m;
    try { m = JSON.parse(raw); } catch (e) { return; }
    if (!m || typeof m !== 'object') return;

    if (m.t === 'join' && !p.snake) {
      let joined = 0;
      for (const q of players.values()) if (q.snake) joined++;
      if (joined >= MAX_PLAYERS) return send(ws, { t: 'full' });
      const name = String(typeof m.name === 'string' ? m.name : 'Player').replace(/[\u0000-\u001f\u007f<>​-‏‪-‮⁦-⁩]/g, '').trim().slice(0, 16) || 'Player';
      p.snake = world.addPlayer(name, m.skin);
      send(ws, { t: 'joined', id: p.snake.id, R: Sim.WORLD_R });
    } else if (m.t === 'in' && p.snake) {
      if (Number.isFinite(m.a)) p.snake.targetAngle = m.a;
      p.snake.boosting = !!m.b;
      if (Number.isFinite(m.vw)) p.vw = Math.min(2400, Math.max(200, m.vw));
      if (Number.isFinite(m.vh)) p.vh = Math.min(1600, Math.max(200, m.vh));
    }
  });

  ws.on('close', () => {
    clearInterval(rateTimer);
    clearTimeout(joinTimer);
    perIp.set(ip, Math.max(0, (perIp.get(ip) || 1) - 1));
    if (perIp.get(ip) === 0) perIp.delete(ip);
    players.delete(ws);
    if (p.snake) world.kill(p.snake);
  });
  ws.on('error', () => {});
});

// ---------- Snapshots ----------
const r1 = v => Math.round(v);

function snapshotFor(p) {
  const me = p.snake;
  const head = me ? me.segs[0] : p.deathPos;
  const vw = p.vw + 120, vh = p.vh + 120;

  const snakes = [];
  for (const s of world.snakes) {
    let visible = s === me;
    if (!visible) {
      for (let i = 0; i < s.segs.length; i += 3) {
        if (Math.abs(s.segs[i].x - head.x) < vw && Math.abs(s.segs[i].y - head.y) < vh) { visible = true; break; }
      }
    }
    if (!visible) continue;
    const segs = new Array(s.segs.length * 2);
    for (let i = 0; i < s.segs.length; i++) { segs[i * 2] = r1(s.segs[i].x); segs[i * 2 + 1] = r1(s.segs[i].y); }
    snakes.push({ i: s.id, n: s.name, p: s.isPlayer ? 1 : 0, c: s.color, k: s.isPlayer ? [s.skin.hat, s.skin.eyewear, s.skin.mustache] : 0, m: Math.round(s.mass * 10) / 10, a: Math.round(s.angle * 100) / 100, b: s.boosting ? 1 : 0, s: segs });
  }

  const food = [];
  for (const f of world.food) {
    if (Math.abs(f.x - head.x) < vw && Math.abs(f.y - head.y) < vh) food.push(r1(f.x), r1(f.y), f.value, f.hue);
  }

  const ranked = world.snakes.slice().sort((a, b) => b.mass - a.mass);
  const lb = ranked.slice(0, 10).map(s => [s.name, Math.floor(s.mass), s.isPlayer ? 1 : 0, s.id]);
  const mm = [];
  for (const s of world.snakes) if (s !== me) mm.push(r1(s.segs[0].x), r1(s.segs[0].y));

  return { t: 's', snakes, food, lb, rank: ranked.indexOf(me) + 1, total: ranked.length, mm };
}

// ---------- Main loop ----------
let last = process.hrtime.bigint();
let acc = 0, tickNo = 0;
setInterval(() => {
  const now = process.hrtime.bigint();
  acc += Math.min(0.25, Number(now - last) / 1e9);
  last = now;
  while (acc >= TICK) {
    world.step(TICK);
    acc -= TICK;
    if (++tickNo % SNAPSHOT_EVERY === 0) {
      for (const [ws, p] of players) {
        if (p.snake || (p.spectateUntil && Date.now() < p.spectateUntil)) send(ws, snapshotFor(p));
      }
    }
  }
}, 8);

server.listen(PORT, () => {
  console.log(`Snake Game running at http://localhost:${PORT}`);
});
