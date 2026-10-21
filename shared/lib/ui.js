// Shared UI: number formatting, matrix tables, sliders, tooltips and Lab / Info tabs.

export const fmt = (v, d = 2) => (Math.abs(v) < 0.5 * 10 ** -d ? 0 : v).toFixed(d);
export const vec = (v, d = 2) => `(${v.map((x) => fmt(x, d)).join(', ')})`;
// compact format for values spanning many orders of magnitude (entries of F)
export const sci = (v) => (v === 0 || Math.abs(v) >= 0.01 ? fmt(v, 3) : v.toExponential(1));

export function matHTML(rows, sepCol = -1) {
  return `<table class="mat">${rows.map((r) => `<tr>${r.map((v, j) =>
    `<td${j === sepCol ? ' class="sep"' : ''}>${typeof v === 'number' ? fmt(v) : v}</td>`).join('')}</tr>`).join('')}</table>`;
}

// Sets innerHTML only when it changed (keeps hover / selection stable)
export function htmlSetter(el) {
  let last = '';
  return (html) => { if (html !== last) { el.innerHTML = html; last = html; } };
}

// groups: [{ title, tip, sliders: [{ key, label, min, max, step, d, tip }] }]
// onInput(key) runs after S[key] is updated from the slider.
export function buildSliders(root, groups, S, onInput) {
  const els = {};
  for (const g of groups) {
    const div = document.createElement('div');
    div.className = 'group';
    div.innerHTML = `<h4><span data-tip="${g.tip ?? ''}">${g.title}</span></h4>`;
    for (const sl of g.sliders) {
      const row = document.createElement('label');
      row.className = 'srow';
      row.innerHTML = `<span class="k" data-tip="${sl.tip ?? sl.key}">${sl.label}</span>
        <input type="range" min="${sl.min}" max="${sl.max}" step="${sl.step}">
        <output></output>`;
      const input = row.querySelector('input');
      input.addEventListener('input', () => {
        S[sl.key] = parseFloat(input.value);
        onInput(sl.key);
        sync();
      });
      els[sl.key] = { input, out: row.querySelector('output'), d: sl.d };
      div.appendChild(row);
    }
    root.appendChild(div);
  }
  function sync() {
    for (const [key, { input, out, d }] of Object.entries(els)) {
      input.value = S[key];
      out.textContent = fmt(S[key], d);
    }
  }
  sync();
  return sync;
}

// Any element with data-tip="key" shows tips[key] = { title, body, formula?, live?(ctx) } on hover.
// getCtx() supplies the argument for live values.
export function initTooltips(tips, getCtx = () => null) {
  const tipEl = document.createElement('div');
  tipEl.className = 'tip';
  tipEl.hidden = true;
  document.body.appendChild(tipEl);

  function show(target, x, y) {
    const tip = target && tips[target.dataset.tip];
    if (!tip) { tipEl.hidden = true; return; }
    const live = tip.live ? `<span class="live">${tip.live(getCtx())}</span>` : '';
    const formula = tip.formula ? `<span class="f">${tip.formula}</span>` : '';
    tipEl.innerHTML = `<b>${tip.title}</b>${tip.body}${formula}${live}`;
    tipEl.hidden = false;
    const { offsetWidth: w, offsetHeight: h } = tipEl;
    const px = x + 14 + w > window.innerWidth - 8 ? x - w - 14 : x + 14;
    const py = y + 16 + h > window.innerHeight - 8 ? y - h - 12 : y + 16;
    tipEl.style.left = `${Math.max(8, px)}px`;
    tipEl.style.top = `${Math.max(8, py)}px`;
  }

  document.addEventListener('pointermove', (e) => show(e.target.closest?.('[data-tip]'), e.clientX, e.clientY));
  document.addEventListener('pointerleave', () => { tipEl.hidden = true; });
}

// Lab / Info tabs; returns a function telling whether the Lab is visible
export function initTabs(onShowLab) {
  const panels = { lab: document.getElementById('tab-lab'), info: document.getElementById('tab-info') };
  const buttons = document.querySelectorAll('[data-tab]');
  function show(name) {
    if (!panels[name]) name = 'lab';
    for (const [key, el] of Object.entries(panels)) el.hidden = key !== name;
    buttons.forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
    if (name === 'lab') onShowLab();
  }
  buttons.forEach((b) => b.addEventListener('click', () => {
    history.replaceState(null, '', b.dataset.tab === 'lab' ? location.pathname : '#info');
    show(b.dataset.tab);
  }));
  show(location.hash.slice(1));
  return () => !panels.lab.hidden;
}

// Nearest projected point within maxDist pixels of the mouse on an image canvas
export function pickOnCanvas(canvas, e, uvs, W, H, maxDist = 16) {
  const r = canvas.getBoundingClientRect();
  const u = (e.clientX - r.left) / r.width * W;
  const v = (e.clientY - r.top) / r.height * H;
  let best = null, bestD = maxDist;
  uvs.forEach((uv, i) => {
    if (!uv) return;
    const d = Math.hypot(uv[0] - u, uv[1] - v);
    if (d < bestD) { bestD = d; best = i; }
  });
  return { index: best, uv: [u, v] };
}
