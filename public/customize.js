'use strict';
// Snake Game: the "Customize" screen (colour, hat, glasses, mustache) and the saved skin.
window.SnakeCustomize = (() => {
  const Sim = window.SnakeSim, Art = window.SkinArt;
  const STORE_KEY = 'snake-skin';

  let skin = Sim.sanitizeSkin(null);
  try { skin = Sim.sanitizeSkin(JSON.parse(localStorage.getItem(STORE_KEY))); } catch (e) { /* no saved skin */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(skin)); } catch (e) { /* ignore */ } };

  const TABS = [
    { key: 'color', label: 'Colour', list: Sim.SKINS.colors },
    { key: 'hat', label: 'Hats', list: Sim.SKINS.hats },
    { key: 'eyewear', label: 'Glasses', list: Sim.SKINS.eyewear },
    { key: 'mustache', label: 'Mustache', list: Sim.SKINS.mustaches },
  ];
  let tab = 'color';

  const panel = document.getElementById('custom');
  const menu = document.getElementById('menu');
  const preview = document.getElementById('skin-preview');
  const tabsEl = document.getElementById('custom-tabs');
  const grid = document.getElementById('custom-grid');

  function iconFor(key, item) {
    if (key === 'color') {
      const d = document.createElement('span');
      const c = Sim.skinColor(item.id);
      d.className = 'swatch';
      d.style.background = `linear-gradient(135deg, ${c.a} 55%, ${c.b} 55%)`;
      if (c.rim) d.style.borderColor = c.rim;
      return d;
    }
    const cv = document.createElement('canvas');
    cv.width = cv.height = 96;
    const s = { ...skin, hat: 'none', eyewear: 'none', mustache: 'none', [key]: item.id };
    const hat = key === 'hat'; // hats need the whole head + headroom; face items are shown close up
    Art.renderPreview(cv, s, 0, { body: false, r: hat ? 22 : 34, cx: hat ? 48 : 36, cy: hat ? 66 : 50 });
    return cv;
  }

  function renderTabs() {
    tabsEl.innerHTML = '';
    for (const t of TABS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = t.label;
      b.className = 'tab' + (t.key === tab ? ' active' : '');
      b.onclick = () => { tab = t.key; renderTabs(); renderGrid(); };
      tabsEl.appendChild(b);
    }
  }

  function renderGrid() {
    grid.innerHTML = '';
    const t = TABS.find(x => x.key === tab);
    for (const item of t.list) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'opt' + (skin[tab] === item.id ? ' selected' : '');
      b.title = item.name;
      b.appendChild(iconFor(tab, item));
      const l = document.createElement('span');
      l.textContent = item.name;
      b.appendChild(l);
      b.onclick = () => { skin[tab] = item.id; save(); renderGrid(); };
      grid.appendChild(b);
    }
  }

  let open = false;
  function loop(now) {
    if (!open) return;
    Art.renderPreview(preview, skin, now);
    requestAnimationFrame(loop);
  }
  // The phone's Back button should close this screen (not quit the app), so opening it adds a history entry.
  function show() {
    open = true; menu.classList.add('hidden'); panel.classList.remove('hidden'); renderTabs(); renderGrid(); requestAnimationFrame(loop);
    history.pushState({ screen: 'custom' }, '');
  }
  function hideUI() { open = false; panel.classList.add('hidden'); menu.classList.remove('hidden'); }
  function hide() {
    hideUI();
    if (history.state && history.state.screen === 'custom') history.back();
  }
  window.addEventListener('popstate', () => { if (open) hideUI(); });

  document.getElementById('open-custom').addEventListener('click', e => window.SnakeWipe.run(e.currentTarget, '#6a5cff', show));
  document.getElementById('custom-done').addEventListener('click', e => window.SnakeWipe.run(e.currentTarget, '#2fc96b', hide));
  document.getElementById('custom-random').addEventListener('click', () => {
    const pick = l => l[Math.floor(Math.random() * l.length)].id;
    skin = { color: pick(Sim.SKINS.colors), hat: pick(Sim.SKINS.hats), eyewear: pick(Sim.SKINS.eyewear), mustache: pick(Sim.SKINS.mustaches) };
    save(); renderGrid();
  });

  return { get: () => ({ ...skin }) };
})();
