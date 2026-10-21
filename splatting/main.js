// Gaussian Splatting, chapter 1: one 3D Gaussian projected to a 2D splat
import { THREE, createViewer, CameraRig, setLines } from '../shared/lib/rig.js';
import { DEG, add, scale, eulerToR, lookAtR, matMul, makeCamera, toCam, projectCam, NEAR } from '../shared/lib/math.js';
import { W, H, GRID_SEGS, MONO, drawBackground, strokeSegs, cross2D } from '../shared/lib/scene.js';
import { fmt, vec, matHTML, htmlSetter, buildSliders, initTooltips, initTabs } from '../shared/lib/ui.js';
import {
  projectGaussian, quaternionFromR, alphaAt, mahalanobis2, strokeEllipse, sampleGaussian, covariance2D,
} from '../shared/lib/gaussian.js';

const CENTER = [0, 1, 0];       // the camera orbits around this point
const TILE = 16;
const N_SHOWN = 400;            // samples drawn
const N_STATS = 3000;           // samples used for the sampled covariance

const DEFAULTS = {
  gx: 0, gy: 1, gz: 0, sx: 0.45, sy: 0.2, sz: 0.07, rx: 20, ry: 35, rz: 10,
  opacity: 0.9, hue: 210,
  az: 40, el: 18, dist: 5, f: 620, look: 0,
};
const S = {
  ...DEFAULTS,
  dilation: true, samples: true, sigmas: true, tiles: true, plane: true,
  hoverPx: null, anim: null, animStart: 0, animInit: null,
};

const hslToRgb = (h, s, l) => {
  const c = new THREE.Color().setHSL(h / 360, s, l);
  return [c.r, c.g, c.b];
};

function deriveGaussian() {
  return {
    mu: [S.gx, S.gy, S.gz],
    scale: [S.sx, S.sy, S.sz],
    R: eulerToR(S.rx * DEG, S.ry * DEG, S.rz * DEG),
    opacity: S.opacity,
    color: hslToRgb(S.hue, 0.75, 0.6),
  };
}

function deriveCamera() {
  const az = S.az * DEG, el = S.el * DEG;
  const C = add(CENTER, scale([Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)], S.dist));
  const R = matMul(eulerToR(0, S.look * DEG, 0), lookAtR(C, CENTER));
  return makeCamera(R, C, { fx: S.f, fy: S.f, cx: W / 2, cy: H / 2 });
}

// ---------------------------------------------------------------------------
// 3D view
// ---------------------------------------------------------------------------
const v3 = createViewer(document.getElementById('view3d'), { position: [5.5, 3.5, -3.5], target: [1.2, 1.0, 1.4], house: false });

const imgCanvas = document.getElementById('img');
imgCanvas.width = W;
imgCanvas.height = H;
const ctx = imgCanvas.getContext('2d');
const rig = new CameraRig(v3, imgCanvas, 0xf5c542, { planeDepth: 1.2, farDepth: 6 });

const ellGeo = new THREE.SphereGeometry(1, 48, 32);
const ellSolid = new THREE.Mesh(ellGeo, new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.5, depthWrite: false }));
const ellWire = new THREE.Mesh(ellGeo, new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.12 }));
v3.scene.add(ellSolid, ellWire);
const axisLines = v3.dynLines(3, new THREE.LineBasicMaterial({ vertexColors: true }));
const centerRay = v3.dynLines(1, new THREE.LineBasicMaterial({ color: 0xf5c542, transparent: true, opacity: 0.5 }));

const sampleGeo = new THREE.BufferGeometry();
sampleGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N_SHOWN * 3), 3));
const samplePts = new THREE.Points(sampleGeo, new THREE.PointsMaterial({ color: 0xe6edf3, size: 0.025, transparent: true, opacity: 0.7 }));
samplePts.frustumCulled = false;
v3.scene.add(samplePts);

const basis = new THREE.Matrix4();
function update3D(g, cam, samples) {
  rig.update(cam, { plane: S.plane, far: false });

  const col = new THREE.Color(...g.color);
  ellSolid.material.color.copy(col);
  ellSolid.material.opacity = 0.15 + 0.4 * g.opacity;
  ellWire.material.color.copy(col);
  const cols = [0, 1, 2].map((j) => new THREE.Vector3(g.R[j], g.R[3 + j], g.R[6 + j]));
  basis.makeBasis(cols[0], cols[1], cols[2]);
  for (const [m, k] of [[ellSolid, 1], [ellWire, 2]]) {
    m.position.set(...g.mu);
    m.quaternion.setFromRotationMatrix(basis);
    m.scale.set(g.scale[0] * k, g.scale[1] * k, g.scale[2] * k);
  }

  setLines(axisLines, [0, 1, 2].map((j) => [g.mu, add(g.mu, [g.R[j] * g.scale[j], g.R[3 + j] * g.scale[j], g.R[6 + j] * g.scale[j]])]),
    [[1, 0.36, 0.36], [0.36, 1, 0.54], [0.36, 0.62, 1]]);
  setLines(centerRay, [[cam.C, g.mu]]);

  samplePts.visible = S.samples;
  const pos = sampleGeo.attributes.position;
  samples.forEach((p, i) => pos.array.set(p, i * 3));
  pos.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// 2D image
// ---------------------------------------------------------------------------
function projectSamples(cam, pts) {
  const out = [];
  for (const X of pts) {
    const Xc = toCam(cam, X);
    if (Xc[2] > NEAR) out.push(projectCam(cam, Xc));
  }
  return out;
}

function tileRange(splat) {
  const r = splat.radius;
  return {
    x0: Math.max(0, Math.floor((splat.uv[0] - r) / TILE)), x1: Math.min(Math.ceil(W / TILE) - 1, Math.floor((splat.uv[0] + r) / TILE)),
    y0: Math.max(0, Math.floor((splat.uv[1] - r) / TILE)), y1: Math.min(Math.ceil(H / TILE) - 1, Math.floor((splat.uv[1] + r) / TILE)),
  };
}

function draw2D(g, cam, splat, shown, sampled) {
  drawBackground(ctx);
  strokeSegs(ctx, cam, GRID_SEGS, '#2c3747', 1);
  if (!splat) {
    ctx.fillStyle = '#8b97a8';
    ctx.font = MONO;
    ctx.fillText('the Gaussian center is behind the camera', 20, 30);
    return;
  }

  // the splat itself: α-blend its color over the background, pixel by pixel inside the 3σ box
  const r = splat.radius;
  const x0 = Math.max(0, Math.floor(splat.uv[0] - r)), x1 = Math.min(W, Math.ceil(splat.uv[0] + r));
  const y0 = Math.max(0, Math.floor(splat.uv[1] - r)), y1 = Math.min(H, Math.ceil(splat.uv[1] + r));
  if (x1 > x0 && y1 > y0) {
    const img = ctx.getImageData(x0, y0, x1 - x0, y1 - y0);
    const c = g.color.map((v) => v * 255);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const a = alphaAt([x + 0.5, y + 0.5], splat, g.opacity);
        if (!a) continue;
        const k = 4 * ((y - y0) * (x1 - x0) + (x - x0));
        for (let ch = 0; ch < 3; ch++) img.data[k + ch] = c[ch] * a + img.data[k + ch] * (1 - a);
      }
    }
    ctx.putImageData(img, x0, y0);
  }

  if (S.tiles) {
    const tr = tileRange(splat);
    ctx.strokeStyle = 'rgba(245,197,66,0.22)';
    ctx.lineWidth = 1;
    for (let ty = tr.y0; ty <= tr.y1; ty++) {
      for (let tx = tr.x0; tx <= tr.x1; tx++) ctx.strokeRect(tx * TILE + 0.5, ty * TILE + 0.5, TILE - 1, TILE - 1);
    }
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = 'rgba(245,197,66,0.9)';
    ctx.strokeRect(splat.uv[0] - r, splat.uv[1] - r, 2 * r, 2 * r);
    ctx.setLineDash([]);
  }

  if (S.samples) {
    ctx.fillStyle = 'rgba(230,237,243,0.55)';
    for (const p of shown) ctx.fillRect(p[0] - 1, p[1] - 1, 2, 2);
  }

  if (S.sigmas) {
    [1, 2, 3].forEach((k) => strokeEllipse(ctx, splat.uv, splat.cov, k, `rgba(255,255,255,${1.1 - k * 0.25})`, 1.5));
    if (sampled) strokeEllipse(ctx, sampled.mean, sampled.cov, 2, '#ff9f43', 2, [6, 5]);
  }
  cross2D(ctx, splat.uv, 6, '#fff', 2);

  if (S.hoverPx) {
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.strokeRect(S.hoverPx[0] - 3, S.hoverPx[1] - 3, 6, 6);
  }

  ctx.font = MONO;
  ctx.fillStyle = '#8b97a8';
  ctx.fillText('— EWA 1σ 2σ 3σ   - - sampled 2σ   □ 3σ box / tiles', 10, H - 12);
}

// ---------------------------------------------------------------------------
// Panels
// ---------------------------------------------------------------------------
const setMatrices = htmlSetter(document.getElementById('matrices'));
const setHover = htmlSetter(document.getElementById('hoverInfo'));
const rows = (m, n) => [...Array(m.length / n)].map((_, r) => m.slice(r * n, r * n + n));
const sym2 = (c) => [[c[0], c[1]], [c[1], c[2]]];

function updatePanels(g, splat, sampled) {
  if (!splat) { setMatrices(''); setHover(''); return; }
  const q = quaternionFromR(g.R);
  const tr = tileRange(splat);
  const tiles = (tr.x1 - tr.x0 + 1) * (tr.y1 - tr.y0 + 1);
  const d = S.dilation ? 0.3 : 0;
  const ewa = [splat.cov[0] - d, splat.cov[1], splat.cov[2] - d];
  const rel = sampled
    ? Math.hypot(ewa[0] - sampled.cov[0], 2 ** 0.5 * (ewa[1] - sampled.cov[1]), ewa[2] - sampled.cov[2])
      / Math.hypot(sampled.cov[0], 2 ** 0.5 * sampled.cov[1], sampled.cov[2])
    : 0;
  setMatrices(`
    <div class="mrow"><span class="name" data-tip="sigma3">Σ</span>${matHTML(rows(splat.cov3, 3).map((r) => r.map((v) => fmt(v, 3))))}
      <span class="readout"><span data-tip="quat">q</span> = ${vec(q, 2)}</span></div>
    <div class="mrow"><span class="name" data-tip="J">J</span>${matHTML(rows(splat.J, 3).map((r) => r.map((v) => fmt(v, 1))))}</div>
    <div class="mrow"><span class="name" data-tip="sigma2">Σ'</span>${matHTML(sym2(splat.cov).map((r) => r.map((v) => fmt(v, 1))))}
      <span class="name" data-tip="conic" style="min-width:auto">Σ'⁻¹</span>${matHTML(sym2(splat.conic).map((r) => r.map((v) => v.toExponential(1))))}</div>
    <div class="readout"><span data-tip="lambdas">λ₁, λ₂</span> = ${fmt(splat.lambdas[0], 1)}, ${fmt(splat.lambdas[1], 1)} px²   <span data-tip="radius">r = ⌈3√λ₁⌉</span> = ${splat.radius} px
<span data-tip="tiles">tiles touched</span> = ${tiles}   <span data-tip="depth">depth</span> = ${fmt(splat.depth)}
<span data-tip="approx">EWA vs sampled</span>: ${fmt(100 * rel, 1)}% <span class="${rel < 0.1 ? 'good' : 'bad'}">${rel < 0.1 ? 'good fit' : 'approximation breaks down'}</span></div>`);

  if (!S.hoverPx) {
    setHover('Hover the image to read the splat\'s\nopacity at a pixel.');
    return;
  }
  const m2 = mahalanobis2(S.hoverPx, splat);
  const a = alphaAt(S.hoverPx, splat, g.opacity);
  setHover(`pixel p = ${vec(S.hoverPx, 0)}   d = p − μ' = ${vec([S.hoverPx[0] - splat.uv[0], S.hoverPx[1] - splat.uv[1]], 1)}
<span data-tip="mahal">dᵀ Σ'⁻¹ d</span> = ${fmt(m2, 2)}   (${fmt(Math.sqrt(m2), 2)} σ)
<span data-tip="alpha">α</span> = o · exp(−½ · ${fmt(m2, 2)}) = ${fmt(g.opacity, 2)} · ${fmt(Math.exp(-0.5 * m2), 3)} = <b>${fmt(a, 3)}</b>${a === 0 ? '   (below 1/255: skipped)' : ''}`);
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const GROUPS = [
  { title: 'Gaussian: position μ, scales s', tip: 'gaussian', sliders: [
    { key: 'gx', label: 'μx', min: -2, max: 2, step: 0.01, d: 2, tip: 'mu' },
    { key: 'gy', label: 'μy', min: 0, max: 2.5, step: 0.01, d: 2, tip: 'mu' },
    { key: 'gz', label: 'μz', min: -2, max: 2, step: 0.01, d: 2, tip: 'mu' },
    { key: 'sx', label: 's₁', min: 0.01, max: 1.5, step: 0.01, d: 2, tip: 'scale' },
    { key: 'sy', label: 's₂', min: 0.01, max: 1.5, step: 0.01, d: 2, tip: 'scale' },
    { key: 'sz', label: 's₃', min: 0.01, max: 1.5, step: 0.01, d: 2, tip: 'scale' },
  ] },
  { title: 'Rotation R (deg), opacity, color', tip: 'rotation', sliders: [
    { key: 'rx', label: 'rx', min: -180, max: 180, step: 0.5, d: 1, tip: 'rotation' },
    { key: 'ry', label: 'ry', min: -180, max: 180, step: 0.5, d: 1, tip: 'rotation' },
    { key: 'rz', label: 'rz', min: -180, max: 180, step: 0.5, d: 1, tip: 'rotation' },
    { key: 'opacity', label: 'o', min: 0, max: 1, step: 0.01, d: 2, tip: 'opacity' },
    { key: 'hue', label: 'hue', min: 0, max: 360, step: 1, d: 0, tip: 'color' },
  ] },
  { title: 'Camera', tip: 'camera', sliders: [
    { key: 'az', label: 'az', min: -180, max: 180, step: 0.5, d: 1, tip: 'orbit' },
    { key: 'el', label: 'el', min: -10, max: 80, step: 0.5, d: 1, tip: 'orbit' },
    { key: 'dist', label: 'dist', min: 0.8, max: 10, step: 0.01, d: 2, tip: 'dist' },
    { key: 'look', label: 'pan', min: -35, max: 35, step: 0.5, d: 1, tip: 'look' },
    { key: 'f', label: 'f', min: 200, max: 1400, step: 1, d: 0, tip: 'f' },
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
  S.animInit = { az: S.az, rz: S.rz, ry: S.ry, dist: S.dist, look: S.look };
  animButtons.forEach((b) => b.classList.toggle('active', b.dataset.anim === name));
}
function stopAnim() {
  S.anim = null;
  animButtons.forEach((b) => b.classList.remove('active'));
}
const wrap = (a) => ((a + 540) % 360) - 180;
function stepAnim(time) {
  const k = time - S.animStart, a = S.animInit;
  if (S.anim === 'orbit') S.az = wrap(a.az + 25 * k);
  else if (S.anim === 'spin') { S.rz = wrap(a.rz + 40 * k); S.ry = wrap(a.ry + 23 * k); }
  else if (S.anim === 'close') S.dist = 0.95 + (a.dist - 0.95) * (0.5 + 0.5 * Math.cos(0.7 * k));
  else if (S.anim === 'pan') S.look = 30 * Math.sin(0.6 * k);
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
  covProj: {
    title: 'Projected covariance',
    body: 'The 3D covariance Σ is rotated into the camera frame by W and pushed through the Jacobian J of the perspective projection, giving a 2×2 covariance in pixels.',
    formula: "Σ' = J W Σ Wᵀ Jᵀ",
  },
  ellipsoid: { title: '3D Gaussian', body: 'Solid: the 1σ ellipsoid (half-axes = scales). Wireframe: 2σ. The density keeps going beyond, it just gets small.' },
  localAxes: { title: 'Local axes', body: 'Columns of R·S: the three half-axes of the 1σ ellipsoid, i.e. the directions R and lengths s.' },
  samples: { title: 'Random samples', body: 'Points drawn from the Gaussian, X = μ + R S n with n ~ N(0, I), projected exactly with the pinhole model. Their spread in the image is the true projected distribution.' },
  camera: { title: 'Camera', body: 'Orbits around the point (0, 1, 0). Same pinhole model as in the Multi-view Geometry Explainer.' },
  image: { title: 'Rendered splat', body: 'The 2D Gaussian drawn the way 3DGS does it: α = o·exp(−½ dᵀΣ\'⁻¹d) blended over the background, only inside the 3σ square.' },
  gaussian: { title: 'Gaussian parameters', body: 'Position μ and scales s. 3DGS optimizes log s so scales stay positive.' },
  mu: { title: 'μ — mean', body: 'The center of the Gaussian in world coordinates. It projects with the ordinary pinhole model.' },
  scale: { title: 's — scales', body: 'Standard deviations along the Gaussian\'s three local axes. One very small scale makes a flat disc (a surfel).' },
  rotation: { title: 'Rotation R', body: 'Orientation of the local axes. Shown as Euler angles here; 3DGS stores a unit quaternion q (shown in the panel).' },
  opacity: { title: 'o — opacity', body: 'Peak opacity at the center. 3DGS stores it through a sigmoid so it stays in [0, 1].' },
  color: { title: 'Color', body: 'One constant color here. 3DGS uses spherical-harmonics coefficients (degree 3: 48 numbers) so the color can depend on the viewing direction.' },
  orbit: { title: 'Camera orbit', body: 'Azimuth and elevation of the camera around (0, 1, 0).' },
  dist: { title: 'Distance', body: 'Camera distance. Close up, a large Gaussian covers a wide field of view and the linearization gets worse.' },
  look: { title: 'Pan', body: 'Turn the camera sideways so the Gaussian moves away from the image center (off-axis).' },
  f: { title: 'f — focal length', body: 'Scales J, hence the splat size in pixels.' },
  dilation: { title: 'Dilation (+0.3 px²)', body: '3DGS adds 0.3 to the diagonal of Σ\' so no splat is smaller than about a pixel. A cheap anti-aliasing filter; Mip-Splatting later replaced it with a proper 3D + 2D filter.' },
  sigmas: { title: 'Ellipses', body: 'White: 1σ, 2σ, 3σ of the EWA covariance Σ\'. Orange dashed: 2σ of the covariance of the projected samples (the "true" projected spread).' },
  tiles: { title: '16×16 tiles', body: 'The image is cut into tiles; this Gaussian is added to the list of every tile its 3σ square (dashed) overlaps. Big splats touch many tiles and cost more.' },
  imagePlane: { title: 'Image plane', body: 'The rendered image, drawn on the camera\'s image plane in 3D.' },
  sigma3: { title: 'Σ — 3D covariance', body: 'Built from rotation and scales, so it is always symmetric positive semi-definite.', formula: 'Σ = R S Sᵀ Rᵀ' },
  quat: { title: 'q — quaternion', body: 'The same rotation as a unit quaternion (w, x, y, z): what a 3DGS .ply file stores as rot_0..rot_3.' },
  J: { title: 'J — Jacobian of the projection', body: 'Derivative of (u, v) with respect to the camera-space point at μ_c = (x, y, z). Linearizing the projection here is what makes the splat a Gaussian.', formula: 'J = [[fx/z, 0, −fx·x/z²], [0, fy/z, −fy·y/z²]]' },
  sigma2: { title: "Σ' — 2D covariance (pixels²)", body: 'Covariance of the splat on screen, including the 0.3 dilation when enabled.' },
  conic: { title: "Conic Σ'⁻¹", body: 'Inverse of Σ\', precomputed once per Gaussian and used for every pixel.' },
  lambdas: { title: 'Eigenvalues of Σ\'', body: 'Squared lengths of the ellipse half-axes (1σ).' },
  radius: { title: 'Splat radius', body: 'Pixels farther than 3σ along the major axis are ignored.' },
  depth: { title: 'Depth', body: 'z of the center in camera coordinates. Used to sort Gaussians front to back (chapter 2).' },
  approx: { title: 'Approximation error', body: 'Relative difference between the EWA covariance and the covariance of the actually projected samples. Large when the Gaussian is big, close or off-axis.' },
  mahal: { title: 'Mahalanobis distance', body: 'How many standard deviations the pixel is from the splat center, taking the ellipse shape into account.' },
  alpha: { title: 'α at this pixel', body: 'Opacity this splat contributes at the pixel; in chapter 2 these are blended front to back.' },
  animOrbit: { title: 'Orbit camera', body: 'The splat shape changes with viewing direction even though the Gaussian is fixed.' },
  animSpin: { title: 'Spin Gaussian', body: 'Rotate the Gaussian; watch Σ, q and the splat change.' },
  animClose: { title: 'Fly close', body: 'Move the camera towards the Gaussian. Near the camera the EWA ellipse (white) and the true spread (orange) disagree.' },
  animPan: { title: 'Pan off-axis', body: 'Turn the camera so the Gaussian moves towards the border: perspective stretches it radially.' },
};
initTooltips(TIPS);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const labVisible = initTabs(v3.resize);
let cachedKey = '', cachedSamples = null;

function frame() {
  requestAnimationFrame(frame);
  if (!labVisible()) return;
  if (S.anim) { stepAnim(clock.getElapsedTime()); syncSliders(); }
  const g = deriveGaussian();
  const cam = deriveCamera();
  document.getElementById('legendColor').style.background = `#${new THREE.Color(...g.color).getHexString()}`;

  const key = [S.gx, S.gy, S.gz, S.sx, S.sy, S.sz, S.rx, S.ry, S.rz].join();
  if (key !== cachedKey) {
    cachedKey = key;
    cachedSamples = sampleGaussian(g, N_STATS, 7);
  }
  const shown3D = cachedSamples.slice(0, N_SHOWN);
  const splat = projectGaussian(cam, g, { dilation: S.dilation ? 0.3 : 0 });
  const projected = projectSamples(cam, cachedSamples);
  const sampled = projected.length > 50 ? covariance2D(projected) : null;

  update3D(g, cam, shown3D);
  draw2D(g, cam, splat, projected.slice(0, N_SHOWN), sampled);
  rig.texture.needsUpdate = true;
  updatePanels(g, splat, sampled);
  v3.render();
}
requestAnimationFrame(frame);
