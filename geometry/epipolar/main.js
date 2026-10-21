// Chapter 2: two views and epipolar geometry
import { THREE, createViewer, CameraRig, setLines } from '../lib/rig.js';
import {
  add, sub, scale, matVec, cross, transpose, rows3, det3, frobNormalize,
  yprToR, aimYawPitch, makeCamera, toCam, toWorld, project, rayDir,
  relativePose, essential, fundamental, epipole, normalize,
} from '../lib/math.js';
import {
  W, H, TARGET, POINTS, POINT_COLORS, MONO,
  drawBase, projectPoints, projectSeg, disc, ring, drawLine, drawEpipole, pointLineDist,
} from '../lib/scene.js';
import { fmt, vec, sci, matHTML, htmlSetter, buildSliders, initTooltips, initTabs, pickOnCanvas } from '../lib/ui.js';

const CAM_COLORS = ['#f5c542', '#4fd1c5'];
const PLANE_COLOR = '#b18cff';
const PLANE_DEPTH = 1.2;
const RAY_LENGTH = 14;

// ---------------------------------------------------------------------------
// State: two cameras given by center + yaw / pitch / roll, shared focal length
// ---------------------------------------------------------------------------
const S = {
  f: 620,
  sweep: true, allLines: false, planeTri: true, plane: true, far: false,
  src: 0,          // view the selected pixel lives in
  snap: 6,         // selected scene point (follows the cameras), or null for a free pixel
  uv: [W / 2, H / 2],
  anim: null, animStart: 0, animInit: null,
};
const CAM_KEYS = ['x', 'y', 'z', 'yaw', 'pitch', 'roll'];

function placeCamera(k, C, { aim = TARGET, yaw, pitch, roll = 0 } = {}) {
  if (yaw === undefined) [yaw, pitch] = aimYawPitch(C, aim);
  Object.assign(S, { [`${k}x`]: C[0], [`${k}y`]: C[1], [`${k}z`]: C[2], [`${k}yaw`]: yaw, [`${k}pitch`]: pitch, [`${k}roll`]: roll });
}

const PRESETS = {
  general() {
    placeCamera('a', [-2.6, 1.8, 4.6]);
    placeCamera('b', [3.0, 2.4, 3.6]);
  },
  stereo() {
    placeCamera('a', [-0.5, 1.0, 5.5], { yaw: 0, pitch: -4 });
    placeCamera('b', [0.5, 1.0, 5.5], { yaw: 0, pitch: -4 });
  },
  forward() {
    placeCamera('a', [0, 1.0, 7.0], { yaw: 0, pitch: -4 });
    const d = matVec(transpose(yprToR(0, -4, 0)), [0, 0, 1]);
    placeCamera('b', add([0, 1.0, 7.0], scale(d, 2.2)), { yaw: 0, pitch: -4 });
  },
  wide() {
    placeCamera('a', [-4.6, 2.0, 1.4]);
    placeCamera('b', [1.6, 2.6, 5.0]);
  },
};
PRESETS.general();

const intrinsics = () => ({ fx: S.f, fy: S.f, cx: W / 2, cy: H / 2 });
function deriveCameras() {
  return ['a', 'b'].map((k) => makeCamera(
    yprToR(S[`${k}yaw`], S[`${k}pitch`], S[`${k}roll`]),
    [S[`${k}x`], S[`${k}y`], S[`${k}z`]],
    intrinsics(),
  ));
}

// ---------------------------------------------------------------------------
// 3D view
// ---------------------------------------------------------------------------
const v3 = createViewer(document.getElementById('view3d'), { position: [1.2, 5.6, 8.6], target: [0.2, 1.0, 2.0] });

const canvases = [0, 1].map((k) => {
  const c = document.getElementById(`img${k}`);
  c.width = W;
  c.height = H;
  return c;
});
const ctxs = canvases.map((c) => c.getContext('2d'));
const rigs = canvases.map((c, k) => new CameraRig(v3, c, CAM_COLORS[k], { planeDepth: PLANE_DEPTH, farDepth: 7 }));

const baseline = v3.dynLines(3, new THREE.LineBasicMaterial({ color: 0xe6edf3, transparent: true, opacity: 0.8 }));
const srcRay = v3.dynLines(1, new THREE.LineBasicMaterial({ color: 0xffffff }));
const otherRay = v3.dynLines(1, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.6 }));
const epipoleMeshes = [0, 1].map((k) => v3.sphere(CAM_COLORS[1 - k], 0.045));
const sweepMesh = v3.sphere(0xffffff, 0.07);

const triGeo = new THREE.BufferGeometry();
triGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
const triMesh = new THREE.Mesh(triGeo, new THREE.MeshBasicMaterial({
  color: PLANE_COLOR, transparent: true, opacity: 0.18, side: THREE.DoubleSide, depthWrite: false,
}));
triMesh.frustumCulled = false;
v3.scene.add(triMesh);
const triEdges = v3.dynLines(3, new THREE.LineBasicMaterial({ color: PLANE_COLOR, transparent: true, opacity: 0.7 }));

// Where camera k's epipole sits on its image plane in 3D (null if the baseline is parallel to it)
function epipole3D(cams, k) {
  const Xc = toCam(cams[k], cams[1 - k].C);
  if (Math.abs(Xc[2]) < 1e-6) return null;
  return toWorld(cams[k], scale(Xc, PLANE_DEPTH / Xc[2]));
}

// ---------------------------------------------------------------------------
// Per-frame geometry for the current selection
// ---------------------------------------------------------------------------
function computeSelection(cams, time) {
  const s = S.src, o = 1 - s;
  let uv = S.uv;
  if (S.snap !== null) uv = project(cams[s], POINTS[S.snap]) ?? S.uv;
  const x = [uv[0], uv[1], 1];
  const F = fundamental(cams[s], cams[o]);              // l_o = F x_s
  const line = matVec(F, x);
  const dir = rayDir(cams[s], uv[0], uv[1]);
  const depth = S.sweep ? 0.6 + 11 * (0.5 - 0.5 * Math.cos(time * 0.8)) : 0;
  const sweepX = add(cams[s].C, scale(dir, depth));
  const match = S.snap !== null ? project(cams[o], POINTS[S.snap]) : null;
  return {
    s, o, uv, x, F, line, dir, depth, sweepX,
    sweepUV: S.sweep ? project(cams[o], sweepX) : null,
    match,
    rayImage: projectSeg(cams[o], add(cams[s].C, scale(dir, 0.02)), add(cams[s].C, scale(dir, 300))),
  };
}

function update3D(cams, sel) {
  cams.forEach((cam, k) => rigs[k].update(cam, { plane: S.plane, far: S.far }));

  const e3 = [0, 1].map((k) => epipole3D(cams, k));
  const segs = [[cams[0].C, cams[1].C]];
  e3.forEach((e, k) => {
    epipoleMeshes[k].visible = e !== null;
    if (e) { epipoleMeshes[k].position.set(...e); segs.push([cams[k].C, e]); }
  });
  setLines(baseline, segs);

  const Cs = cams[sel.s].C, Co = cams[sel.o].C;
  const far = add(Cs, scale(sel.dir, RAY_LENGTH));
  setLines(srcRay, [[Cs, far]]);
  srcRay.material.color.set(CAM_COLORS[sel.s]);

  sweepMesh.visible = S.sweep;
  otherRay.visible = S.sweep;
  if (S.sweep) {
    sweepMesh.position.set(...sel.sweepX);
    setLines(otherRay, [[Co, sel.sweepX]]);
    otherRay.material.color.set(CAM_COLORS[sel.o]);
  }

  // epipolar plane: baseline + the ray of the selected pixel
  const pos = triGeo.attributes.position;
  [Cs, Co, far].forEach((p, i) => pos.array.set(p, i * 3));
  pos.needsUpdate = true;
  triGeo.computeBoundingSphere();
  setLines(triEdges, [[Co, far]]);
  triMesh.visible = triEdges.visible = S.planeTri;

  v3.pointMeshes.forEach((m, i) => m.scale.setScalar(i === S.snap ? 0.12 : 0.07));
}

// ---------------------------------------------------------------------------
// 2D images
// ---------------------------------------------------------------------------
function drawView(k, cams, projs, sel) {
  const ctx = ctxs[k], cam = cams[k];
  drawBase(ctx, cam);

  if (S.allLines) {
    // every point visible in both views, with its epipolar line in this view
    const Fk = fundamental(cams[1 - k], cam);
    POINTS.forEach((_, i) => {
      const uvOther = projs[1 - k][i].uv;
      if (uvOther && projs[k][i].uv) {
        ctx.globalAlpha = 0.45;
        drawLine(ctx, matVec(Fk, [uvOther[0], uvOther[1], 1]), POINT_COLORS[i], 1);
        ctx.globalAlpha = 1;
      }
    });
  }

  const e = epipole(cams[1 - k], cam);
  if (k === sel.o) {
    // epipolar line of the selected pixel, and the part of it the ray actually covers
    drawLine(ctx, sel.line, CAM_COLORS[sel.s], 1.5, [6, 5]);
    if (sel.rayImage) {
      ctx.strokeStyle = CAM_COLORS[sel.s];
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(...sel.rayImage[0]);
      ctx.lineTo(...sel.rayImage[1]);
      ctx.stroke();
    }
  } else {
    // in the source view: the line through the epipole and the selected pixel (same epipolar plane)
    ctx.globalAlpha = 0.7;
    drawLine(ctx, cross(e, sel.x), CAM_COLORS[sel.o], 1.2, [3, 5]);
    ctx.globalAlpha = 1;
  }

  projs[k].forEach(({ uv }, i) => { if (uv) disc(ctx, uv, 5, POINT_COLORS[i]); });

  if (k === sel.s) {
    ctx.strokeStyle = CAM_COLORS[k];
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sel.uv[0] - 14, sel.uv[1]); ctx.lineTo(sel.uv[0] + 14, sel.uv[1]);
    ctx.moveTo(sel.uv[0], sel.uv[1] - 14); ctx.lineTo(sel.uv[0], sel.uv[1] + 14);
    ctx.stroke();
    ring(ctx, sel.uv, 9, '#fff');
    ctx.fillStyle = '#fff';
    ctx.font = MONO;
    ctx.fillText(`x${k + 1}`, sel.uv[0] + 12, sel.uv[1] + 20);
  } else {
    if (sel.match) {
      ring(ctx, sel.match, 9, '#fff');
      ctx.fillStyle = '#fff';
      ctx.font = MONO;
      ctx.fillText(`x${k + 1}`, sel.match[0] + 12, sel.match[1] + 20);
    }
    if (sel.sweepUV) {
      disc(ctx, sel.sweepUV, 5, '#fff');
      ring(ctx, sel.sweepUV, 9, 'rgba(255,255,255,0.5)', 1.5);
    }
  }

  drawEpipole(ctx, e, CAM_COLORS[1 - k], `e${k + 1}`);
}

// ---------------------------------------------------------------------------
// Info panels
// ---------------------------------------------------------------------------
const setMatrices = htmlSetter(document.getElementById('matrices'));
const setHover = htmlSetter(document.getElementById('hoverInfo'));

function epipoleText(e) {
  if (Math.abs(e[2]) < 1e-9 * Math.hypot(e[0], e[1])) return 'at infinity';
  return vec([e[0] / e[2], e[1] / e[2]], 1);
}

function updateInfo(cams, sel) {
  const { R, t } = relativePose(cams[0], cams[1]);
  const E = essential(cams[0], cams[1]);
  const F = frobNormalize(fundamental(cams[0], cams[1]));
  const tn = Math.hypot(...t) > 1e-9 ? normalize(t) : [0, 0, 0];
  setMatrices(`
    <div class="mrow"><span class="name" data-tip="Rrel">R</span>${matHTML(rows3(R))}
      <span class="name" data-tip="trel" style="min-width:auto">t</span>${matHTML(t.map((v) => [v]))}</div>
    <div class="mrow"><span class="name" data-tip="E">E = [t]×R</span>${matHTML(rows3(E))}</div>
    <div class="mrow"><span class="name" data-tip="F">F</span>${matHTML(rows3(F).map((r) => r.map(sci)))}</div>
    <div class="readout"><span data-tip="detF">det F</span> = ${sci(det3(F))}
|t| = ${fmt(Math.hypot(...t))}   t̂ = ${vec(tn)}
<span data-tip="epipole">e1</span> = ${epipoleText(epipole(cams[1], cams[0]))}
<span data-tip="epipole">e2</span> = ${epipoleText(epipole(cams[0], cams[1]))}</div>`);

  const sN = sel.s + 1, oN = sel.o + 1;
  const ln = Math.hypot(sel.line[0], sel.line[1]);
  const l = sel.line.map((v) => v / ln);
  const lines = [
    `<b>x${sN}</b> = ${vec(sel.uv, 1)} in view ${sN}` + (S.snap !== null
      ? `  <span class="sw" style="background:${POINT_COLORS[S.snap]}"></span>point ${S.snap}` : '  (free pixel)'),
    `<span data-tip="epipolarLine">l${oN}</span> = F x${sN} = ${vec(l, 3)}`,
    `     ${fmt(l[0], 3)}·u + ${fmt(l[1], 3)}·v + ${fmt(l[2], 1)} = 0`,
  ];
  if (sel.match) {
    const xo = [sel.match[0], sel.match[1], 1];
    const Fs = frobNormalize(sel.F);
    const r = xo[0] * (Fs[0] * sel.x[0] + Fs[1] * sel.x[1] + Fs[2]) + xo[1] * (Fs[3] * sel.x[0] + Fs[4] * sel.x[1] + Fs[5])
      + (Fs[6] * sel.x[0] + Fs[7] * sel.x[1] + Fs[8]);
    lines.push(
      `<b>x${oN}</b> = ${vec(sel.match, 1)}  (true match)`,
      `<span data-tip="residual">x${oN}ᵀ F x${sN}</span> = ${sci(r)}   distance to l${oN} = <span class="good">${fmt(pointLineDist(sel.match, sel.line), 2)} px</span>`,
    );
  } else {
    lines.push('free pixel: the match can be anywhere on the line', '');
  }
  lines.push(S.sweep
    ? `<span data-tip="sweep">sweep</span>: depth ${fmt(sel.depth, 1)} along the ray → ${sel.sweepUV ? vec(sel.sweepUV, 0) : 'behind camera ' + oN}`
    : '');
  setHover(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const camGroup = (k, n) => ({
  title: `Camera ${n} pose`, tip: `cam${n}`, sliders: [
    { key: `${k}x`, label: 'Cx', min: -8, max: 8, step: 0.01, d: 2, tip: 'pos' },
    { key: `${k}y`, label: 'Cy', min: 0.1, max: 6, step: 0.01, d: 2, tip: 'pos' },
    { key: `${k}z`, label: 'Cz', min: -8, max: 10, step: 0.01, d: 2, tip: 'pos' },
    { key: `${k}yaw`, label: 'yaw', min: -180, max: 180, step: 0.5, d: 1, tip: 'yaw' },
    { key: `${k}pitch`, label: 'pit', min: -80, max: 80, step: 0.5, d: 1, tip: 'pitch' },
    { key: `${k}roll`, label: 'roll', min: -180, max: 180, step: 0.5, d: 1, tip: 'roll' },
  ],
});
const GROUPS = [
  camGroup('a', 1),
  camGroup('b', 2),
  { title: 'Intrinsics (both cameras)', tip: 'K', sliders: [
    { key: 'f', label: 'f', min: 200, max: 1400, step: 1, d: 0 },
  ] },
];

const syncSliders = buildSliders(document.getElementById('sliders'), GROUPS, S, stopAnim);

document.querySelectorAll('[data-toggle]').forEach((el) => {
  el.addEventListener('change', () => { S[el.dataset.toggle] = el.checked; });
});

document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  stopAnim();
  PRESETS[b.dataset.preset]();
  syncSliders();
}));

const animButtons = document.querySelectorAll('[data-anim]');
animButtons.forEach((b) => b.addEventListener('click', () => {
  if (S.anim === b.dataset.anim) stopAnim();
  else startAnim(b.dataset.anim);
}));

const clock = new THREE.Clock();

function startAnim(name) {
  const rel = sub([S.bx, S.by, S.bz], TARGET);
  S.anim = name;
  S.animStart = clock.getElapsedTime();
  S.animInit = { r: Math.max(2, Math.hypot(rel[0], rel[2])), h: rel[1], az: Math.atan2(rel[2], rel[0]) };
  animButtons.forEach((b) => b.classList.toggle('active', b.dataset.anim === name));
}

function stopAnim() {
  S.anim = null;
  animButtons.forEach((b) => b.classList.remove('active'));
}

function stepAnim(time) {
  const a = S.animInit;
  const az = a.az + 0.35 * (time - S.animStart);
  placeCamera('b', add(TARGET, [a.r * Math.cos(az), a.h, a.r * Math.sin(az)]));
}

// ---------------------------------------------------------------------------
// Picking: hovering an image selects a pixel there (snapping to scene points)
// ---------------------------------------------------------------------------
let lastProjs = [[], []];
canvases.forEach((c, k) => c.addEventListener('pointermove', (e) => {
  const pick = pickOnCanvas(c, e, lastProjs[k].map((p) => p.uv), W, H);
  S.src = k;
  S.snap = pick.index;
  S.uv = pick.uv;
}));
v3.onHoverPoint((i) => { if (i !== null) S.snap = i; });

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------
const TIPS = {
  constraint: {
    title: 'Epipolar constraint',
    body: 'For any 3D point seen as x₁ in view 1 and x₂ in view 2 (homogeneous pixels), this holds. Given x₁, it is a linear equation in x₂: a line.',
    formula: 'x₂ᵀ F x₁ = 0',
  },
  cam1: { title: 'Camera 1', body: 'Yellow. Its pose is set by the center C and yaw / pitch / roll below. Both cameras share the same intrinsics K.' },
  cam2: { title: 'Camera 2', body: 'Teal. The two-view matrices describe camera 2 relative to camera 1.' },
  view1: { title: 'View 1', body: 'Image of camera 1. Hover anywhere to pick a pixel; near a scene point the selection snaps to it.' },
  view2: { title: 'View 2', body: 'Image of camera 2. Hover here to reverse the roles: the epipolar line then appears in view 1 (l₁ = Fᵀ x₂).' },
  baseline: {
    title: 'Baseline',
    body: 'The line through both camera centers C₁ and C₂. Where it pierces each image plane is that image\'s epipole. Longer baseline → better depth from triangulation.',
  },
  epipole: {
    title: 'Epipole',
    body: 'The image of the other camera\'s center. All epipolar lines of an image pass through its epipole. It can lie outside the image or at infinity (when the baseline is parallel to the image plane).',
    formula: 'F e₁ = 0,  Fᵀ e₂ = 0',
  },
  epipolarPlane: {
    title: 'Epipolar plane',
    body: 'The plane through C₁, C₂ and the selected ray. Any 3D point on the ray stays in this plane, so its image in the other view stays on the plane\'s intersection with that image: the epipolar line.',
  },
  epipolarLine: {
    title: 'Epipolar line',
    body: 'The image of the ray of x in the other view. The match must lie on it, which turns stereo matching into a 1D search. Shown normalized so that a² + b² = 1, making a·u + b·v + c the signed distance in pixels.',
    formula: 'l₂ = F x₁,   l₁ = Fᵀ x₂',
  },
  sweep: {
    title: 'Depth sweep',
    body: 'A point (white) slides along the ray of the selected pixel. Its image in the other view (white dot) slides along the epipolar line. The thick part of the line is the image of the ray in front of camera 1; the rest corresponds to points behind it.',
  },
  allLines: { title: 'All epipolar lines', body: 'Draw the epipolar line of every scene point. They form a pencil of lines meeting at the epipole.' },
  imagePlane: { title: 'Image planes', body: `Virtual image planes at depth ${PLANE_DEPTH}, textured with each camera's image. The epipolar plane cuts them along the epipolar lines.` },
  farFrustum: { title: 'Far frustum', body: 'Extend the frusta to show what each camera covers.' },
  Rrel: {
    title: 'R — relative rotation',
    body: 'Rotates camera-1 coordinates into camera-2 coordinates.',
    formula: 'R = R₂ R₁ᵀ',
  },
  trel: {
    title: 't — relative translation',
    body: 'Camera-1 origin expressed in camera 2. From images alone only its direction t̂ can be recovered, not its length (scale ambiguity).',
    formula: 't = t₂ − R t₁,   X₂ = R X₁ + t',
  },
  E: {
    title: 'E — essential matrix',
    body: 'Relates normalized (calibrated) coordinates of the two views. Rank 2, its two non-zero singular values are equal. 5 degrees of freedom.',
    formula: 'E = [t]× R,   x̂₂ᵀ E x̂₁ = 0',
  },
  F: {
    title: 'F — fundamental matrix',
    body: 'Same constraint in pixel coordinates; it absorbs both K. Shown scaled to unit Frobenius norm (F is only defined up to scale). Rank 2, 7 degrees of freedom.',
    formula: 'F = K₂⁻ᵀ E K₁⁻¹',
  },
  detF: { title: 'det F = 0', body: 'F has rank 2 because all epipolar lines pass through the epipole (F e₁ = 0). An estimated F must have this enforced, e.g. by zeroing its smallest singular value.' },
  residual: { title: 'Algebraic residual', body: 'x₂ᵀ F x₁ for the true match. Zero up to floating point, because the scene is noise-free. With real matches it is small but not zero; the 8-point algorithm minimizes it.' },
  K: { title: 'Shared intrinsics', body: 'Both cameras use K = [[f, 0, W/2], [0, f, H/2], [0, 0, 1]].' },
  f: { title: 'f — focal length (pixels)', body: 'Changes both K₁ and K₂. E does not change (it lives in normalized coordinates), but F does.' },
  pos: { title: 'Camera center C', body: 'Position of the camera in world coordinates (y is up). Moving C changes t and the baseline.' },
  yaw: { title: 'Yaw', body: 'Turn the camera left / right about the world vertical axis. 0 looks along world −Z.' },
  pitch: { title: 'Pitch', body: 'Tilt the camera up / down.' },
  roll: { title: 'Roll', body: 'Rotate the camera about its own optical axis. Epipolar lines rotate with the image; the geometry does not change.' },
  pGeneral: { title: 'General setup', body: 'Two cameras looking at the house from different sides. Epipoles are finite, lines converge.' },
  pStereo: { title: 'Rectified stereo', body: 'Same orientation, baseline along camera x. Epipoles at infinity: all epipolar lines are horizontal and a match lies on the same row. This is the setup stereo depth estimation uses.' },
  pForward: { title: 'Forward motion', body: 'Camera 2 is camera 1 moved along its optical axis. The epipole is at the principal point (focus of expansion) and epipolar lines radiate from it, like a car dashcam.' },
  pWide: { title: 'Wide baseline', body: 'Cameras about 90° apart. Good for triangulation, hard for feature matching.' },
  animOrbit2: { title: 'Orbit camera 2', body: 'Camera 2 circles the house while camera 1 stays still. Watch the epipoles and the pencil of epipolar lines move.' },
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
  const projs = cams.map((c) => projectPoints(c));
  lastProjs = projs;
  const sel = computeSelection(cams, time);
  update3D(cams, sel);
  drawView(0, cams, projs, sel);
  drawView(1, cams, projs, sel);
  updateInfo(cams, sel);
  v3.render();
}
requestAnimationFrame(frame);
