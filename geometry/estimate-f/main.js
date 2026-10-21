// Chapter 4: estimating F from noisy matches — 8-point, normalization, RANSAC
import {
  lookAtR, makeCamera, project, fundamental, frobNormalize, transpose, matVec, matTVec, rows3,
  eightPoint, epiDist, nullVector3, rng,
} from '../../shared/lib/math.js';
import { W, H, TARGET, POINTS, MONO, drawBase, disc, ring, drawLine, drawEpipole } from '../../shared/lib/scene.js';
import { fmt, sci, matHTML, htmlSetter, buildSliders, initTooltips, initTabs, pickOnCanvas } from '../../shared/lib/ui.js';

const EST_COLOR = '#f5c542';
const INLIER_COLOR = '#5cff8a';
const MATCH_COLOR = '#9fb3c8';
const OUTLIER_COLOR = '#ff5c5c';
const MAX_CANDIDATES = 260;

const S = {
  n: 60, sigma: 1, outliers: 25, tau: 2, iters: 150, seed: 1,
  method: 'ransac', hover: null, playing: true,
};

const intr = { fx: 620, fy: 620, cx: W / 2, cy: H / 2 };
const cams = [[-2.6, 1.8, 4.6], [3.0, 2.4, 3.6]].map((C) => makeCamera(lookAtR(C, TARGET), C, intr));
const F_TRUE = frobNormalize(fundamental(cams[0], cams[1]));

// ---------------------------------------------------------------------------
// Data: matches with pixel noise and a fraction of wrong matches
// ---------------------------------------------------------------------------
const inImage = (uv) => uv && uv[0] >= 4 && uv[0] <= W - 4 && uv[1] >= 4 && uv[1] <= H - 4;

let matches = [];
function makeData() {
  // the random stream does not depend on n, σ or the outlier ratio, so sliders change the data smoothly
  const r = rng(S.seed * 104729);
  const candidates = [];
  for (let i = 0; i < MAX_CANDIDATES; i++) {
    const X = i < POINTS.length ? POINTS[i] : [r.uniform() * 5 - 2.5, r.uniform() * 2.4, r.uniform() * 5 - 2.5];
    candidates.push({
      X, n: [r.gauss(), r.gauss(), r.gauss(), r.gauss()], u: r.uniform(), wrong: [r.uniform() * W, r.uniform() * H],
    });
  }
  matches = candidates
    .map((c) => ({ ...c, x1t: project(cams[0], c.X), x2t: project(cams[1], c.X) }))
    .filter((c) => inImage(c.x1t) && inImage(c.x2t))
    .slice(0, S.n)
    .map((c) => {
      const outlier = c.u < S.outliers / 100;
      return {
        x1t: c.x1t, x2t: c.x2t, outlier,
        x1: [c.x1t[0] + S.sigma * c.n[0], c.x1t[1] + S.sigma * c.n[1]],
        x2: outlier ? c.wrong : [c.x2t[0] + S.sigma * c.n[2], c.x2t[1] + S.sigma * c.n[3]],
      };
    });
}

// Mean epipolar distance of the noise-free true matches under F (pixels)
const errorVsTruth = (F) => {
  const good = matches.filter((m) => !m.outlier);
  return good.reduce((acc, m) => acc + epiDist(F, m.x1t, m.x2t), 0) / good.length;
};

let est = {};
function estimateAll() {
  const x1s = matches.map((m) => m.x1), x2s = matches.map((m) => m.x2);
  est = { raw: eightPoint(x1s, x2s, false), norm: eightPoint(x1s, x2s, true) };
  est.raw.err = errorVsTruth(est.raw.F);
  est.norm.err = errorVsTruth(est.norm.F);
}

// ---------------------------------------------------------------------------
// RANSAC, one hypothesis per step
// ---------------------------------------------------------------------------
let R;
function resetRansac() {
  R = { rand: rng(S.seed * 7907 + 13), iter: 0, history: [], best: null, current: null, final: null };
}

const inlierMask = (F) => matches.map((m) => epiDist(F, m.x1, m.x2) < S.tau);
const count = (mask) => mask.reduce((a, b) => a + b, 0);

// One hypothesis: sample, fit, count inliers
function ransacStep() {
  const sample = [];
  while (sample.length < 8) {
    const k = Math.floor(R.rand.uniform() * matches.length);
    if (!sample.includes(k)) sample.push(k);
  }
  const { F } = eightPoint(sample.map((k) => matches[k].x1), sample.map((k) => matches[k].x2), true);
  const mask = inlierMask(F);
  R.current = { sample, F, mask, count: count(mask) };
  if (!R.best || R.current.count > R.best.count) R.best = R.current;
  R.history.push(R.current.count);
  R.iter++;
}

// Run the remaining iterations, then refit on the inliers of the best hypothesis
function ransacFinish() {
  if (R.final) return;
  while (R.iter < S.iters) ransacStep();
  if (!R.best) return;
  const idx = R.best.mask.map((v, k) => (v ? k : -1)).filter((k) => k >= 0);
  const F = idx.length >= 8
    ? eightPoint(idx.map((k) => matches[k].x1), idx.map((k) => matches[k].x2), true).F
    : R.best.F;
  const mask = inlierMask(F);
  R.final = { F, mask, count: count(mask), err: errorVsTruth(F) };
  R.current = null;
  setPlaying(false);
}

function ransacTick() {
  if (R.final) return;
  if (R.iter < S.iters) ransacStep();
  if (R.iter >= S.iters) ransacFinish();
}

function currentF() {
  if (S.method === 'raw') return est.raw.F;
  if (S.method === 'norm') return est.norm.F;
  return R.final?.F ?? R.current?.F ?? null;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------
const canvases = [0, 1].map((k) => {
  const c = document.getElementById(`img${k}`);
  c.width = W;
  c.height = H;
  return c;
});
const ctxs = canvases.map((c) => c.getContext('2d'));

// matches whose epipolar lines are drawn: the hovered one, or a few true matches spread over the set
function lineMatches() {
  if (S.hover !== null) return [S.hover];
  const good = matches.map((m, k) => (m.outlier ? -1 : k)).filter((k) => k >= 0);
  return [0, 1, 2, 3, 4, 5].map((j) => good[Math.floor((j + 0.5) * good.length / 6)]).filter((k) => k !== undefined);
}

function drawView(k) {
  const ctx = ctxs[k];
  drawBase(ctx, cams[k], { edgeStyle: 'rgba(220,229,240,0.35)' });
  const F = currentF();

  for (const j of lineMatches()) {
    const m = matches[j];
    // line in view 2 from x1 (l = F x1); in view 1 from x2 (l = Fᵀ x2)
    const xt = k === 1 ? [m.x1t[0], m.x1t[1], 1] : [m.x2t[0], m.x2t[1], 1];
    const xo = k === 1 ? [m.x1[0], m.x1[1], 1] : [m.x2[0], m.x2[1], 1];
    drawLine(ctx, k === 1 ? matVec(F_TRUE, xt) : matTVec(F_TRUE, xt), 'rgba(255,255,255,0.7)', 1, [5, 5]);
    if (F) drawLine(ctx, k === 1 ? matVec(F, xo) : matTVec(F, xo), EST_COLOR, 1.5);
  }

  const mask = S.method === 'ransac' ? (R.final?.mask ?? R.best?.mask) : null;
  matches.forEach((m, j) => {
    const p = k === 0 ? m.x1 : m.x2;
    disc(ctx, p, 3.5, m.outlier ? OUTLIER_COLOR : MATCH_COLOR);
    if (mask?.[j]) ring(ctx, p, 6.5, INLIER_COLOR, 1.5);
  });
  if (S.method === 'ransac' && R.current && !R.final) {
    R.current.sample.forEach((j) => ring(ctx, k === 0 ? matches[j].x1 : matches[j].x2, 10, EST_COLOR, 2));
  }
  if (S.hover !== null) {
    const m = matches[S.hover];
    ring(ctx, k === 0 ? m.x1 : m.x2, 12, '#fff', 2);
  }

  drawEpipole(ctx, nullVector3(k === 0 ? F_TRUE : transpose(F_TRUE)), '#ffffff', `e${k + 1} true`);
  if (F) drawEpipole(ctx, nullVector3(k === 0 ? F : transpose(F)), EST_COLOR, `e${k + 1}`);

  ctx.font = MONO;
  ctx.fillStyle = '#8b97a8';
  ctx.fillText('● match  ● wrong match  ○ RANSAC inlier  — estimated  - - true', 10, H - 12);
}

const chart = document.getElementById('chart');
const cctx = chart.getContext('2d');

function drawChart() {
  const r = chart.getBoundingClientRect();
  const dpr = Math.min(window.devicePixelRatio, 2);
  if (chart.width !== Math.round(r.width * dpr)) {
    chart.width = Math.round(r.width * dpr);
    chart.height = Math.round(r.height * dpr);
  }
  const w = chart.width / dpr, h = chart.height / dpr;
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.clearRect(0, 0, w, h);
  const pad = { l: 34, r: 8, t: 8, b: 18 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  const n = matches.length;
  const y = (v) => pad.t + ph * (1 - v / n);
  const bw = pw / S.iters;

  cctx.font = '11px JetBrains Mono, monospace';
  cctx.fillStyle = '#8b97a8';
  cctx.fillText(String(n), 4, pad.t + 8);
  cctx.fillText('0', 4, pad.t + ph);
  cctx.fillText(`iteration → ${S.iters}`, pad.l, h - 4);

  const trueInliers = matches.filter((m) => !m.outlier).length;
  cctx.strokeStyle = 'rgba(255,255,255,0.5)';
  cctx.setLineDash([4, 4]);
  cctx.beginPath();
  cctx.moveTo(pad.l, y(trueInliers)); cctx.lineTo(pad.l + pw, y(trueInliers));
  cctx.stroke();
  cctx.setLineDash([]);
  cctx.fillStyle = 'rgba(255,255,255,0.6)';
  cctx.fillText('true inliers', pad.l + pw - 84, y(trueInliers) - 4);

  cctx.fillStyle = '#3a4658';
  R.history.forEach((v, i) => cctx.fillRect(pad.l + i * bw, y(v), Math.max(1, bw - 1), pad.t + ph - y(v)));

  cctx.strokeStyle = INLIER_COLOR;
  cctx.lineWidth = 2;
  cctx.beginPath();
  let best = 0;
  R.history.forEach((v, i) => {
    best = Math.max(best, v);
    const px = pad.l + (i + 1) * bw;
    if (i === 0) cctx.moveTo(pad.l, y(best));
    cctx.lineTo(px, y(best));
  });
  cctx.stroke();
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
const setResults = htmlSetter(document.getElementById('results'));
const setMatrices = htmlSetter(document.getElementById('matrices'));

function errClass(e) { return e < 1 ? 'good' : 'bad'; }

function updatePanels() {
  const nOut = matches.filter((m) => m.outlier).length;
  const row = (key, label, err, used) => `<tr class="${S.method === key ? 'cur' : ''}"><td>${label}</td>
    <td class="${err === null ? '' : errClass(err)}">${err === null ? '—' : fmt(err, 2) + ' px'}</td><td>${used}</td></tr>`;
  const ransacUsed = R.final ? `${R.final.count}/${matches.length}` : (R.best ? `running ${R.iter}/${S.iters}` : 'not run');
  setResults(`<table class="cmp">
    <tr><th>method</th><th>error</th><th>matches used</th></tr>
    ${row('raw', '8-point, raw', est.raw.err, `all ${matches.length}`)}
    ${row('norm', '8-point, normalized', est.norm.err, `all ${matches.length}`)}
    ${row('ransac', 'RANSAC + normalized', R.final ? R.final.err : null, ransacUsed)}
  </table>
  <div class="readout" style="margin-top:8px">${matches.length} matches, ${nOut} wrong (ε = ${fmt(100 * nOut / matches.length, 0)}%)</div>`);

  const eps = nOut / matches.length;
  const need = eps <= 0 ? 1 : Math.ceil(Math.log(0.01) / Math.log(1 - (1 - eps) ** 8));
  const cond = (e) => sci(e.values[8] / e.values[1]);
  const F = currentF();
  setMatrices(`
    <div class="mrow"><span class="name" data-tip="Fest">F estimated</span>${F ? matHTML(rows3(F).map((r) => r.map(sci))) : '<span class="readout">run RANSAC</span>'}</div>
    <div class="mrow"><span class="name" data-tip="Ftrue">F true</span>${matHTML(rows3(F_TRUE).map((r) => r.map(sci)))}</div>
    <div class="mrow"><span class="name" data-tip="T">T₁</span>${matHTML(rows3(est.norm.T1).map((r) => r.map((v) => fmt(v, 4))))}</div>
    <div class="readout"><span data-tip="cond">cond(AᵀA)</span>  raw ${cond(est.raw)}   normalized ${cond(est.norm)}
<span data-tip="needN">RANSAC iterations needed</span> (p = 0.99, s = 8): ${need}
best hypothesis so far: ${R.best ? R.best.count : 0} inliers</div>`);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const GROUPS = [
  { title: 'Matches', tip: 'data', sliders: [
    { key: 'n', label: 'n', min: 16, max: 120, step: 1, d: 0 },
    { key: 'sigma', label: 'σ px', min: 0, max: 3, step: 0.05, d: 2, tip: 'sigma' },
    { key: 'outliers', label: 'out%', min: 0, max: 60, step: 1, d: 0, tip: 'outliers' },
  ] },
  { title: 'RANSAC', tip: 'mRansac', sliders: [
    { key: 'tau', label: 'τ px', min: 0.3, max: 10, step: 0.1, d: 1, tip: 'tau' },
    { key: 'iters', label: 'N', min: 10, max: 600, step: 10, d: 0, tip: 'iters' },
  ] },
];

let dataDirty = true;
buildSliders(document.getElementById('sliders'), GROUPS, S, (key) => {
  if (key === 'n' || key === 'sigma' || key === 'outliers') dataDirty = true;
  else resetRansac();
});

const methodButtons = document.querySelectorAll('[data-method]');
function setMethod(m) {
  S.method = m;
  methodButtons.forEach((b) => b.classList.toggle('active', b.dataset.method === m));
}
methodButtons.forEach((b) => b.addEventListener('click', () => setMethod(b.dataset.method)));
setMethod(S.method);

const playBtn = document.getElementById('play');
function setPlaying(p) {
  S.playing = p;
  playBtn.textContent = p ? '❚❚ Pause' : '▶ Run';
  playBtn.classList.toggle('active', p);
}
playBtn.addEventListener('click', () => {
  if (R.final) resetRansac();
  setMethod('ransac');
  setPlaying(!S.playing);
});
document.getElementById('step').addEventListener('click', () => { setMethod('ransac'); setPlaying(false); ransacTick(); });
document.getElementById('finish').addEventListener('click', () => { setMethod('ransac'); ransacFinish(); });
document.getElementById('restart').addEventListener('click', () => { resetRansac(); setPlaying(false); });
document.getElementById('resample').addEventListener('click', () => { S.seed++; dataDirty = true; });

canvases.forEach((c, k) => {
  c.addEventListener('pointermove', (e) => {
    S.hover = pickOnCanvas(c, e, matches.map((m) => (k === 0 ? m.x1 : m.x2)), W, H, 10).index;
  });
  c.addEventListener('pointerleave', () => { S.hover = null; });
});

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------
const TIPS = {
  eightpoint: {
    title: '8-point linear system',
    body: 'Each match contributes one row of A; f is F written as a 9-vector. With 8 or more matches, f is the right singular vector of A with the smallest singular value.',
    formula: 'row = [x₂x₁, x₂y₁, x₂, y₂x₁, y₂y₁, y₂, x₁, y₁, 1]',
  },
  view: { title: 'Image', body: 'Grey-blue dots are correct matches with pixel noise; red dots are wrong matches (their partner in the other image is random). Hover a dot to draw its epipolar line.' },
  mRaw: { title: '8-point on raw pixels', body: 'Least squares on all matches, directly in pixel coordinates. Badly conditioned; and like any least squares, ruined by outliers.' },
  mNorm: { title: 'Normalized 8-point', body: 'Hartley normalization first: points are moved to centroid 0 and scaled to mean distance √2 in each image, then F is denormalized. Same cost, much more accurate — but still not robust to outliers.' },
  mRansac: { title: 'RANSAC', body: 'Repeatedly fit F to 8 random matches and count how many matches agree within τ. Keep the best hypothesis, then refit on its inliers.' },
  play: { title: 'Run RANSAC', body: 'Animate one hypothesis per frame. The yellow rings show the current random sample.' },
  step: { title: 'Step', body: 'One RANSAC iteration: sample, fit, count inliers.' },
  finish: { title: 'Finish', body: 'Run the remaining iterations at once and refit on the inliers of the best hypothesis.' },
  restart: { title: 'Restart RANSAC', body: 'Clear the RANSAC state (same data).' },
  resample: { title: 'New data', body: 'Draw new 3D points, noise and wrong matches.' },
  chart: { title: 'RANSAC progress', body: 'Bars: inliers of each hypothesis. Green: best so far. Dashed: number of truly correct matches. Most hypotheses are bad; it only takes one good sample.' },
  errorMetric: { title: 'Error vs. the true F', body: 'Mean symmetric epipolar distance of the noise-free true matches under the estimated F, in pixels. 0 means the estimated epipolar geometry is perfect.' },
  Fest: { title: 'Estimated F', body: 'From the selected method, scaled to unit norm. Its sign is arbitrary.' },
  Ftrue: { title: 'True F', body: 'Computed from the true camera poses as in chapter 2.' },
  T: { title: 'T₁ — normalizing transform (view 1)', body: 'Scales by s and shifts so the points have centroid 0 and mean distance √2.', formula: 'T = [[s, 0, −s·mx], [0, s, −s·my], [0, 0, 1]]' },
  cond: { title: 'Condition number', body: 'Ratio of the largest eigenvalue of AᵀA to the second smallest (the smallest is ~0 by design). Huge values mean small noise causes big changes in the solution.' },
  needN: { title: 'Required iterations', body: 'Number of samples needed to draw at least one outlier-free sample of 8 with 99% probability, given the true outlier ratio ε.', formula: 'N = log(1 − p) / log(1 − (1 − ε)⁸)' },
  data: { title: 'Synthetic matches', body: 'Points of the house plus random 3D points, projected into the two cameras of chapter 2.' },
  n: { title: 'Number of matches', body: 'More matches average out noise. 8 is the minimum.' },
  sigma: { title: 'σ — pixel noise', body: 'Gaussian noise added to every correct match in both images.' },
  outliers: { title: 'Outlier ratio', body: 'Percentage of matches whose second point is replaced by a random pixel — like a wrong feature match.' },
  tau: { title: 'τ — inlier threshold', body: 'A match is an inlier if its symmetric epipolar distance is below τ pixels. Usually 1–3 × σ.' },
  iters: { title: 'N — iterations', body: 'How many random samples RANSAC tries.' },
};
initTooltips(TIPS);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const labVisible = initTabs(() => {});
resetRansac();
setPlaying(true);
let lastStep = 0;

function frame(now) {
  requestAnimationFrame(frame);
  if (!labVisible()) return;
  if (dataDirty) {
    makeData();
    estimateAll();
    resetRansac();
    dataDirty = false;
  }
  if (S.playing && now - lastStep > 60) {
    lastStep = now;
    ransacTick();
  }
  drawView(0);
  drawView(1);
  drawChart();
  updatePanels();
}
requestAnimationFrame(frame);
