// Small linear algebra + pinhole camera helpers.
// 3x3 matrices are row-major arrays of 9 numbers; vectors are arrays of 3.

export const DEG = Math.PI / 180;
export const NEAR = 0.05;

export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const lerp = (a, b, s) => add(a, scale(sub(b, a), s));
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const normalize = (a) => scale(a, 1 / norm(a));
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

export const matVec = (M, v) => [
  M[0] * v[0] + M[1] * v[1] + M[2] * v[2],
  M[3] * v[0] + M[4] * v[1] + M[5] * v[2],
  M[6] * v[0] + M[7] * v[1] + M[8] * v[2],
];
export const matTVec = (M, v) => [
  M[0] * v[0] + M[3] * v[1] + M[6] * v[2],
  M[1] * v[0] + M[4] * v[1] + M[7] * v[2],
  M[2] * v[0] + M[5] * v[1] + M[8] * v[2],
];
export function matMul(A, B) {
  const C = new Array(9);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      C[r * 3 + c] = A[r * 3] * B[c] + A[r * 3 + 1] * B[3 + c] + A[r * 3 + 2] * B[6 + c];
    }
  }
  return C;
}
export const transpose = (A) => [A[0], A[3], A[6], A[1], A[4], A[7], A[2], A[5], A[8]];
export const skew = (v) => [0, -v[2], v[1], v[2], 0, -v[0], -v[1], v[0], 0];
export const det3 = (A) =>
  A[0] * (A[4] * A[8] - A[5] * A[7]) - A[1] * (A[3] * A[8] - A[5] * A[6]) + A[2] * (A[3] * A[7] - A[4] * A[6]);
export const rows3 = (A) => [A.slice(0, 3), A.slice(3, 6), A.slice(6, 9)];
export function frobNormalize(A) {
  const n = Math.hypot(...A);
  return A.map((x) => x / n);
}

// R = Rz(rz) Ry(ry) Rx(rx), angles in radians
export function eulerToR(rx, ry, rz) {
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);
  return [
    cz * cy, cz * sy * sx - sz * cx, cz * sy * cx + sz * sx,
    sz * cy, sz * sy * sx + cz * cx, sz * sy * cx - cz * sx,
    -sy, cy * sx, cy * cx,
  ];
}

export function rToEuler(R) {
  return [Math.atan2(R[7], R[8]), Math.asin(clamp(-R[6], -1, 1)), Math.atan2(R[3], R[0])];
}

// World-to-camera rotation for a camera at C looking at target (y-down camera, y-up world)
export function lookAtR(C, target, up = [0, 1, 0]) {
  const z = normalize(sub(target, C));
  let x = cross(z, up);
  x = norm(x) < 1e-6 ? [1, 0, 0] : normalize(x);
  const y = cross(z, x);
  return [...x, ...y, ...z];
}

// Camera orientation from yaw / pitch / roll (degrees). yaw = pitch = 0 looks along world −Z.
export function yprToR(yaw, pitch, roll) {
  const y = yaw * DEG, p = pitch * DEG;
  const d = [-Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)];
  return matMul(eulerToR(0, 0, roll * DEG), lookAtR([0, 0, 0], d));
}

// Yaw / pitch (degrees) that make a camera at C look at target
export function aimYawPitch(C, target) {
  const d = normalize(sub(target, C));
  return [Math.atan2(-d[0], -d[2]) / DEG, Math.asin(clamp(d[1], -1, 1)) / DEG];
}

// ---------------------------------------------------------------------------
// Pinhole camera: { R, t, C, fx, fy, cx, cy }, X_c = R X_w + t
// ---------------------------------------------------------------------------
export function makeCamera(R, C, { fx, fy, cx, cy }) {
  return { R, t: scale(matVec(R, C), -1), C, fx, fy, cx, cy };
}
export function cameraFromRt(R, t, { fx, fy, cx, cy }) {
  return { R, t, C: scale(matTVec(R, t), -1), fx, fy, cx, cy };
}
export const Kmat = (c) => [c.fx, 0, c.cx, 0, c.fy, c.cy, 0, 0, 1];
export const Kinv = (c) => [1 / c.fx, 0, -c.cx / c.fx, 0, 1 / c.fy, -c.cy / c.fy, 0, 0, 1];
export const toCam = (cam, X) => add(matVec(cam.R, X), cam.t);
export const toWorld = (cam, Xc) => matTVec(cam.R, sub(Xc, cam.t));
export const projectCam = (cam, Xc) => [cam.fx * Xc[0] / Xc[2] + cam.cx, cam.fy * Xc[1] / Xc[2] + cam.cy];
export function project(cam, X) {
  const Xc = toCam(cam, X);
  return Xc[2] > NEAR ? projectCam(cam, Xc) : null;
}
export const backproject = (cam, u, v, d) =>
  toWorld(cam, [(u - cam.cx) / cam.fx * d, (v - cam.cy) / cam.fy * d, d]);
// unit direction (world) of the ray through pixel (u, v)
export const rayDir = (cam, u, v) => normalize(matTVec(cam.R, [(u - cam.cx) / cam.fx, (v - cam.cy) / cam.fy, 1]));

// 3x4 projection matrix P = K [R | t], as 3 rows of 4
export function projMatrix(cam) {
  const K = Kmat(cam);
  const Rt = [0, 1, 2].map((r) => [cam.R[r * 3], cam.R[r * 3 + 1], cam.R[r * 3 + 2], cam.t[r]]);
  return [0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => K[r * 3] * Rt[0][c] + K[r * 3 + 1] * Rt[1][c] + K[r * 3 + 2] * Rt[2][c]));
}

// ---------------------------------------------------------------------------
// Two-view geometry
// ---------------------------------------------------------------------------
// Pose of camera b relative to camera a: X_b = R X_a + t
export function relativePose(a, b) {
  const R = matMul(b.R, transpose(a.R));
  return { R, t: sub(b.t, matVec(R, a.t)) };
}

// Essential matrix: x̂_bᵀ E x̂_a = 0 for normalized coordinates
export function essential(a, b) {
  const { R, t } = relativePose(a, b);
  return matMul(skew(t), R);
}

// Fundamental matrix: x_bᵀ F x_a = 0 in pixels; l_b = F x_a is the epipolar line in b
export function fundamental(a, b) {
  return matMul(matMul(transpose(Kinv(b)), essential(a, b)), Kinv(a));
}

// Epipole in camera b = image of camera a's center (homogeneous, may be at infinity)
export function epipole(a, b) {
  return matVec(Kmat(b), toCam(b, a.C));
}

// ---------------------------------------------------------------------------
// Triangulation (linear DLT, any number of views)
// ---------------------------------------------------------------------------
// Jacobi eigen-decomposition of a symmetric n×n matrix (array of rows)
export function symEig(A) {
  const n = A.length;
  const a = A.map((r) => r.slice());
  const V = a.map((_, i) => a.map((__, j) => (i === j ? 1 : 0)));
  let total = 0;
  for (const r of a) for (const x of r) total += x * x;
  for (let sweep = 0; sweep < 60; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += a[p][q] ** 2;
    if (off <= 1e-30 * total) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const tt = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(tt * tt + 1), s = tt * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = V[k][p], vkq = V[k][q];
          V[k][p] = c * vkp - s * vkq;
          V[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  return { values: a.map((r, i) => r[i]), vectors: V };
}

// Triangulate one point from pixel observations uvs[i] in cams[i].
// Returns the point plus the DLT system A X̃ = 0 (normalized coordinates) and the eigenvalues of AᵀA.
export function triangulateDLT(cams, uvs) {
  const rows = [];
  cams.forEach((cam, i) => {
    // work in normalized coordinates for better conditioning
    const x = (uvs[i][0] - cam.cx) / cam.fx, y = (uvs[i][1] - cam.cy) / cam.fy;
    const P = [0, 1, 2].map((r) => [cam.R[r * 3], cam.R[r * 3 + 1], cam.R[r * 3 + 2], cam.t[r]]);
    rows.push(P[0].map((v, j) => x * P[2][j] - v));
    rows.push(P[1].map((v, j) => y * P[2][j] - v));
  });
  const AtA = [0, 1, 2, 3].map((i) => [0, 1, 2, 3].map((j) => rows.reduce((s, r) => s + r[i] * r[j], 0)));
  const { values, vectors } = symEig(AtA);
  let k = 0;
  values.forEach((v, i) => { if (v < values[k]) k = i; });
  const h = vectors.map((r) => r[k]);
  return { X: [h[0] / h[3], h[1] / h[3], h[2] / h[3]], A: rows, values: values.slice().sort((a, b) => a - b) };
}

export const triangulate = (cams, uvs) => triangulateDLT(cams, uvs).X;

// ---------------------------------------------------------------------------
// Estimating F: normalized 8-point algorithm
// ---------------------------------------------------------------------------
// Hartley normalization: centroid to the origin, mean distance √2
export function hartley(pts) {
  const m = [0, 0];
  pts.forEach((p) => { m[0] += p[0] / pts.length; m[1] += p[1] / pts.length; });
  const meanDist = pts.reduce((acc, p) => acc + Math.hypot(p[0] - m[0], p[1] - m[1]), 0) / pts.length;
  const s = Math.SQRT2 / (meanDist || 1);
  return [s, 0, -s * m[0], 0, s, -s * m[1], 0, 0, 1];
}

// Unit eigenvector of AᵀA (3x3 A) with the smallest eigenvalue: the right null vector of A
export function nullVector3(A) {
  const AtA = [0, 1, 2].map((i) => [0, 1, 2].map((j) => A[i] * A[j] + A[3 + i] * A[3 + j] + A[6 + i] * A[6 + j]));
  const { values, vectors } = symEig(AtA);
  let k = 0;
  values.forEach((v, i) => { if (v < values[k]) k = i; });
  return vectors.map((r) => r[k]);
}

// Closest rank-2 matrix: drop the smallest singular value, F' = F (I − v vᵀ)
export function enforceRank2(F) {
  const v = nullVector3(F);
  const Fv = matVec(F, v);
  return F.map((x, i) => x - Fv[Math.floor(i / 3)] * v[i % 3]);
}

// x2ᵀ F x1 = 0 from n ≥ 8 matches. Returns F (unit norm), the eigenvalues of AᵀA and the normalizing transforms.
export function eightPoint(x1s, x2s, normalized = true) {
  const I = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const T1 = normalized ? hartley(x1s) : I;
  const T2 = normalized ? hartley(x2s) : I;
  const rows = x1s.map((p, i) => {
    const a = matVec(T1, [p[0], p[1], 1]);
    const b = matVec(T2, [x2s[i][0], x2s[i][1], 1]);
    return [b[0] * a[0], b[0] * a[1], b[0], b[1] * a[0], b[1] * a[1], b[1], a[0], a[1], 1];
  });
  const AtA = [...Array(9)].map((_, i) => [...Array(9)].map((__, j) => rows.reduce((acc, r) => acc + r[i] * r[j], 0)));
  const { values, vectors } = symEig(AtA);
  let k = 0;
  values.forEach((v, i) => { if (v < values[k]) k = i; });
  const Fhat = enforceRank2(vectors.map((r) => r[k]));
  const F = frobNormalize(matMul(matMul(transpose(T2), Fhat), T1));
  return { F, values: values.slice().sort((a, b) => a - b), T1, T2 };
}

// Symmetric epipolar distance (pixels): mean distance of each point to the other's epipolar line
export function epiDist(F, x1, x2) {
  const l2 = matVec(F, [x1[0], x1[1], 1]);
  const l1 = matTVec(F, [x2[0], x2[1], 1]);
  const d2 = Math.abs(l2[0] * x2[0] + l2[1] * x2[1] + l2[2]) / Math.hypot(l2[0], l2[1]);
  const d1 = Math.abs(l1[0] * x1[0] + l1[1] * x1[1] + l1[2]) / Math.hypot(l1[0], l1[1]);
  return (d1 + d2) / 2;
}

// ---------------------------------------------------------------------------
// Bundle adjustment helpers
// ---------------------------------------------------------------------------
// Rotation matrix from an axis-angle vector (exponential map)
export function rodrigues(w) {
  const th = norm(w);
  if (th < 1e-12) return [1, -w[2], w[1], w[2], 1, -w[0], -w[1], w[0], 1];
  const K = skew(scale(w, 1 / th));
  const K2 = matMul(K, K);
  const s = Math.sin(th), c = 1 - Math.cos(th);
  return [1, 0, 0, 0, 1, 0, 0, 0, 1].map((x, i) => x + s * K[i] + c * K2[i]);
}

// Solve A x = b (A: array of rows) by Gaussian elimination with partial pivoting
export function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((r, i) => [...r, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    if (Math.abs(d) < 1e-300) continue;
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / d;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) {
    if (Math.abs(M[r][r]) < 1e-300) continue;
    let acc = M[r][n];
    for (let c = r + 1; c < n; c++) acc -= M[r][c] * x[c];
    x[r] = acc / M[r][r];
  }
  return x;
}

// Similarity (scale s, rotation R, translation t) that best maps src points onto dst (Umeyama)
export function alignSimilarity(src, dst) {
  const n = src.length;
  const ms = scale(src.reduce(add, [0, 0, 0]), 1 / n);
  const md = scale(dst.reduce(add, [0, 0, 0]), 1 / n);
  const S = new Array(9).fill(0);
  let varS = 0;
  src.forEach((p, k) => {
    const a = sub(p, ms), b = sub(dst[k], md);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) S[i * 3 + j] += b[i] * a[j] / n;
    varS += dot(a, a) / n;
  });
  // SVD of S through the eigenvectors of SᵀS
  const StS = [0, 1, 2].map((i) => [0, 1, 2].map((j) => S[i] * S[j] + S[3 + i] * S[3 + j] + S[6 + i] * S[6 + j]));
  const { values, vectors } = symEig(StS);
  const order = [0, 1, 2].sort((i, j) => values[j] - values[i]);
  const V = order.map((k) => vectors.map((r) => r[k]));
  if (dot(cross(V[0], V[1]), V[2]) < 0) V[2] = scale(V[2], -1);
  const U = [0, 1].map((k) => normalize(matVec(S, V[k])));
  U.push(cross(U[0], U[1]));
  const d = [0, 1, 2].map((k) => dot(U[k], matVec(S, V[k])));
  const R = [...Array(9)].map((_, i) => [0, 1, 2].reduce((acc, k) => acc + U[k][Math.floor(i / 3)] * V[k][i % 3], 0));
  const s = varS > 0 ? (d[0] + d[1] + d[2]) / varS : 1;
  const t = sub(md, scale(matVec(R, ms), s));
  return { s, R, t, apply: (p) => add(scale(matVec(R, p), s), t) };
}

// ---------------------------------------------------------------------------
// Random numbers (seeded, so noise can be resampled on demand)
// ---------------------------------------------------------------------------
export function rng(seed) {
  let s = seed >>> 0;
  const uniform = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const gauss = () => Math.sqrt(-2 * Math.log(1 - uniform())) * Math.cos(2 * Math.PI * uniform());
  return { uniform, gauss };
}
