// Chapter 3: triangulation from three views, noise, baseline and epipolar transfer
import { THREE, createViewer, CameraRig, setLines } from '../lib/rig.js';
import {
  DEG, add, sub, scale, norm, dot, matVec, lookAtR, makeCamera, project, rayDir,
  fundamental, triangulateDLT, rng,
} from '../lib/math.js';
import {
  W, H, TARGET, POINTS, EDGES, POINT_COLORS, MONO,
  drawBase, disc, ring, cross2D, drawLine, intersectLines,
} from '../lib/scene.js';
import { fmt, vec, sci, matHTML, htmlSetter, buildSliders, initTooltips, initTabs, pickOnCanvas } from '../lib/ui.js';

const CAM_COLORS = ['#f5c542', '#4fd1c5', '#f472b6'];
const ELEV_OFFSETS = [0, 12, -5];   // keeps the three centers off one horizontal plane
const N = 3;

const S = {
  f: 620, spread: 32, dist: 6.5, elev: 20, sigma: 1.5, seed: 1,
  use3: true, cloud: true, lines: true, plane: true,
  sel: 6,
  azBase: 75,
  anim: null, animStart: 0, animInit: null,
};

function deriveCameras() {
  return [-1, 0, 1].map((k, i) => {
    const az = (S.azBase + k * S.spread) * DEG;
    const el = (S.elev + ELEV_OFFSETS[i]) * DEG;
    const C = add(TARGET, scale([Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], S.dist));
    return makeCamera(lookAtR(C, TARGET), C, { fx: S.f, fy: S.f, cx: W / 2, cy: H / 2 });
  });
}

// Noisy observations: same random pattern for a given seed, scaled by sigma
function observe(cams) {
  const r = rng(S.seed * 7919);
  return cams.map((cam) => POINTS.map((X) => {
    const n = [r.gauss(), r.gauss()];
    const uv = project(cam, X);
    return uv ? [uv[0] + S.sigma * n[0], uv[1] + S.sigma * n[1]] : null;
  }));
}

function reconstruct(cams, obs) {
  const views = S.use3 ? [0, 1, 2] : [0, 1];
  return POINTS.map((_, i) => {
    if (views.some((k) => !obs[k][i])) return null;
    return triangulateDLT(views.map((k) => cams[k]), views.map((k) => obs[k][i]));
  });
}

// ---------------------------------------------------------------------------
// 3D view
// ---------------------------------------------------------------------------
const v3 = createViewer(document.getElementById('view3d'), { position: [-3.5, 8, 11], target: [0.8, 1.2, 1.8] });

const canvases = [0, 1, 2].map((k) => {
  const c = document.getElementById(`img${k}`);
  c.width = W;
  c.height = H;
  return c;
});
const ctxs = canvases.map((c) => c.getContext('2d'));
const rigs = canvases.map((c, k) => new CameraRig(v3, c, CAM_COLORS[k], { planeDepth: 1.0, farDepth: 7 }));

const rayLines = v3.dynLines(N, new THREE.LineBasicMaterial({ vertexColors: true }));
const errorLine = v3.dynLines(1, new THREE.LineBasicMaterial({ color: 0xff5c5c }));
const xhatMesh = v3.sphere(0xffffff, 0.06);
const cloudMeshes = POINTS.map(() => v3.sphere(0x9aa7b8, 0.035));
const cloudEdges = v3.dynLines(EDGES.length, new THREE.LineBasicMaterial({ color: 0x9aa7b8, transparent: true, opacity: 0.75 }));
const RAY_COLORS = CAM_COLORS.map((c) => { const col = new THREE.Color(c); return [col.r, col.g, col.b]; });

function update3D(cams, obs, recon) {
  cams.forEach((cam, k) => rigs[k].update(cam, { plane: S.plane, far: false }));

  const i = S.sel, X = POINTS[i];
  const segs = [], cols = [];
  cams.forEach((cam, k) => {
    if (!obs[k][i]) return;
    const d = rayDir(cam, ...obs[k][i]);
    const len = dot(sub(X, cam.C), d) * 1.35;
    segs.push([cam.C, add(cam.C, scale(d, len))]);
    cols.push(RAY_COLORS[k]);
  });
  setLines(rayLines, segs, cols);

  const r = recon[i];
  xhatMesh.visible = errorLine.visible = r !== null;
  if (r) {
    xhatMesh.position.set(...r.X);
    setLines(errorLine, [[r.X, X]]);
  }

  recon.forEach((rc, j) => {
    cloudMeshes[j].visible = S.cloud && rc !== null;
    if (rc) cloudMeshes[j].position.set(...rc.X);
  });
  cloudEdges.visible = S.cloud;
  setLines(cloudEdges, EDGES.filter(([a, b]) => recon[a] && recon[b]).map(([a, b]) => [recon[a].X, recon[b].X]));

  v3.pointMeshes.forEach((m, j) => m.scale.setScalar(j === i ? 0.11 : 0.06));
}

// ---------------------------------------------------------------------------
// 2D images
// ---------------------------------------------------------------------------
// Point predicted in view k from the observations in the other two views
function transfer(cams, obs, k, i) {
  const [a, b] = [0, 1, 2].filter((j) => j !== k);
  if (!obs[a][i] || !obs[b][i]) return null;
  const la = matVec(fundamental(cams[a], cams[k]), [...obs[a][i], 1]);
  const lb = matVec(fundamental(cams[b], cams[k]), [...obs[b][i], 1]);
  return { la, lb, a, b, x: intersectLines(la, lb) };
}

function drawView(k, cams, obs, recon) {
  const ctx = ctxs[k], cam = cams[k];
  drawBase(ctx, cam, { edgeStyle: 'rgba(220,229,240,0.45)' });

  obs[k].forEach((uv, i) => { if (uv) disc(ctx, uv, 4.5, POINT_COLORS[i]); });

  const i = S.sel;
  if (S.lines) {
    const tr = transfer(cams, obs, k, i);
    if (tr) {
      drawLine(ctx, tr.la, CAM_COLORS[tr.a], 1.5);
      drawLine(ctx, tr.lb, CAM_COLORS[tr.b], 1.5);
      if (tr.x) {
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(tr.x[0] - 5, tr.x[1] - 5, 10, 10);
      }
    }
  }

  const truth = project(cam, POINTS[i]);
  if (truth) disc(ctx, truth, 2, '#fff');
  if (obs[k][i]) ring(ctx, obs[k][i], 10, '#fff');
  const r = recon[i];
  const reproj = r ? project(cam, r.X) : null;
  if (reproj) cross2D(ctx, reproj, 5, '#ff5c5c');

  ctx.fillStyle = '#8b97a8';
  ctx.font = MONO;
  ctx.fillText('○ observed   × reprojected X̂   □ transferred   · true', 10, H - 12);
}

// ---------------------------------------------------------------------------
// Info panels
// ---------------------------------------------------------------------------
const setMatrices = htmlSetter(document.getElementById('matrices'));
const setHover = htmlSetter(document.getElementById('hoverInfo'));

const angleBetween = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(a, b) / (norm(a) * norm(b))))) / DEG;

function updateInfo(cams, obs, recon) {
  const i = S.sel, X = POINTS[i], r = recon[i];
  const views = S.use3 ? '1, 2, 3' : '1, 2';
  const lines = [
    `<span class="sw" style="background:${POINT_COLORS[i]}"></span><b>point ${i}</b>   true X = ${vec(X)}`,
  ];
  if (!r) {
    lines.push('not visible in all views used for triangulation');
  } else {
    const err = norm(sub(r.X, X));
    const reproj = cams.map((cam, k) => {
      const p = project(cam, r.X);
      return p && obs[k][i] ? `${fmt(Math.hypot(p[0] - obs[k][i][0], p[1] - obs[k][i][1]), 2)}` : '–';
    });
    lines.push(
      `<span data-tip="Xhat">X̂</span> (views ${views}) = ${vec(r.X)}`,
      `<span data-tip="error3d">|X̂ − X|</span> = <span class="${err < 0.05 ? 'good' : 'bad'}">${fmt(err, 3)}</span> world units`,
      `<span data-tip="reproj">reprojection error</span> px:  v1 ${reproj[0]}   v2 ${reproj[1]}   v3 ${reproj[2]}`,
    );
  }
  const tr = transfer(cams, obs, 2, i);
  if (tr?.x && obs[2][i]) {
    lines.push(`<span data-tip="transfer">transfer → view 3</span>: ${vec(tr.x, 1)}, off by ${fmt(Math.hypot(tr.x[0] - obs[2][i][0], tr.x[1] - obs[2][i][1]), 2)} px`);
  }
  const rays = cams.map((cam) => sub(X, cam.C));
  lines.push(`<span data-tip="rayAngle">ray angles</span>: 1–2 ${fmt(angleBetween(rays[0], rays[1]), 1)}°   1–3 ${fmt(angleBetween(rays[0], rays[2]), 1)}°`);

  const errs = recon.map((rc, j) => (rc ? norm(sub(rc.X, POINTS[j])) : null)).filter((e) => e !== null);
  if (errs.length) {
    lines.push(`<span data-tip="cloud">reconstruction</span> RMS error = ${fmt(Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length), 3)} (${errs.length} points)`);
  }
  setHover(lines.join('\n'));

  if (r) {
    setMatrices(`
      <div class="mrow"><span class="name" data-tip="dlt">A</span>${matHTML(r.A.map((row) => row.map((v) => fmt(v, 3))))}</div>
      <div class="readout"><span data-tip="eig">eig(AᵀA)</span> = ${r.values.map(sci).join(', ')}
smallest / next = ${sci(r.values[0] / r.values[1])}</div>`);
  } else {
    setMatrices('<div class="readout">—</div>');
  }
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const GROUPS = [
  { title: 'Observation noise', tip: 'sigma', sliders: [
    { key: 'sigma', label: 'σ px', min: 0, max: 6, step: 0.1, d: 1 },
  ] },
  { title: 'Camera rig', tip: 'cams', sliders: [
    { key: 'spread', label: 'sprd', min: 2, max: 70, step: 0.5, d: 1, tip: 'spread' },
    { key: 'dist', label: 'dist', min: 3, max: 14, step: 0.05, d: 2, tip: 'dist' },
    { key: 'elev', label: 'elev', min: 5, max: 60, step: 0.5, d: 1, tip: 'elev' },
  ] },
  { title: 'Intrinsics (all cameras)', tip: 'f', sliders: [
    { key: 'f', label: 'f', min: 200, max: 1400, step: 1, d: 0 },
  ] },
];
const syncSliders = buildSliders(document.getElementById('sliders'), GROUPS, S, stopAnim);

document.querySelectorAll('[data-toggle]').forEach((el) => {
  el.addEventListener('change', () => { S[el.dataset.toggle] = el.checked; });
});
document.getElementById('resample').addEventListener('click', () => { S.seed++; });

const animButtons = document.querySelectorAll('[data-anim]');
animButtons.forEach((b) => b.addEventListener('click', () => {
  if (S.anim === b.dataset.anim) stopAnim();
  else startAnim(b.dataset.anim);
}));

const clock = new THREE.Clock();

function startAnim(name) {
  S.anim = name;
  S.animStart = clock.getElapsedTime();
  S.animInit = { spread: S.spread, azBase: S.azBase, tick: -1 };
  animButtons.forEach((b) => b.classList.toggle('active', b.dataset.anim === name));
}

function stopAnim() {
  S.anim = null;
  animButtons.forEach((b) => b.classList.remove('active'));
}

function stepAnim(time) {
  const k = time - S.animStart, a = S.animInit;
  if (S.anim === 'baseline') {
    S.spread = 3 + 22 * (1 + Math.cos(0.6 * k));   // 47° → 3° and back
  } else if (S.anim === 'jitter') {
    const tick = Math.floor(k / 0.35);
    if (tick !== a.tick) { a.tick = tick; S.seed++; }
  } else if (S.anim === 'orbit') {
    S.azBase = a.azBase + 20 * k;
  }
}

// ---------------------------------------------------------------------------
// Picking
// ---------------------------------------------------------------------------
let lastObs = [[], [], []];
canvases.forEach((c, k) => c.addEventListener('pointermove', (e) => {
  const pick = pickOnCanvas(c, e, lastObs[k], W, H);
  if (pick.index !== null) S.sel = pick.index;
}));
v3.onHoverPoint((i) => { if (i !== null) S.sel = i; });

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------
const TIPS = {
  dlt: {
    title: 'DLT — Direct Linear Transform',
    body: 'Each view adds two rows to A (from x × P X̃ = 0). The homogeneous point X̃ is the unit vector minimizing ‖A X̃‖: the eigenvector of AᵀA with the smallest eigenvalue. Columns of A multiply X, Y, Z, 1.',
    formula: 'rows: x·p₃ᵀ − p₁ᵀ,  y·p₃ᵀ − p₂ᵀ',
  },
  eig: {
    title: 'Eigenvalues of AᵀA',
    body: 'With perfect data A X̃ = 0 has an exact solution and the smallest eigenvalue is 0. Noise makes it positive. A ratio smallest / next close to 1 means the problem is ill-conditioned (rays almost parallel).',
  },
  cams: { title: 'Three cameras', body: 'All look at the house from a circle around it; spread sets the angle between neighbours. Their heights differ slightly so the centers do not share a horizontal plane.' },
  view: { title: 'Image', body: 'Colored dots are noisy detections. Hover near one to select that point.' },
  rays: { title: 'Back-projected rays', body: 'The ray from each camera center through its noisy detection. With σ = 0 they all meet at the true point; with noise they are skew lines that do not intersect.' },
  Xhat: { title: 'X̂ — triangulated point', body: 'Least-squares (DLT) estimate of the 3D point from the selected views.' },
  error3d: { title: '3D error', body: 'Distance between the triangulated point and the true point (in world units; the house is 1.2 wide).' },
  reproj: {
    title: 'Reprojection error',
    body: 'Pixel distance between the observation and the projection of X̂. Bundle adjustment minimizes the sum of their squares. Note it can stay small while the 3D error is large — that is depth ambiguity.',
  },
  transfer: {
    title: 'Epipolar transfer',
    body: 'In each view, the lines are the epipolar lines of the same point\'s detections in the two other views (colored by their camera). They cross where the point must appear (□). It fails when the point lies in the plane of the three camera centers.',
    formula: 'x₃ = (F₁₃ x₁) × (F₂₃ x₂)',
  },
  rayAngle: {
    title: 'Triangulation angle',
    body: 'Angle between viewing rays at the point. Small angles (short baseline, far point) give poor depth. SfM systems usually drop points seen under less than ~2°.',
  },
  cloud: { title: 'Reconstruction', body: 'All points triangulated from the noisy detections (grey), with the house edges between them. Compare with the true house (white).' },
  sigma: { title: 'σ — pixel noise', body: 'Standard deviation of the Gaussian noise added to every detection. Good feature detectors reach about 0.5–1 px.' },
  spread: { title: 'Spread', body: 'Angle between neighbouring cameras around the house. Small spread = short baseline = rays nearly parallel.' },
  dist: { title: 'Distance', body: 'Distance from the cameras to the house. Depth error grows roughly with distance squared.' },
  elev: { title: 'Elevation', body: 'How high the cameras look down on the house (degrees).' },
  f: { title: 'f — focal length', body: 'Larger f magnifies the image, so the same pixel noise is a smaller angle: better triangulation.' },
  use3: { title: 'Use view 3', body: 'Triangulate from views 1+2 only, or from all three. More views average out noise.' },
  imagePlane: { title: 'Image planes', body: 'Each camera\'s image drawn on its image plane in 3D.' },
  resample: { title: 'Resample noise', body: 'Draw a new random noise pattern with the same σ.' },
  animBaseline: { title: 'Shrink baseline', body: 'Spread goes from 47° down to 3° and back. Watch the reconstruction stretch along the viewing direction.' },
  animJitter: { title: 'Noise jitter', body: 'Resample the noise a few times per second to see the spread of possible reconstructions.' },
  animOrbit: { title: 'Orbit rig', body: 'Rotate the whole camera rig around the house.' },
};
initTooltips(TIPS);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const labVisible = initTabs(v3.resize);

function frame() {
  requestAnimationFrame(frame);
  if (!labVisible()) return;
  const time = clock.getElapsedTime();
  if (S.anim) { stepAnim(time); syncSliders(); }
  const cams = deriveCameras();
  const obs = observe(cams);
  lastObs = obs;
  const recon = reconstruct(cams, obs);
  update3D(cams, obs, recon);
  cams.forEach((_, k) => drawView(k, cams, obs, recon));
  updateInfo(cams, obs, recon);
  v3.render();
}
requestAnimationFrame(frame);
