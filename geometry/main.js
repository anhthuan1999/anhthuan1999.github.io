// Chapter 1: the pinhole camera
import { THREE, createViewer, CameraRig, setLines } from './lib/rig.js';
import {
  DEG, add, sub, scale, lerp, norm, normalize, matVec,
  eulerToR, rToEuler, lookAtR, cameraFromRt, toWorld, projMatrix, Kmat,
} from './lib/math.js';
import { W, H, TARGET, POINTS, POINT_COLORS, MONO, drawBase, projectPoints, disc, ring } from './lib/scene.js';
import { fmt, vec, matHTML, htmlSetter, buildSliders, initTooltips, initTabs, pickOnCanvas } from './lib/ui.js';

const PLANE_DEPTH = 1.5;         // depth at which the image plane is drawn in 3D
const HOME_C = [3.2, 2.3, 4.6];

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
const S = {
  fx: 700, fy: 700, cx: W / 2, cy: H / 2,
  rx: 0, ry: 0, rz: 0, tx: 0, ty: 0, tz: 0,
  lockF: true, rays: true, photons: true, plane: true, far: true,
  anim: null, animStart: 0, animInit: null,
  hover2D: null, hover3D: null,
};

function setPose(C, R) {
  const [rx, ry, rz] = rToEuler(R);
  const t = scale(matVec(R, C), -1);
  Object.assign(S, { rx: rx / DEG, ry: ry / DEG, rz: rz / DEG, tx: t[0], ty: t[1], tz: t[2] });
}

function resetState() {
  Object.assign(S, { fx: 700, fy: 700, cx: W / 2, cy: H / 2 });
  setPose(HOME_C, lookAtR(HOME_C, TARGET));
}
resetState();

const deriveCamera = () =>
  cameraFromRt(eulerToR(S.rx * DEG, S.ry * DEG, S.rz * DEG), [S.tx, S.ty, S.tz], S);

// ---------------------------------------------------------------------------
// 3D view
// ---------------------------------------------------------------------------
const view = document.getElementById('view3d');
const v3 = createViewer(view, { position: [7.5, 4.8, 6.5], target: [1.4, 1.1, 2.2] });

const imgCanvas = document.getElementById('img');
imgCanvas.width = W;
imgCanvas.height = H;
const ctx = imgCanvas.getContext('2d');

const rig = new CameraRig(v3, imgCanvas, 0xf5c542, { planeDepth: PLANE_DEPTH, farDepth: 7 });
const photonMeshes = POINTS.map((_, i) => v3.sphere(POINT_COLORS[i], 0.035));
const hitMeshes = POINTS.map((_, i) => v3.sphere(POINT_COLORS[i], 0.03));
const COLORS = POINT_COLORS.map((c) => new THREE.Color(c));
const rayLines = v3.dynLines(POINTS.length, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.45 }));
const hoverRay = v3.dynLines(1, new THREE.LineBasicMaterial({ color: 0xffffff }));

const hovered = () => S.hover2D ?? S.hover3D;

function update3D(cam, proj, time) {
  rig.update(cam, { plane: S.plane, far: S.far });

  const raySegs = [], rayCols = [];
  const flash = POINTS.map(() => 0);
  const hover = hovered();

  POINTS.forEach((X, i) => {
    const { Xc, uv } = proj[i];
    const visible = uv !== null;
    v3.pointMeshes[i].scale.setScalar(i === hover ? 0.12 : 0.07);

    if (visible) {
      raySegs.push([X, cam.C]);
      rayCols.push([COLORS[i].r, COLORS[i].g, COLORS[i].b]);
    }

    // where the ray pierces the image plane
    hitMeshes[i].visible = visible && S.plane;
    if (visible) hitMeshes[i].position.set(...toWorld(cam, scale(Xc, PLANE_DEPTH / Xc[2])));

    // photon travelling from the point to the camera center
    const p = (time * 0.32 + i * 0.137) % 1;
    photonMeshes[i].visible = visible && S.photons;
    if (visible) {
      photonMeshes[i].position.set(...lerp(X, cam.C, p));
      const crossAt = (Xc[2] - PLANE_DEPTH) / Xc[2];
      if (S.photons && Xc[2] > PLANE_DEPTH && p >= crossAt && p < crossAt + 0.12) {
        flash[i] = 1 - (p - crossAt) / 0.12;
      }
    }
    hitMeshes[i].scale.setScalar(0.03 * (1 + 1.5 * flash[i]));
  });

  setLines(rayLines, raySegs, rayCols);
  rayLines.visible = S.rays;

  hoverRay.visible = hover !== null && proj[hover].uv !== null;
  if (hoverRay.visible) setLines(hoverRay, [[POINTS[hover], cam.C]]);

  return flash;
}

// ---------------------------------------------------------------------------
// 2D image
// ---------------------------------------------------------------------------
function draw2D(cam, proj, flash) {
  drawBase(ctx, cam);

  // image center (dashed) and principal point
  ctx.setLineDash([4, 6]);
  ctx.strokeStyle = '#3a4658';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H);
  ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.strokeStyle = '#f5c542';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cam.cx - 12, cam.cy); ctx.lineTo(cam.cx + 12, cam.cy);
  ctx.moveTo(cam.cx, cam.cy - 12); ctx.lineTo(cam.cx, cam.cy + 12);
  ctx.stroke();
  ctx.fillStyle = '#f5c542';
  ctx.font = MONO;
  ctx.fillText('(cx, cy)', cam.cx + 8, cam.cy - 8);

  const hover = hovered();
  let inside = 0;
  proj.forEach(({ uv, inImage }, i) => {
    if (!uv) return;
    if (inImage) inside++;
    if (flash[i] > 0) {
      ctx.globalAlpha = flash[i];
      ring(ctx, uv, 6 + 16 * (1 - flash[i]), POINT_COLORS[i]);
      ctx.globalAlpha = 1;
    }
    disc(ctx, uv, 6, POINT_COLORS[i]);
    if (i === hover) ring(ctx, uv, 11, '#fff');
  });

  ctx.fillStyle = '#8b97a8';
  ctx.font = MONO;
  ctx.fillText(`${inside}/${POINTS.length} points in view`, 10, H - 12);
}

// ---------------------------------------------------------------------------
// Info panels
// ---------------------------------------------------------------------------
const setMatrices = htmlSetter(document.getElementById('matrices'));
const setHover = htmlSetter(document.getElementById('hoverInfo'));

function updateInfo(cam, proj) {
  const { R, t, C } = cam;
  const K = Kmat(cam);
  const Rt = [0, 1, 2].map((r) => [R[r * 3], R[r * 3 + 1], R[r * 3 + 2], t[r]]);
  const P = projMatrix(cam);

  setMatrices(`
    <div class="mrow"><span class="name" data-tip="K">K</span>${matHTML([K.slice(0, 3), K.slice(3, 6), K.slice(6, 9)])}</div>
    <div class="mrow"><span class="name" data-tip="Rt">[R | t]</span>${matHTML(Rt, 3)}</div>
    <div class="mrow"><span class="name" data-tip="P">P = K[R|t]</span>${matHTML(P.map((r) => r.map((v) => fmt(v, 1))), 3)}</div>
    <div class="mrow"><span class="name" data-tip="C">C = −Rᵀt</span><span class="mono">${vec(C)}</span></div>`);

  const i = hovered();
  if (i === null) {
    setHover('Hover a point in the image or in the 3D view\nto see how it gets projected.');
    return;
  }
  const X = POINTS[i], { Xc, uv, inImage } = proj[i];
  const head = `<span class="sw" style="background:${POINT_COLORS[i]}"></span><b>point ${i}</b>   `;
  const lines = [
    head + (uv ? (inImage ? 'inside the image' : 'projects outside the image') : 'behind the camera'),
    `<span data-tip="Xw">X<sub>w</sub></span> = ${vec(X)}`,
    `<span data-tip="Xc">X<sub>c</sub></span> = R X<sub>w</sub> + t = ${vec(Xc)}`,
  ];
  if (uv) {
    lines.push(
      `<span data-tip="u">u</span> = f<sub>x</sub>·X/Z + c<sub>x</sub> = ${fmt(cam.fx, 0)}·${fmt(Xc[0] / Xc[2], 3)} + ${fmt(cam.cx, 0)} = <b>${fmt(uv[0], 1)}</b>`,
      `<span data-tip="v">v</span> = f<sub>y</sub>·Y/Z + c<sub>y</sub> = ${fmt(cam.fy, 0)}·${fmt(Xc[1] / Xc[2], 3)} + ${fmt(cam.cy, 0)} = <b>${fmt(uv[1], 1)}</b>`,
      `<span data-tip="depth">depth Z</span> = ${fmt(Xc[2])}`,
    );
  }
  setHover(lines.join('\n'));
}

// ---------------------------------------------------------------------------
// Controls
// ---------------------------------------------------------------------------
const GROUPS = [
  { title: 'Intrinsics K (pixels)', tip: 'K', sliders: [
    { key: 'fx', label: 'fx', min: 100, max: 1500, step: 1, d: 0 },
    { key: 'fy', label: 'fy', min: 100, max: 1500, step: 1, d: 0 },
    { key: 'cx', label: 'cx', min: 0, max: W, step: 1, d: 0 },
    { key: 'cy', label: 'cy', min: 0, max: H, step: 1, d: 0 },
  ] },
  { title: 'Rotation R = Rz·Ry·Rx (deg)', tip: 'R', sliders: [
    { key: 'rx', label: 'rx', min: -180, max: 180, step: 0.5, d: 1 },
    { key: 'ry', label: 'ry', min: -180, max: 180, step: 0.5, d: 1 },
    { key: 'rz', label: 'rz', min: -180, max: 180, step: 0.5, d: 1 },
  ] },
  { title: 'Translation t (world units)', tip: 't', sliders: [
    { key: 'tx', label: 'tx', min: -15, max: 15, step: 0.01, d: 2 },
    { key: 'ty', label: 'ty', min: -15, max: 15, step: 0.01, d: 2 },
    { key: 'tz', label: 'tz', min: -15, max: 15, step: 0.01, d: 2 },
  ] },
];

const syncSliders = buildSliders(document.getElementById('sliders'), GROUPS, S, (key) => {
  stopAnim();
  if (S.lockF && key === 'fx') S.fy = S.fx;
  if (S.lockF && key === 'fy') S.fx = S.fy;
});

document.querySelectorAll('[data-toggle]').forEach((el) => {
  el.addEventListener('change', () => {
    S[el.dataset.toggle] = el.checked;
    if (el.dataset.toggle === 'lockF' && el.checked) { S.fy = S.fx; syncSliders(); }
  });
});

const animButtons = document.querySelectorAll('[data-anim]');
animButtons.forEach((b) => b.addEventListener('click', () => {
  if (S.anim === b.dataset.anim) stopAnim();
  else startAnim(b.dataset.anim);
}));

document.getElementById('reset').addEventListener('click', () => {
  stopAnim();
  resetState();
  syncSliders();
});

// ---------------------------------------------------------------------------
// Animations
// ---------------------------------------------------------------------------
const clock = new THREE.Clock();

function startAnim(name) {
  const cam = deriveCamera();
  const rel = sub(cam.C, TARGET);
  S.anim = name;
  S.animStart = clock.getElapsedTime();
  S.animInit = {
    fx: S.fx, fy: S.fy,
    r: Math.hypot(rel[0], rel[2]), h: rel[1], az: Math.atan2(rel[2], rel[0]),
    dir: normalize(rel), dist: norm(rel),
  };
  animButtons.forEach((b) => b.classList.toggle('active', b.dataset.anim === name));
}

function stopAnim() {
  S.anim = null;
  animButtons.forEach((b) => b.classList.remove('active'));
}

function stepAnim(time) {
  const k = time - S.animStart;
  const a = S.animInit;
  if (S.anim === 'orbit') {
    const az = a.az + 0.45 * k;
    const C = add(TARGET, [a.r * Math.cos(az), a.h, a.r * Math.sin(az)]);
    setPose(C, lookAtR(C, TARGET));
  } else if (S.anim === 'zoom') {
    const m = Math.exp(0.75 * Math.sin(1.1 * k));
    S.fx = a.fx * m;
    S.fy = a.fy * m;
  } else if (S.anim === 'dolly') {
    // move the camera back and forth while scaling f with distance:
    // the target keeps its size in the image, the perspective changes
    const d = a.dist * (1 + 0.55 * Math.sin(0.8 * k));
    const C = add(TARGET, scale(a.dir, d));
    setPose(C, lookAtR(C, TARGET));
    S.fx = a.fx * d / a.dist;
    S.fy = a.fy * d / a.dist;
  } else if (S.anim === 'principal') {
    S.cx = W / 2 + 150 * Math.sin(1.1 * k);
    S.cy = H / 2 + 110 * Math.sin(1.7 * k);
  }
}

// ---------------------------------------------------------------------------
// Hover picking
// ---------------------------------------------------------------------------
let lastProj = [];
imgCanvas.addEventListener('pointermove', (e) => {
  S.hover2D = pickOnCanvas(imgCanvas, e, lastProj.map((p) => p.uv), W, H).index;
});
imgCanvas.addEventListener('pointerleave', () => { S.hover2D = null; });
v3.onHoverPoint((i) => { S.hover3D = i; });

// ---------------------------------------------------------------------------
// Tooltips
// ---------------------------------------------------------------------------
const fovDeg = (size, f) => 2 * Math.atan(size / (2 * f)) / DEG;

const TIPS = {
  fx: {
    title: 'fx — focal length (x), in pixels',
    body: 'Focal length divided by the pixel width: fx = f / sx. Larger fx means a narrower field of view (zooming in). It scales the image horizontally around cx.',
    formula: 'FOVx = 2·atan(W / 2fx)',
    live: (c) => `now: horizontal FOV = ${fmt(fovDeg(W, c.fx), 1)}°`,
  },
  fy: {
    title: 'fy — focal length (y), in pixels',
    body: 'Focal length divided by the pixel height. fx ≠ fy means non-square pixels (pixel aspect ratio ≠ 1). Unlock "fx = fy" to see the image stretch.',
    formula: 'FOVy = 2·atan(H / 2fy)',
    live: (c) => `now: vertical FOV = ${fmt(fovDeg(H, c.fy), 1)}°`,
  },
  cx: {
    title: 'cx — principal point (x), in pixels',
    body: 'Column where the optical axis (camera z-axis) hits the image. Usually near W/2. Changing it shifts the image sideways without moving or rotating the camera — the frustum becomes off-axis.',
    live: (c) => `now: ${fmt(c.cx - W / 2, 0)} px from the image center`,
  },
  cy: {
    title: 'cy — principal point (y), in pixels',
    body: 'Row where the optical axis hits the image. Usually near H/2. Shifting it is like a shift / tilt-shift lens.',
    live: (c) => `now: ${fmt(c.cy - H / 2, 0)} px from the image center`,
  },
  K: {
    title: 'K — intrinsic matrix',
    body: 'Describes the camera itself (lens + sensor), independent of where the camera is. Maps normalized coordinates (X/Z, Y/Z, 1) to pixels. Skew is fixed to 0 here. Estimated once by calibration.',
    formula: 'K = [[fx, 0, cx], [0, fy, cy], [0, 0, 1]]',
  },
  R: {
    title: 'R — rotation (world → camera)',
    body: 'A 3×3 orthonormal matrix (RᵀR = I, det R = 1) that rotates world coordinates into the camera frame. Its rows are the camera x, y, z axes written in world coordinates. 3 degrees of freedom.',
    formula: 'R = Rz(rz) · Ry(ry) · Rx(rx)',
  },
  rx: {
    title: 'rx — Euler angle about the x-axis',
    body: 'Rotation angle (degrees) of R about x, applied first. Note these are angles of the world→camera rotation R, not of the camera orientation in the world (that one is Rᵀ).',
  },
  ry: {
    title: 'ry — Euler angle about the y-axis',
    body: 'Rotation angle (degrees) of R about y, applied second. At ry = ±90° rx and rz rotate about the same axis: gimbal lock.',
  },
  rz: {
    title: 'rz — Euler angle about the z-axis',
    body: 'Rotation angle (degrees) of R about z, applied last.',
  },
  t: {
    title: 't — translation (world → camera)',
    body: 'The world origin expressed in camera coordinates. It is NOT the camera position! The camera center is C = −Rᵀt. Rotating the camera (changing R) with t fixed therefore also moves C.',
    formula: 'X_c = R·X_w + t',
  },
  tx: { title: 'tx — x component of t', body: 'Moves the world sideways in the camera frame (positive: the world shifts right in the image).' },
  ty: { title: 'ty — y component of t', body: 'Moves the world along camera y (positive: down in the image, because camera y points down).' },
  tz: { title: 'tz — z component of t', body: 'Moves the world along the optical axis. Larger tz pushes the scene farther away; points with Z_c ≤ 0 are behind the camera and are not imaged.' },
  Rt: {
    title: '[R | t] — extrinsic matrix (3×4)',
    body: 'The rigid transform from world to camera coordinates: the camera pose. 6 degrees of freedom (3 rotation + 3 translation).',
  },
  P: {
    title: 'P = K[R | t] — projection matrix (3×4)',
    body: 'Maps a homogeneous world point straight to a homogeneous pixel. Divide by the third coordinate to get (u, v). Defined up to scale: 11 degrees of freedom.',
    formula: 'λ·[u, v, 1]ᵀ = P·[X, Y, Z, 1]ᵀ',
  },
  C: {
    title: 'C — camera center (in world coordinates)',
    body: 'The pinhole: every ray of the camera passes through it. It is the null space of P (P·C̃ = 0).',
    formula: 'C = −Rᵀ·t',
    live: (c) => `now: C = ${vec(c.C)}`,
  },
  Xw: { title: 'X_w — point in world coordinates', body: 'The 3D point as stored in the scene, independent of any camera.' },
  Xc: {
    title: 'X_c — point in camera coordinates',
    body: 'The same point after the rigid transform: x right, y down, z = depth along the optical axis.',
    formula: 'X_c = R·X_w + t',
  },
  u: { title: 'u — pixel column', body: 'Perspective divide (X/Z) gives the normalized coordinate, then fx scales it to pixels and cx shifts it. u = 0 is the left edge.' },
  v: { title: 'v — pixel row', body: 'Same as u for the vertical axis. v grows downward; v = 0 is the top edge.' },
  depth: { title: 'Depth Z_c', body: 'Distance along the optical axis. It is divided out during projection, so all points on one ray land on the same pixel — a single image loses depth.' },
  frustum: { title: 'View frustum', body: 'The pyramid of space the camera can see. Its four edges are the back-projected image corners, so its shape is set entirely by K (fx, fy, cx, cy) and the image size.' },
  farFrustum: { title: 'Far frustum', body: 'Extends the frustum to a larger depth to show how much of the world the camera covers.' },
  imagePlane: { title: 'Image plane', body: `A virtual image plane drawn at depth Z = ${PLANE_DEPTH} in front of the camera, textured with the rendered image. A real sensor sits behind the pinhole and sees the image upside down; the virtual plane in front avoids the flip.` },
  rays: { title: 'Projection rays', body: 'Each 3D point is imaged along the straight line to the camera center C. Where the ray crosses the image plane is its pixel.' },
  photons: { title: 'Photons', body: 'Light travelling from each point to the pinhole. When a photon crosses the image plane, its pixel flashes in the image.' },
  camAxes: { title: 'Camera axes (OpenCV)', body: 'Red = x (right), green = y (down), blue = z (forward, the optical axis). They are the rows of R.' },
  worldAxes: { title: 'World axes', body: 'At the world origin: red = X, green = Y (up), blue = Z.' },
  image: { title: 'Image (640 × 480 px)', body: 'What the camera sees. Pixel origin (0, 0) is the top-left corner; u goes right, v goes down. Hover a point to see its projection step by step.' },
  opencv: { title: 'OpenCV camera convention', body: 'x right, y down, z forward. Used by OpenCV, COLMAP and 3D Gaussian Splatting. OpenGL / Blender / original NeRF use y up and look along −z.' },
  lockF: { title: 'Lock fx = fy', body: 'Square pixels: one focal length for both axes. Almost every real camera is close to this.' },
  animOrbit: { title: 'Orbit camera', body: 'The camera circles the house while always looking at it. R and t change every frame; K stays fixed.' },
  animZoom: { title: 'Zoom (change f)', body: 'Only fx and fy change. The image scales around (cx, cy) but the perspective — the relative positions of near and far objects — stays the same.' },
  animDolly: { title: 'Dolly zoom ("Vertigo" effect)', body: 'The camera moves back and forth while f grows with the distance, so the house keeps its size in the image. The perspective changes: the background seems to stretch or compress. Shows that zooming ≠ moving closer.' },
  animPrincipal: { title: 'Shift the principal point', body: 'Only cx and cy change. The image slides without the camera moving, and the frustum in 3D becomes skewed (off-axis projection).' },
};
initTooltips(TIPS, deriveCamera);

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
const labVisible = initTabs(v3.resize);

function frame() {
  requestAnimationFrame(frame);
  if (!labVisible()) return;
  const time = clock.getElapsedTime();
  if (S.anim) { stepAnim(time); syncSliders(); }
  const cam = deriveCamera();
  const proj = projectPoints(cam);
  lastProj = proj;
  const flash = update3D(cam, proj, time);
  draw2D(cam, proj, flash);
  updateInfo(cam, proj);
  v3.render();
}
requestAnimationFrame(frame);
