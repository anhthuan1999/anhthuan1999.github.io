// 3D Gaussian splatting math: covariance, projection to a 2D splat (EWA), per-pixel alpha.
// A Gaussian is { mu, scale: [sx, sy, sz], R (row-major, columns = local axes in world), opacity, color: [r, g, b] }.
import { NEAR, add, matMul, matVec, transpose, toCam, projectCam, rng } from './math.js';

// Σ = R S Sᵀ Rᵀ — always symmetric positive semi-definite, which is why 3DGS stores (R, S) instead of Σ
export function covariance3D(R, s) {
  const M = R.map((v, i) => v * s[i % 3]);
  return matMul(M, transpose(M));
}

// Unit quaternion (w, x, y, z) of a rotation matrix — the form 3DGS stores
export function quaternionFromR(R) {
  const tr = R[0] + R[4] + R[8];
  let w, x, y, z;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    w = s / 4; x = (R[7] - R[5]) / s; y = (R[2] - R[6]) / s; z = (R[3] - R[1]) / s;
  } else if (R[0] > R[4] && R[0] > R[8]) {
    const s = Math.sqrt(1 + R[0] - R[4] - R[8]) * 2;
    w = (R[7] - R[5]) / s; x = s / 4; y = (R[1] + R[3]) / s; z = (R[2] + R[6]) / s;
  } else if (R[4] > R[8]) {
    const s = Math.sqrt(1 + R[4] - R[0] - R[8]) * 2;
    w = (R[2] - R[6]) / s; x = (R[1] + R[3]) / s; y = s / 4; z = (R[5] + R[7]) / s;
  } else {
    const s = Math.sqrt(1 + R[8] - R[0] - R[4]) * 2;
    w = (R[3] - R[1]) / s; x = (R[2] + R[6]) / s; y = (R[5] + R[7]) / s; z = s / 4;
  }
  return w < 0 ? [-w, -x, -y, -z] : [w, x, y, z];
}

// Project a 3D Gaussian into a camera (local affine approximation, Zwicker et al. 2001 / Kerbl et al. 2023).
// Returns null if the center is behind the camera.
export function projectGaussian(cam, g, { dilation = 0.3 } = {}) {
  const mc = toCam(cam, g.mu);
  if (mc[2] <= NEAR) return null;
  const [x, y, z] = mc;
  const J = [cam.fx / z, 0, -cam.fx * x / (z * z), 0, cam.fy / z, -cam.fy * y / (z * z)];   // 2x3, row-major
  const cov3 = covariance3D(g.R, g.scale);
  const covCam = matMul(matMul(cam.R, cov3), transpose(cam.R));                            // W Σ Wᵀ
  const JS = [0, 1].map((r) => [0, 1, 2].map((c) => J[r * 3] * covCam[c] + J[r * 3 + 1] * covCam[3 + c] + J[r * 3 + 2] * covCam[6 + c]));
  const a = JS[0][0] * J[0] + JS[0][1] * J[1] + JS[0][2] * J[2] + dilation;
  const b = JS[0][0] * J[3] + JS[0][1] * J[4] + JS[0][2] * J[5];
  const c = JS[1][0] * J[3] + JS[1][1] * J[4] + JS[1][2] * J[5] + dilation;
  const det = a * c - b * b;
  if (det <= 0) return null;
  const mid = (a + c) / 2;
  const disc = Math.sqrt(Math.max(0.1, mid * mid - det));
  const lambdas = [mid + disc, Math.max(mid - disc, 1e-9)];
  return {
    uv: projectCam(cam, mc), depth: z, mc, J, cov3, covCam,
    cov: [a, b, c], conic: [c / det, -b / det, a / det], lambdas,
    radius: Math.ceil(3 * Math.sqrt(lambdas[0])),
  };
}

// Opacity of a splat at pixel p, with the 3DGS cut-offs (α < 1/255 skipped, α ≤ 0.99)
export function alphaAt(p, splat, opacity) {
  const dx = p[0] - splat.uv[0], dy = p[1] - splat.uv[1];
  const power = -0.5 * (splat.conic[0] * dx * dx + 2 * splat.conic[1] * dx * dy + splat.conic[2] * dy * dy);
  if (power > 0) return 0;
  const alpha = Math.min(0.99, opacity * Math.exp(power));
  return alpha < 1 / 255 ? 0 : alpha;
}

// Squared Mahalanobis distance of p from the splat center
export function mahalanobis2(p, splat) {
  const dx = p[0] - splat.uv[0], dy = p[1] - splat.uv[1];
  return splat.conic[0] * dx * dx + 2 * splat.conic[1] * dx * dy + splat.conic[2] * dy * dy;
}

// Ellipse k·σ of a 2x2 covariance [a, b, c] centered at uv
export function strokeEllipse(ctx, uv, cov, k, style, width = 1.5, dash = []) {
  const [a, b, c] = cov;
  const mid = (a + c) / 2, disc = Math.sqrt(Math.max(0, mid * mid - (a * c - b * b)));
  const theta = 0.5 * Math.atan2(2 * b, a - c);
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.ellipse(uv[0], uv[1], k * Math.sqrt(mid + disc), k * Math.sqrt(Math.max(mid - disc, 0)), theta, 0, Math.PI * 2);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Random 3D samples X = μ + R S n, n ~ N(0, I)
export function sampleGaussian(g, n, seed = 1) {
  const r = rng(seed);
  return [...Array(n)].map(() => {
    const v = [r.gauss() * g.scale[0], r.gauss() * g.scale[1], r.gauss() * g.scale[2]];
    return add(g.mu, matVec(g.R, v));
  });
}

// Mean and covariance [a, b, c] of 2D points
export function covariance2D(pts) {
  const n = pts.length;
  const m = pts.reduce((acc, p) => [acc[0] + p[0] / n, acc[1] + p[1] / n], [0, 0]);
  let a = 0, b = 0, c = 0;
  for (const p of pts) {
    const dx = p[0] - m[0], dy = p[1] - m[1];
    a += dx * dx / n; b += dx * dy / n; c += dy * dy / n;
  }
  return { mean: m, cov: [a, b, c] };
}

export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
