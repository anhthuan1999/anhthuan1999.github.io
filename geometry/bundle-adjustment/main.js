// Chapter 5: bundle adjustment with Gauss–Newton / Levenberg–Marquardt
import { THREE, createViewer, CameraRig, setLines } from '../../shared/lib/rig.js';
import {
  DEG, add, sub, scale, norm, matVec, matMul, lookAtR, makeCamera, cameraFromRt, project,
  rodrigues, solveLinear, alignSimilarity, rng,
} from '../../shared/lib/math.js';
import { W, H, TARGET, POINTS, POINT_COLORS, MONO, drawBase, disc, cross2D } from '../../shared/lib/scene.js';
import { fmt, sci, htmlSetter, buildSliders, initTooltips, initTabs } from '../../shared/lib/ui.js';

const CAM_COLORS = ['#f5c542', '#4fd1c5', '#f472b6', '#7aa2ff'];
const N_CAMS = 4;
const EXTRA_POINTS = 16;
const STEP_MS = 650;      // time between iterations when running
const MOVE_MS = 400;      // duration of the animated update
const intr = { fx: 620, fy: 620, cx: W / 2, cy: H / 2 };

const S = {
  rot: 4, trans: 0.4, pts: 0.3, sigma: 0.5, seed: 1,
  gauge: true, residuals: true, truth: true, method: 'lm', playing: false,
};

// ---------------------------------------------------------------------------
// Ground truth: four cameras around the house, house points + random points
// ---------------------------------------------------------------------------
const GT_CAMS = [[20, 22], [62, 30], [108, 16], [150, 26]].map(([az, el]) => {
  const a = az * DEG, e = el * DEG;
  const C = add(TARGET, scale([Math.cos(e) * Math.cos(a), Math.sin(e), Math.cos(e) * Math.sin(a)], 6.2));
  return makeCamera(lookAtR(C, TARGET), C, intr);
});

const visibleInAll = (X) => GT_CAMS.every((c) => {
  const uv = project(c, X);
  return uv && uv[0] > 8 && uv[0] < W - 8 && uv[1] > 8 && uv[1] < H - 8;
});
const GT_POINTS = (() => {
  const r = rng(424242);
  const pts = POINTS.slice();
  let extra = 0;
  while (extra < EXTRA_POINTS) {
    const X = [r.uniform() * 4 - 2, r.uniform() * 2.2, r.uniform() * 4 - 2];
    if (visibleInAll(X)) { pts.push(X); extra++; }
  }
  return pts;
})();
const PT_COLORS = GT_POINTS.map((_, j) => POINT_COLORS[j] ?? '#9aa7b8');

// ---------------------------------------------------------------------------
// Problem: perturbed initial cameras and points + noisy observations
// ---------------------------------------------------------------------------
let P;

function makeProblem() {
  const r = rng(S.seed * 9973);
  const g3 = () => [r.gauss(), r.gauss(), r.gauss()];
  const cams = GT_CAMS.map((c, i) => {
    const w = g3(), dc = g3();
    if (i === 0) return { R: c.R, t: c.t };
    const R = matMul(rodrigues(scale(w, S.rot * DEG)), c.R);
    const C = add(c.C, scale(dc, S.trans));
    return { R, t: scale(matVec(R, C), -1) };
  });
  const pts = GT_POINTS.map((X) => add(X, scale(g3(), S.pts)));
  const obs = [];
  GT_CAMS.forEach((c, i) => GT_POINTS.forEach((X, j) => {
    const n = [r.gauss(), r.gauss()];
    const uv = project(c, X);
    if (uv) obs.push({ i, j, uv: [uv[0] + S.sigma * n[0], uv[1] + S.sigma * n[1]] });
  }));
  const state = { cams, pts };
  P = { initial: state, state, obs, lambda: 1e-3, iter: 0, history: [], anim: null, last: '', converged: false };
  P.history.push(rms(state));
}

// ---------------------------------------------------------------------------
// Residuals, Jacobian and one LM / GN iteration
// ---------------------------------------------------------------------------
function projectRt(R, t, X) {
  const Xc = add(matVec(R, X), t);
  const z = Math.max(Xc[2], 1e-3);
  return [intr.fx * Xc[0] / z + intr.cx, intr.fy * Xc[1] / z + intr.cy];
}

function residual(state, o) {
  const c = state.cams[o.i];
  const p = projectRt(c.R, c.t, state.pts[o.j]);
  return [p[0] - o.uv[0], p[1] - o.uv[1]];
}

const cost = (state) => P.obs.reduce((acc, o) => { const r = residual(state, o); return acc + r[0] ** 2 + r[1] ** 2; }, 0);
function rms(state) { return Math.sqrt(cost(state) / P.obs.length); }

// Parameter layout: 6 per free camera (δω, δt), then 3 per point
function layout() {
  const camOffset = [];
  let n = 0;
  for (let i = 0; i < N_CAMS; i++) {
    if (S.gauge && i === 0) camOffset.push(-1);
    else { camOffset.push(n); n += 6; }
  }
  const ptOffset = GT_POINTS.map((_, j) => n + 3 * j);
  return { camOffset, ptOffset, n: n + 3 * GT_POINTS.length, nCams: n };
}

const EPS = 1e-6;
const UNIT = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

function normalEquations(state) {
  const L = layout();
  const Hm = [...Array(L.n)].map(() => new Float64Array(L.n));
  const g = new Float64Array(L.n);
  for (const o of P.obs) {
    const c = state.cams[o.i], X = state.pts[o.j];
    const base = projectRt(c.R, c.t, X);
    const r = [base[0] - o.uv[0], base[1] - o.uv[1]];
    const cols = [], idx = [];
    if (L.camOffset[o.i] >= 0) {
      UNIT.forEach((e, k) => {
        const p = projectRt(matMul(rodrigues(scale(e, EPS)), c.R), c.t, X);
        cols.push([(p[0] - base[0]) / EPS, (p[1] - base[1]) / EPS]);
        idx.push(L.camOffset[o.i] + k);
      });
      UNIT.forEach((e, k) => {
        const p = projectRt(c.R, add(c.t, scale(e, EPS)), X);
        cols.push([(p[0] - base[0]) / EPS, (p[1] - base[1]) / EPS]);
        idx.push(L.camOffset[o.i] + 3 + k);
      });
    }
    UNIT.forEach((e, k) => {
      const p = projectRt(c.R, c.t, add(X, scale(e, EPS)));
      cols.push([(p[0] - base[0]) / EPS, (p[1] - base[1]) / EPS]);
      idx.push(L.ptOffset[o.j] + k);
    });
    for (let a = 0; a < idx.length; a++) {
      g[idx[a]] += cols[a][0] * r[0] + cols[a][1] * r[1];
      for (let b = 0; b < idx.length; b++) {
        Hm[idx[a]][idx[b]] += cols[a][0] * cols[b][0] + cols[a][1] * cols[b][1];
      }
    }
  }
  return { L, Hm, g };
}

function applyDelta(state, L, delta, s = 1) {
  const cams = state.cams.map((c, i) => {
    const off = L.camOffset[i];
    if (off < 0) return c;
    const dw = [0, 1, 2].map((k) => delta[off + k] * s);
    const dt = [0, 1, 2].map((k) => delta[off + 3 + k] * s);
    return { R: matMul(rodrigues(dw), c.R), t: add(c.t, dt) };
  });
  const pts = state.pts.map((X, j) => add(X, [0, 1, 2].map((k) => delta[L.ptOffset[j] + k] * s)));
  return { cams, pts };
}

function iterate(now) {
  if (P.converged) return;
  const { L, Hm, g } = normalEquations(P.state);
  const lam = S.method === 'lm' ? P.lambda : 0;
  const meanDiag = Hm.reduce((acc, row, k) => acc + row[k], 0) / L.n;
  const A = Hm.map((row, k) => {
    const r = Array.from(row);
    r[k] += lam * row[k] + 1e-9 * meanDiag;   // tiny ridge keeps gauge directions solvable
    return r;
  });
  const delta = solveLinear(A, Array.from(g, (v) => -v));
  const next = applyDelta(P.state, L, delta);
  const before = cost(P.state), after = cost(next);
  P.iter++;
  if (S.method === 'gn' || after < before) {
    P.anim = { from: P.state, L, delta, t0: now };
    P.state = next;
    P.lambda = Math.max(P.lambda / 3, 1e-7);
    P.last = `accepted, cost ${sci(before)} → ${sci(after)}`;
    if (before - after < 1e-9 * before) P.converged = true;
  } else {
    P.lambda *= 5;
    P.last = `rejected (cost would rise to ${sci(after)}), λ ↑`;
  }
  P.history.push(rms(P.state));
  if (P.iter >= 60) P.converged = true;
  if (P.converged) setPlaying(false);
}

// State shown on screen: interpolates the last accepted step for a smooth motion
function shownState(now) {
  if (!P.anim) return P.state;
  const s = Math.min(1, (now - P.anim.t0) / MOVE_MS);
  if (s >= 1) { P.anim = null; return P.state; }
  const e = 1 - (1 - s) ** 3;
  return applyDelta(P.anim.from, P.anim.L, P.anim.delta, e);
}

// ---------------------------------------------------------------------------
// 3D view
// ---------------------------------------------------------------------------
const v3 = createViewer(document.getElementById('view3d'), { position: [0.5, 8.5, 13], target: [0.6, 0.8, 1.6] });
const canvases = [0, 1, 2, 3].map((k) => {
  const c = document.getElementById(`img${k}`);
  c.width = W;
  c.height = H;
  return c;
});
const ctxs = canvases.map((c) => c.getContext('2d'));
const estRigs = canvases.map((c, k) => new CameraRig(v3, c, CAM_COLORS[k], { planeDepth: 1.0, farDepth: 1.0, axisLength: 0.4 }));
const gtRigs = GT_CAMS.map(() => new CameraRig(v3, document.createElement('canvas'), 0x56606e, { planeDepth: 1.0, farDepth: 1.0, axisLength: 0.0 }));
const extraGT = GT_POINTS.slice(POINTS.length).map((X) => {
  const m = v3.sphere(0x9aa7b8, 0.045);
  m.position.set(...X);
  return m;
});
const estMeshes = GT_POINTS.map(() => v3.sphere(0xffffff, 0.05));
const errLines = v3.dynLines(GT_POINTS.length + N_CAMS, new THREE.LineBasicMaterial({ color: 0xff5c5c, transparent: true, opacity: 0.7 }));

function update3D(state) {
  const cams = state.cams.map((c) => cameraFromRt(c.R, c.t, intr));
  cams.forEach((cam, k) => estRigs[k].update(cam, { plane: true, far: false }));
  GT_CAMS.forEach((cam, k) => {
    gtRigs[k].update(cam, { plane: false, far: false });
    gtRigs[k].frustum.visible = gtRigs[k].center.visible = gtRigs[k].axes.visible = S.truth;
  });
  extraGT.forEach((m) => { m.visible = S.truth; });
  v3.pointMeshes.forEach((m) => { m.visible = S.truth; });
  state.pts.forEach((X, j) => estMeshes[j].position.set(...X));
  const segs = state.pts.map((X, j) => [X, GT_POINTS[j]]);
  cams.forEach((cam, k) => segs.push([cam.C, GT_CAMS[k].C]));
  setLines(errLines, segs);
  errLines.visible = S.truth;
  return cams;
}

// ---------------------------------------------------------------------------
// Images: observation (dot), current reprojection (×), residual vector (red)
// ---------------------------------------------------------------------------
const rmsEls = [0, 1, 2, 3].map((k) => document.getElementById(`rms${k}`));

function drawView(k, state) {
  const ctx = ctxs[k];
  drawBase(ctx, GT_CAMS[k], { edgeStyle: 'rgba(220,229,240,0.3)' });
  const c = state.cams[k];
  let sum = 0, n = 0;
  for (const o of P.obs) {
    if (o.i !== k) continue;
    const p = projectRt(c.R, c.t, state.pts[o.j]);
    sum += (p[0] - o.uv[0]) ** 2 + (p[1] - o.uv[1]) ** 2;
    n++;
    disc(ctx, o.uv, 4.5, PT_COLORS[o.j]);
    if (S.residuals) {
      ctx.strokeStyle = '#ff5c5c';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(...o.uv);
      ctx.lineTo(...p);
      ctx.stroke();
    }
    cross2D(ctx, p, 4, '#ffffff', 1.5);
  }
  ctx.font = MONO;
  ctx.fillStyle = '#8b97a8';
  ctx.fillText('● observed   × reprojected   — residual', 10, H - 12);
  rmsEls[k].textContent = `RMS ${fmt(Math.sqrt(sum / Math.max(n, 1)), 2)} px`;
}

// ---------------------------------------------------------------------------
// Panels: status, cost chart, sparsity pattern
// ---------------------------------------------------------------------------
const setStatus = htmlSetter(document.getElementById('status'));

function errors3D(state, cams) {
  // compare after the best similarity alignment: the gauge is not observable
  const est = [...state.pts, ...cams.map((c) => c.C)];
  const gt = [...GT_POINTS, ...GT_CAMS.map((c) => c.C)];
  const al = alignSimilarity(est, gt);
  const pe = state.pts.map((X, j) => norm(sub(al.apply(X), GT_POINTS[j])));
  const ce = cams.map((c, k) => norm(sub(al.apply(c.C), GT_CAMS[k].C)));
  const rmsOf = (a) => Math.sqrt(a.reduce((s, e) => s + e * e, 0) / a.length);
  return { pts: rmsOf(pe), cams: rmsOf(ce), scale: al.s };
}

function updateStatus(state, cams) {
  const L = layout();
  const e = errors3D(state, cams);
  const r = rms(state);
  setStatus(`<span data-tip="iteration">iteration</span> <b>${P.iter}</b>   ${S.method === 'lm' ? `<span data-tip="lambda">λ</span> = ${sci(P.lambda)}` : 'Gauss–Newton'}${P.converged ? '   <span class="good">converged</span>' : ''}
<span data-tip="rmsReproj">RMS reprojection</span> = <b class="${r < 2 * S.sigma + 0.2 ? 'good' : 'bad'}">${fmt(r, 3)} px</b>   (noise σ = ${fmt(S.sigma, 2)})
<span data-tip="error3d">3D error</span>: points ${fmt(e.pts, 3)}   cameras ${fmt(e.cams, 3)}
${P.last || 'press Run or Step'}
<span data-tip="sizes">${L.n} unknowns, ${2 * P.obs.length} residuals</span>`);
}

const chart = document.getElementById('chart');
const cctx = chart.getContext('2d');

function drawChart() {
  const rect = chart.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  if (chart.width !== Math.round(rect.width * dpr)) {
    chart.width = Math.round(rect.width * dpr);
    chart.height = Math.round(rect.height * dpr);
  }
  const w = chart.width / dpr, h = chart.height / dpr;
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.clearRect(0, 0, w, h);
  const pad = { l: 40, r: 8, t: 8, b: 18 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const vals = P.history.map((v) => Math.log10(Math.max(v, 1e-4)));
  const hi = Math.ceil(Math.max(...vals, 1)), lo = Math.floor(Math.min(...vals, Math.log10(Math.max(S.sigma, 0.01)) - 0.3));
  const y = (v) => pad.t + ph * (hi - v) / (hi - lo);
  const nx = Math.max(10, P.history.length);
  const x = (i) => pad.l + pw * i / (nx - 1);

  cctx.font = '11px JetBrains Mono, monospace';
  cctx.fillStyle = '#8b97a8';
  for (let d = lo; d <= hi; d++) {
    cctx.fillText(d >= 0 ? `${10 ** d}` : `1e${d}`, 2, y(d) + 4);
    cctx.strokeStyle = '#1c2430';
    cctx.beginPath(); cctx.moveTo(pad.l, y(d)); cctx.lineTo(pad.l + pw, y(d)); cctx.stroke();
  }
  cctx.fillText('RMS px (log) vs iteration', pad.l, h - 4);
  if (S.sigma > 0) {
    cctx.strokeStyle = 'rgba(255,255,255,0.5)';
    cctx.setLineDash([4, 4]);
    cctx.beginPath(); cctx.moveTo(pad.l, y(Math.log10(S.sigma))); cctx.lineTo(pad.l + pw, y(Math.log10(S.sigma))); cctx.stroke();
    cctx.setLineDash([]);
    cctx.fillStyle = 'rgba(255,255,255,0.6)';
    cctx.fillText('σ', pad.l + pw - 12, y(Math.log10(S.sigma)) - 4);
  }
  cctx.strokeStyle = '#f5c542';
  cctx.lineWidth = 2;
  cctx.beginPath();
  vals.forEach((v, i) => (i ? cctx.lineTo(x(i), y(v)) : cctx.moveTo(x(i), y(v))));
  cctx.stroke();
  cctx.fillStyle = '#f5c542';
  vals.forEach((v, i) => { cctx.beginPath(); cctx.arc(x(i), y(v), 2.5, 0, Math.PI * 2); cctx.fill(); });
}

const spy = document.getElementById('spy');
let spyKey = '';
function drawSpy() {
  const key = `${S.gauge}`;
  if (key === spyKey) return;
  spyKey = key;
  const { L, Hm } = normalEquations(P.state);
  spy.width = spy.height = L.n;
  const sctx = spy.getContext('2d');
  const img = sctx.createImageData(L.n, L.n);
  for (let a = 0; a < L.n; a++) {
    for (let b = 0; b < L.n; b++) {
      const k = 4 * (a * L.n + b);
      const nz = Hm[a][b] !== 0;
      const camBlock = a < L.nCams && b < L.nCams;
      const ptBlock = a >= L.nCams && b >= L.nCams;
      const col = !nz ? [18, 24, 35] : camBlock ? [245, 197, 66] : ptBlock ? [122, 162, 255] : [180, 190, 205];
      img.data.set([...col, 255], k);
    }
  }
  sctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const GROUPS = [
  { title: 'Initial error (cameras 2–4, points)', tip: 'init', sliders: [
    { key: 'rot', label: 'rot°', min: 0, max: 10, step: 0.1, d: 1, tip: 'rot' },
    { key: 'trans', label: 'pos', min: 0, max: 1.5, step: 0.01, d: 2, tip: 'trans' },
    { key: 'pts', label: 'pts', min: 0, max: 1, step: 0.01, d: 2, tip: 'ptsNoise' },
  ] },
  { title: 'Measurements', tip: 'sigma', sliders: [
    { key: 'sigma', label: 'σ px', min: 0, max: 3, step: 0.05, d: 2, tip: 'sigma' },
  ] },
];
buildSliders(document.getElementById('sliders'), GROUPS, S, () => { setPlaying(false); makeProblem(); });

document.querySelectorAll('[data-toggle]').forEach((el) => {
  el.addEventListener('change', () => {
    S[el.dataset.toggle] = el.checked;
    if (el.dataset.toggle === 'gauge') resetOptimizer();
  });
});

const methodButtons = document.querySelectorAll('[data-method]');
function setMethod(m) {
  S.method = m;
  methodButtons.forEach((b) => b.classList.toggle('active', b.dataset.method === m));
}
methodButtons.forEach((b) => b.addEventListener('click', () => { setMethod(b.dataset.method); resetOptimizer(); }));
setMethod(S.method);

function resetOptimizer() {
  setPlaying(false);
  Object.assign(P, { state: P.initial, lambda: 1e-3, iter: 0, history: [rms(P.initial)], anim: null, last: '', converged: false });
}

const playBtn = document.getElementById('play');
function setPlaying(p) {
  S.playing = p;
  playBtn.textContent = p ? '❚❚ Pause' : '▶ Run';
  playBtn.classList.toggle('active', p);
}
playBtn.addEventListener('click', () => {
  if (P.converged) resetOptimizer();
  setPlaying(!S.playing);
});
document.getElementById('step').addEventListener('click', () => { setPlaying(false); iterate(performance.now()); });
document.getElementById('reset').addEventListener('click', resetOptimizer);
document.getElementById('newProblem').addEventListener('click', () => { S.seed++; setPlaying(false); makeProblem(); });

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------
const TIPS = {
  cost: {
    title: 'Bundle adjustment cost',
    body: 'Sum over every camera i and point j it sees of the squared pixel distance between where X_j projects and where it was detected. Minimized over all camera poses and all points at once.',
  },
  estCams: { title: 'Estimated cameras', body: 'The cameras being optimized. Camera 1 is fixed to the truth when the gauge is fixed; cameras 2–4 start with errors in rotation and position.' },
  gtCams: { title: 'Ground truth', body: 'Grey frusta are the true cameras; colored house points and grey points are the true 3D points. Red segments connect each estimate to its truth.' },
  estPts: { title: 'Estimated points', body: 'Current 3D point estimates (white). They start perturbed by the "pts" amount.' },
  error3d: { title: '3D error', body: 'RMS distance from estimated points / camera centers to the truth, after aligning with the best similarity transform (rotation, translation, scale) because the gauge cannot be observed.' },
  optimizer: { title: 'Optimizer state', body: 'One iteration = build JᵀJ and Jᵀr from all residuals, solve for the step δ, try it.' },
  sparsity: { title: 'Sparsity of JᵀJ', body: 'Each colored pixel is a non-zero entry. Yellow: camera–camera, blue: point–point (3×3 blocks on the diagonal), grey: camera–point coupling. Real problems have millions of points, so this structure is essential.' },
  view: { title: 'Camera image', body: 'Dots: detections (fixed, with noise). ×: where the current estimate projects. Red: residual vectors — BA minimizes the sum of their squared lengths.' },
  lm: { title: 'Levenberg–Marquardt', body: 'Damped Gauss–Newton. A step that increases the cost is rejected and λ is increased (smaller, more cautious steps); a good step decreases λ.', formula: '(JᵀJ + λ diag(JᵀJ)) δ = −Jᵀr' },
  gn: { title: 'Gauss–Newton', body: 'Undamped: always takes the step. Fast near the minimum, can diverge from a poor start.', formula: '(JᵀJ) δ = −Jᵀr' },
  play: { title: 'Run', body: 'Iterate until the cost stops decreasing (or 60 iterations).' },
  step: { title: 'Step', body: 'One iteration.' },
  reset: { title: 'Reset', body: 'Back to the initial (perturbed) estimate, same problem.' },
  newProblem: { title: 'New problem', body: 'New random perturbations and noise.' },
  gauge: { title: 'Gauge fixing', body: 'Rotating, translating or scaling the whole reconstruction does not change any residual: 7 unobservable degrees of freedom. Fixing camera 1 removes 6 of them; LM damping handles the remaining scale.' },
  residuals: { title: 'Residual vectors', body: 'Draw the 2D error of every observation in the images.' },
  iteration: { title: 'Iteration', body: 'Counts accepted and rejected steps.' },
  lambda: { title: 'λ — damping', body: 'Large λ: short steps along the gradient. Small λ: Gauss–Newton steps.' },
  rmsReproj: { title: 'RMS reprojection error', body: 'Square root of the mean squared residual length, in pixels. At the optimum it is about the noise level σ: you cannot fit the data better than its noise.' },
  sizes: { title: 'Problem size', body: '6 unknowns per free camera (3 rotation, 3 translation) plus 3 per point; 2 residuals per observation.' },
  init: { title: 'Initial error', body: 'How far the starting estimate is from the truth. BA is a local method: with a bad enough start it falls into a wrong local minimum.' },
  rot: { title: 'Rotation error', body: 'Std. dev. (degrees) of the random rotation applied to cameras 2–4.' },
  trans: { title: 'Position error', body: 'Std. dev. of the random shift of camera centers 2–4 (the house is 1.2 wide).' },
  ptsNoise: { title: 'Point error', body: 'Std. dev. of the random shift of every 3D point.' },
  sigma: { title: 'σ — detection noise', body: 'Gaussian pixel noise on every observation. Sets the floor of the reprojection error.' },
};
initTooltips(TIPS);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
makeProblem();
const labVisible = initTabs(v3.resize);
let lastIter = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (!labVisible()) return;
  if (S.playing && now - lastIter > STEP_MS) {
    lastIter = now;
    iterate(now);
  }
  const state = shownState(now);
  update3D(state);
  for (let k = 0; k < N_CAMS; k++) drawView(k, state);
  updateStatus(P.state, P.state.cams.map((c) => cameraFromRt(c.R, c.t, intr)));
  drawChart();
  drawSpy();
  v3.render();
}
requestAnimationFrame(frame);
