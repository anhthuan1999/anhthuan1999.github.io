// Gaussian Splatting, chapter 2: sorting and alpha-blending many splats
import { THREE, createViewer, CameraRig, setLines } from '../../shared/lib/rig.js';
import { DEG, add, scale, eulerToR, lookAtR, makeCamera, rayDir } from '../../shared/lib/math.js';
import { W, H, MONO } from '../../shared/lib/scene.js';
import { fmt, htmlSetter, buildSliders, initTooltips, initTabs } from '../../shared/lib/ui.js';
import { projectGaussian, strokeEllipse, hexToRgb } from '../../shared/lib/gaussian.js';

const CENTER = [0, 0.8, 0];
const TILE = 16;
const DS = 2;                         // render at half resolution, then upscale
const RW = W / DS, RH = H / DS;
const BG = [11, 15, 22];
const T_MIN = 1e-4;

// ---------------------------------------------------------------------------
// The scene: a handful of Gaussians (position, scales, rotation in degrees, color, opacity)
// ---------------------------------------------------------------------------
const g = (name, mu, s, rot, color, opacity) => ({
  name, mu, scale: s, R: eulerToR(rot[0] * DEG, rot[1] * DEG, rot[2] * DEG), color: hexToRgb(color), hex: color, opacity,
});
const SCENE = [
  g('ground', [0, 0, 0], [2.4, 0.02, 2.4], [0, 0, 0], '#5d7f52', 0.95),
  g('trunk A', [-1.2, 0.45, -0.7], [0.07, 0.45, 0.07], [0, 0, 0], '#8b5a2b', 0.95),
  g('leaves A1', [-1.2, 1.15, -0.7], [0.42, 0.36, 0.42], [0, 20, 0], '#3f9b4f', 0.85),
  g('leaves A2', [-1.05, 1.5, -0.6], [0.28, 0.24, 0.28], [0, 0, 0], '#5fbf62', 0.85),
  g('trunk B', [1.3, 0.35, -1.1], [0.06, 0.35, 0.06], [0, 0, 0], '#7a4d24', 0.95),
  g('leaves B', [1.3, 0.95, -1.1], [0.3, 0.42, 0.3], [0, 0, 0], '#2f8a5a', 0.85),
  g('ball', [0.45, 0.32, 0.55], [0.3, 0.3, 0.3], [0, 0, 0], '#e05050', 0.95),
  g('car', [-0.4, 0.22, 1.25], [0.55, 0.17, 0.25], [0, 20, 0], '#4f7fe0', 0.95),
  g('roof', [-0.4, 0.42, 1.25], [0.3, 0.1, 0.2], [0, 20, 0], '#7aa2ff', 0.9),
  g('glass', [0.25, 0.85, -0.15], [0.6, 0.45, 0.02], [0, -15, 0], '#b18cff', 0.4),
  g('sun', [1.6, 2.3, -2.2], [0.35, 0.35, 0.35], [0, 0, 0], '#ffd040', 0.85),
  g('rock', [1.1, 0.12, 0.9], [0.25, 0.12, 0.2], [10, 30, 0], '#9aa7b8', 0.95),
  g('flower 1', [0.9, 0.08, 1.6], [0.06, 0.06, 0.06], [0, 0, 0], '#ff7ad9', 0.95),
  g('flower 2', [1.4, 0.08, 1.3], [0.06, 0.06, 0.06], [0, 0, 0], '#ffe66b', 0.95),
  g('flower 3', [-1.6, 0.08, 0.6], [0.06, 0.06, 0.06], [0, 0, 0], '#ff9f43', 0.95),
  g('bush', [-1.7, 0.25, 0.2], [0.35, 0.22, 0.3], [0, 40, 0], '#4caf6d', 0.8),
];

const DEFAULTS = { az: 35, el: 22, dist: 5.2, f: 560, scaleMod: 1, opacityMod: 1, k: SCENE.length };
const S = {
  ...DEFAULTS,
  sort: true, early: true, outlines: false, heat: false, plane: true,
  hoverPx: null, anim: null, animStart: 0, animInit: null,
};

function deriveCamera() {
  const az = S.az * DEG, el = S.el * DEG;
  const C = add(CENTER, scale([Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], S.dist));
  return makeCamera(lookAtR(C, CENTER), C, { fx: S.f, fy: S.f, cx: W / 2, cy: H / 2 });
}

const gaussians = () => SCENE.map((s) => ({ ...s, scale: s.scale.map((v) => v * S.scaleMod), opacity: Math.min(1, s.opacity * S.opacityMod) }));

// ---------------------------------------------------------------------------
// Rasterizer (CPU version of the 3DGS tile renderer)
// ---------------------------------------------------------------------------
// Project, cull, order, bin into tiles. Returns the draw list and per-tile lists.
function prepare(cam, gs) {
  const splats = [];
  gs.forEach((gg, id) => {
    const sp = projectGaussian(cam, gg);
    if (sp) splats.push({ id, ...sp, color: gg.color, opacity: gg.opacity });
  });
  if (S.sort) splats.sort((a, b) => a.depth - b.depth);
  splats.forEach((sp, rank) => { sp.rank = rank; });
  const drawn = splats.slice(0, Math.round(S.k));

  const tx = Math.ceil(W / TILE), ty = Math.ceil(H / TILE);
  const tiles = [...Array(tx * ty)].map(() => []);
  for (const sp of drawn) {
    const r = sp.radius;
    const x0 = Math.max(0, Math.floor((sp.uv[0] - r) / TILE)), x1 = Math.min(tx - 1, Math.floor((sp.uv[0] + r) / TILE));
    const y0 = Math.max(0, Math.floor((sp.uv[1] - r) / TILE)), y1 = Math.min(ty - 1, Math.floor((sp.uv[1] + r) / TILE));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles[y * tx + x].push(sp);
  }
  return { splats, drawn, tiles, tx, ty, culled: gs.length - splats.length };
}

// Front-to-back compositing at pixel p over a list of splats; optionally records every step
function shade(p, list, record) {
  let T = 1;
  const rgb = [0, 0, 0];
  for (const sp of list) {
    const dx = p[0] - sp.uv[0], dy = p[1] - sp.uv[1];
    const power = -0.5 * (sp.conic[0] * dx * dx + 2 * sp.conic[1] * dx * dy + sp.conic[2] * dy * dy);
    if (power > 0) continue;
    const a = Math.min(0.99, sp.opacity * Math.exp(power));
    if (a < 1 / 255) continue;
    if (S.early && T * (1 - a) < T_MIN) {
      if (record) record.push({ sp, a, T, w: 0, stopped: true });
      break;
    }
    const w = a * T;
    rgb[0] += sp.color[0] * w; rgb[1] += sp.color[1] * w; rgb[2] += sp.color[2] * w;
    if (record) record.push({ sp, a, T, w });
    T *= 1 - a;
  }
  return { rgb, T };
}

const lowCanvas = document.createElement('canvas');
lowCanvas.width = RW;
lowCanvas.height = RH;
const lowCtx = lowCanvas.getContext('2d');
const lowImg = lowCtx.createImageData(RW, RH);

function rasterize(prep) {
  for (let y = 0; y < RH; y++) {
    for (let x = 0; x < RW; x++) {
      const p = [(x + 0.5) * DS, (y + 0.5) * DS];
      const list = prep.tiles[Math.floor(p[1] / TILE) * prep.tx + Math.floor(p[0] / TILE)];
      const { rgb, T } = shade(p, list, null);
      const k = 4 * (y * RW + x);
      lowImg.data[k] = rgb[0] * 255 + T * BG[0];
      lowImg.data[k + 1] = rgb[1] * 255 + T * BG[1];
      lowImg.data[k + 2] = rgb[2] * 255 + T * BG[2];
      lowImg.data[k + 3] = 255;
    }
  }
  lowCtx.putImageData(lowImg, 0, 0);
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
const imgCanvas = document.getElementById('img');
imgCanvas.width = W;
imgCanvas.height = H;
const ctx = imgCanvas.getContext('2d');

function draw2D(prep, record) {
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(lowCanvas, 0, 0, W, H);

  if (S.heat) {
    const max = Math.max(1, ...prep.tiles.map((t) => t.length));
    prep.tiles.forEach((t, i) => {
      if (!t.length) return;
      const x = (i % prep.tx) * TILE, y = Math.floor(i / prep.tx) * TILE;
      ctx.fillStyle = `rgba(255,92,92,${0.12 + 0.6 * t.length / max})`;
      ctx.fillRect(x, y, TILE, TILE);
    });
    ctx.fillStyle = '#fff';
    ctx.font = '10px JetBrains Mono, monospace';
    prep.tiles.forEach((t, i) => {
      if (t.length) ctx.fillText(String(t.length), (i % prep.tx) * TILE + 2, Math.floor(i / prep.tx) * TILE + 11);
    });
  }

  if (S.outlines) {
    for (const sp of prep.drawn) strokeEllipse(ctx, sp.uv, sp.cov, 2, 'rgba(255,255,255,0.55)', 1);
  }

  if (S.hoverPx) {
    for (const r of record ?? []) if (r.w > 0.02) strokeEllipse(ctx, r.sp.uv, r.sp.cov, 2, '#fff', 1.5, [4, 4]);
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.strokeRect(S.hoverPx[0] - 4, S.hoverPx[1] - 4, 8, 8);
    const tx0 = Math.floor(S.hoverPx[0] / TILE) * TILE, ty0 = Math.floor(S.hoverPx[1] / TILE) * TILE;
    ctx.strokeStyle = 'rgba(245,197,66,0.9)';
    ctx.lineWidth = 1;
    ctx.strokeRect(tx0 + 0.5, ty0 + 0.5, TILE - 1, TILE - 1);
  }
}

// ---------------------------------------------------------------------------
// 3D view
// ---------------------------------------------------------------------------
const v3 = createViewer(document.getElementById('view3d'), { position: [6.5, 5, 6.5], target: [0.6, 0.6, 0.8], house: false });
const rig = new CameraRig(v3, imgCanvas, 0xf5c542, { planeDepth: 1.0, farDepth: 7 });
const ellGeo = new THREE.SphereGeometry(1, 32, 20);
const basis = new THREE.Matrix4();
const meshes = SCENE.map((s) => {
  const m = new THREE.Mesh(ellGeo, new THREE.MeshBasicMaterial({ color: s.hex, transparent: true, depthWrite: false }));
  const cols = [0, 1, 2].map((j) => new THREE.Vector3(s.R[j], s.R[3 + j], s.R[6 + j]));
  basis.makeBasis(cols[0], cols[1], cols[2]);
  m.quaternion.setFromRotationMatrix(basis);
  m.position.set(...s.mu);
  v3.scene.add(m);
  return m;
});
const pixelRay = v3.dynLines(1, new THREE.LineBasicMaterial({ color: 0xffffff }));

function update3D(cam, gs, prep, record) {
  rig.update(cam, { plane: S.plane, far: false });
  const drawnIds = new Set(prep.drawn.map((sp) => sp.id));
  const hit = record ? new Set(record.filter((r) => r.w > 0.02).map((r) => r.sp.id)) : null;
  meshes.forEach((m, i) => {
    m.scale.set(...gs[i].scale);
    const base = drawnIds.has(i) ? 0.25 + 0.5 * gs[i].opacity : 0.06;
    m.material.opacity = hit && !hit.has(i) ? base * 0.3 : base;
  });
  pixelRay.visible = S.hoverPx !== null;
  if (S.hoverPx) setLines(pixelRay, [[cam.C, add(cam.C, scale(rayDir(cam, ...S.hoverPx), 12))]]);
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
const setStats = htmlSetter(document.getElementById('stats'));
const setPixel = htmlSetter(document.getElementById('pixel'));

function updatePanels(prep, record, result) {
  const counts = prep.tiles.map((t) => t.length).filter((n) => n > 0);
  const avg = counts.reduce((a, b) => a + b, 0) / Math.max(1, counts.length);
  setStats(`${prep.drawn.length}/${SCENE.length} splats drawn, ${prep.culled} culled (behind camera)
<span data-tip="heat">splats per non-empty tile</span>: avg ${fmt(avg, 1)}, max ${Math.max(0, ...counts)}   ${S.sort ? '' : '<span class="bad">unsorted!</span>'}`);

  if (!S.hoverPx) {
    setPixel('<div class="readout">Hover the rendered image.</div>');
    return;
  }
  const toHex = (c) => `rgb(${c.map((v) => Math.round(Math.min(1, v) * 255)).join(',')})`;
  const rows = record.map((r) => `<tr>
      <td><span class="sw" style="background:${toHex(r.sp.color)}"></span>${SCENE[r.sp.id].name}</td>
      <td>${fmt(r.sp.depth, 2)}</td><td>${fmt(r.a, 3)}</td><td>${fmt(r.T, 3)}</td>
      <td><div class="bar"><i style="width:${Math.round(100 * r.w)}%;background:${toHex(r.sp.color)}"></i></div>${r.stopped ? '<span class="dim">stop</span>' : fmt(r.w, 3)}</td></tr>`).join('');
  const final = result.rgb.map((v, i) => v + result.T * BG[i] / 255);
  setPixel(`<table class="cmp px">
    <tr><th>splat</th><th><span data-tip="depth">depth</span></th><th><span data-tip="alpha">α</span></th><th><span data-tip="trans">T</span></th><th><span data-tip="weight">α·T</span></th></tr>
    ${rows || '<tr><td colspan="5" class="dim">no splat covers this pixel</td></tr>'}
  </table>
  <div class="readout" style="margin-top:8px">pixel ${fmt(S.hoverPx[0], 0)}, ${fmt(S.hoverPx[1], 0)}   remaining <span data-tip="trans">T</span> = ${fmt(result.T, 3)} → background
final color <span class="sw" style="background:${toHex(final)};width:22px;border-radius:3px"></span> ${toHex(final)}</div>`);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const GROUPS = [
  { title: 'Camera', tip: 'camera', sliders: [
    { key: 'az', label: 'az', min: -180, max: 180, step: 0.5, d: 1, tip: 'orbit' },
    { key: 'el', label: 'el', min: -5, max: 80, step: 0.5, d: 1, tip: 'orbit' },
    { key: 'dist', label: 'dist', min: 1.5, max: 12, step: 0.01, d: 2, tip: 'dist' },
    { key: 'f', label: 'f', min: 200, max: 1400, step: 1, d: 0, tip: 'f' },
  ] },
  { title: 'Gaussians', tip: 'ellipsoids', sliders: [
    { key: 'scaleMod', label: 'scale', min: 0.05, max: 2, step: 0.01, d: 2, tip: 'scaleMod' },
    { key: 'opacityMod', label: 'opac', min: 0, max: 1, step: 0.01, d: 2, tip: 'opacityMod' },
    { key: 'k', label: 'k', min: 0, max: SCENE.length, step: 1, d: 0, tip: 'k' },
  ] },
];
const syncSliders = buildSliders(document.getElementById('sliders'), GROUPS, S, () => stopAnim());

document.querySelectorAll('[data-toggle]').forEach((el) => {
  el.addEventListener('change', () => { S[el.dataset.toggle] = el.checked; });
});
document.getElementById('reset').addEventListener('click', () => {
  stopAnim();
  Object.assign(S, DEFAULTS);
  syncSliders();
});

const animButtons = document.querySelectorAll('[data-anim]');
animButtons.forEach((b) => b.addEventListener('click', () => {
  if (S.anim === b.dataset.anim) stopAnim();
  else startAnim(b.dataset.anim);
}));
const clock = new THREE.Clock();
function startAnim(name) {
  S.anim = name;
  S.animStart = clock.getElapsedTime();
  S.animInit = { az: S.az };
  animButtons.forEach((b) => b.classList.toggle('active', b.dataset.anim === name));
}
function stopAnim() {
  if (S.anim === 'build') S.k = SCENE.length;
  S.anim = null;
  animButtons.forEach((b) => b.classList.remove('active'));
}
function stepAnim(time) {
  const k = time - S.animStart;
  if (S.anim === 'orbit') S.az = ((S.animInit.az + 20 * k + 540) % 360) - 180;
  else if (S.anim === 'build') S.k = Math.min(SCENE.length, Math.floor(k / 0.7) % (SCENE.length + 3));
}

imgCanvas.addEventListener('pointermove', (e) => {
  const r = imgCanvas.getBoundingClientRect();
  S.hoverPx = [Math.floor((e.clientX - r.left) / r.width * W) + 0.5, Math.floor((e.clientY - r.top) / r.height * H) + 0.5];
});
imgCanvas.addEventListener('pointerleave', () => { S.hoverPx = null; });

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------
const TIPS = {
  blend: {
    title: 'Front-to-back α-blending',
    body: 'Each splat adds its color weighted by its opacity at the pixel times the light that still gets through the splats in front of it.',
    formula: 'C = Σᵢ cᵢ αᵢ Tᵢ,  Tᵢ = Π_{j<i} (1 − αⱼ)',
  },
  ellipsoids: { title: 'The scene', body: `${SCENE.length} hand-placed Gaussians (a real 3DGS scene has 10⁵–10⁷). Drawn as 1σ ellipsoids; brightness follows opacity.` },
  camera: { title: 'Camera', body: 'Orbits around the scene. Its image plane shows the rendered image.' },
  pixelRay: { title: 'Pixel ray', body: 'The viewing ray of the hovered pixel. Gaussians that contribute to it stay bright; the others fade.' },
  image: { title: 'Rendered image', body: 'Rasterized on the CPU with the 3DGS algorithm (project, sort, bin into tiles, blend front to back), at half resolution.' },
  breakdown: { title: 'Pixel breakdown', body: 'Every splat that touches the hovered pixel, in blending order. The bar is its weight α·T in the final color.' },
  depth: { title: 'Depth', body: 'Camera-space z of the Gaussian center: the sort key.' },
  alpha: { title: 'α', body: 'Opacity of this splat at this pixel: o · exp(−½ dᵀΣ\'⁻¹d), capped at 0.99.' },
  trans: { title: 'T — transmittance', body: 'Fraction of light that passed all splats in front. Starts at 1, multiplied by (1 − α) after each splat. What is left at the end shows the background.' },
  weight: { title: 'Weight α·T', body: 'How much this splat\'s color counts in the pixel. The weights plus the final T sum to 1.' },
  sort: { title: 'Sort by depth', body: 'Off: splats are blended in the order they are stored. The ground comes first, so it is treated as being in front of everything.' },
  early: { title: 'Early termination', body: 'Stop a pixel once T < 10⁻⁴. The rest cannot change it visibly.' },
  outlines: { title: 'Splat outlines', body: '2σ ellipse of every drawn splat.' },
  heat: { title: 'Splats per tile', body: 'Number of splats in each 16×16 tile\'s list: the work a GPU thread block does for that tile.' },
  imagePlane: { title: 'Image plane', body: 'The rendered image drawn in front of the camera in the 3D view.' },
  orbit: { title: 'Camera orbit', body: 'Azimuth and elevation around the scene center.' },
  dist: { title: 'Distance', body: 'Camera distance to the scene center.' },
  f: { title: 'Focal length', body: 'In pixels.' },
  scaleMod: { title: 'Scale modifier', body: 'Multiply all scales — like the "scaling modifier" in the official 3DGS viewer. Small values reveal the individual Gaussians.' },
  opacityMod: { title: 'Opacity multiplier', body: 'Multiply all opacities. At 0 the image is just background.' },
  k: { title: 'Splats drawn', body: 'Only the first k splats in blending order are drawn: with sorting on, the k nearest.' },
  animOrbit: { title: 'Orbit camera', body: 'The depth order changes as the camera moves; with sorting off the errors become obvious.' },
  animBuild: { title: 'Build up', body: 'Add splats one at a time in blending order (nearest first), as a pixel would see them.' },
};
initTooltips(TIPS);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const labVisible = initTabs(v3.resize);

function frame() {
  requestAnimationFrame(frame);
  if (!labVisible()) return;
  if (S.anim) { stepAnim(clock.getElapsedTime()); syncSliders(); }
  const cam = deriveCamera();
  const gs = gaussians();
  const prep = prepare(cam, gs);
  rasterize(prep);
  let record = null, result = null;
  if (S.hoverPx) {
    record = [];
    const list = prep.tiles[Math.floor(S.hoverPx[1] / TILE) * prep.tx + Math.floor(S.hoverPx[0] / TILE)] ?? [];
    result = shade(S.hoverPx, list, record);
  }
  draw2D(prep, record);
  update3D(cam, gs, prep, record);
  updatePanels(prep, record, result);
  v3.render();
}
requestAnimationFrame(frame);
