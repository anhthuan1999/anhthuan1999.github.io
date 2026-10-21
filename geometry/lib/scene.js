// The shared toy scene (a little house plus free points) and 2D image drawing.
import { NEAR, lerp, toCam, projectCam } from './math.js';

export const W = 640, H = 480;          // image size in pixels
export const TARGET = [0, 0.8, 0];      // where cameras usually look

const s = 0.6;
export const POINTS = [
  [-s, 0, -s], [s, 0, -s], [s, 0, s], [-s, 0, s],
  [-s, 1.2, -s], [s, 1.2, -s], [s, 1.2, s], [-s, 1.2, s],
  [-s, 1.8, 0], [s, 1.8, 0],
  [2.2, 0.4, -1.6], [-2.1, 0.9, 1.4], [-1.6, 1.5, -2.2], [2.0, 1.2, 1.9],
];
export const EDGES = [
  [0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4],
  [0, 4], [1, 5], [2, 6], [3, 7], [4, 8], [7, 8], [5, 9], [6, 9], [8, 9],
];
export const POINT_COLORS = POINTS.map((_, i) => `hsl(${Math.round(i / POINTS.length * 360)}, 80%, 62%)`);

export const GRID_SEGS = [];
for (let i = -5; i <= 5; i++) {
  GRID_SEGS.push([[i, 0, -5], [i, 0, 5]], [[-5, 0, i], [5, 0, i]]);
}

export const MONO = '13px JetBrains Mono, monospace';

// Project a world segment, clipping it against the near plane
export function projectSeg(cam, a, b) {
  let ca = toCam(cam, a), cb = toCam(cam, b);
  if (ca[2] < NEAR && cb[2] < NEAR) return null;
  if (ca[2] < NEAR) ca = lerp(ca, cb, (NEAR - ca[2]) / (cb[2] - ca[2]));
  if (cb[2] < NEAR) cb = lerp(cb, ca, (NEAR - cb[2]) / (ca[2] - cb[2]));
  return [projectCam(cam, ca), projectCam(cam, cb)];
}

export function strokeSegs(ctx, cam, segs, style, width) {
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.beginPath();
  for (const [a, b] of segs) {
    const s2 = projectSeg(cam, a, b);
    if (!s2) continue;
    ctx.moveTo(...s2[0]);
    ctx.lineTo(...s2[1]);
  }
  ctx.stroke();
}

// Background, ground grid and house wireframe
export function drawBase(ctx, cam, { edgeStyle = 'rgba(220,229,240,0.9)' } = {}) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#141b27');
  g.addColorStop(1, '#0b0f16');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  strokeSegs(ctx, cam, GRID_SEGS, '#2c3747', 1);
  strokeSegs(ctx, cam, EDGES.map(([a, b]) => [POINTS[a], POINTS[b]]), edgeStyle, 2);
}

export function projectPoints(cam, points = POINTS) {
  return points.map((X) => {
    const Xc = toCam(cam, X);
    if (Xc[2] <= NEAR) return { Xc, uv: null, inImage: false };
    const uv = projectCam(cam, Xc);
    return { Xc, uv, inImage: uv[0] >= 0 && uv[0] <= W && uv[1] >= 0 && uv[1] <= H };
  });
}

export function disc(ctx, uv, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(uv[0], uv[1], r, 0, Math.PI * 2);
  ctx.fill();
}

export function ring(ctx, uv, r, stroke, width = 2) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.arc(uv[0], uv[1], r, 0, Math.PI * 2);
  ctx.stroke();
}

export function cross2D(ctx, uv, r, stroke, width = 2) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(uv[0] - r, uv[1] - r); ctx.lineTo(uv[0] + r, uv[1] + r);
  ctx.moveTo(uv[0] - r, uv[1] + r); ctx.lineTo(uv[0] + r, uv[1] - r);
  ctx.stroke();
}

// Draw the homogeneous line a·u + b·v + c = 0 across the whole image
export function drawLine(ctx, l, style, width = 1.5, dash = []) {
  const n = Math.hypot(l[0], l[1]);
  if (n < 1e-12) return;
  const [a, b, c] = [l[0] / n, l[1] / n, l[2] / n];
  const d = a * W / 2 + b * H / 2 + c;           // signed distance of the image center
  const p = [W / 2 - a * d, H / 2 - b * d];       // closest point on the line
  const dir = [-b, a];
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(p[0] - dir[0] * 4000, p[1] - dir[1] * 4000);
  ctx.lineTo(p[0] + dir[0] * 4000, p[1] + dir[1] * 4000);
  ctx.stroke();
  ctx.setLineDash([]);
}

// Distance (pixels) from point uv to homogeneous line l
export const pointLineDist = (uv, l) => Math.abs(l[0] * uv[0] + l[1] * uv[1] + l[2]) / Math.hypot(l[0], l[1]);

// Intersection of two homogeneous lines, or null if (nearly) parallel
export function intersectLines(l1, l2) {
  const p = [l1[1] * l2[2] - l1[2] * l2[1], l1[2] * l2[0] - l1[0] * l2[2], l1[0] * l2[1] - l1[1] * l2[0]];
  if (Math.abs(p[2]) < 1e-12 * Math.hypot(p[0], p[1])) return null;
  return [p[0] / p[2], p[1] / p[2]];
}

// Draw an epipole: a marker if it is near the image, otherwise an arrow towards it on the border
export function drawEpipole(ctx, e, color, label) {
  ctx.font = MONO;
  if (Math.abs(e[2]) > 1e-9) {
    const uv = [e[0] / e[2], e[1] / e[2]];
    if (uv[0] > -40 && uv[0] < W + 40 && uv[1] > -40 && uv[1] < H + 40) {
      ring(ctx, uv, 8, color, 2);
      disc(ctx, uv, 2.5, color);
      ctx.fillStyle = color;
      ctx.fillText(label, uv[0] + 11, uv[1] - 9);
      return;
    }
  }
  // far away or at infinity: arrow on the border pointing to it
  let dir = Math.abs(e[2]) > 1e-9 ? [e[0] / e[2] - W / 2, e[1] / e[2] - H / 2] : [e[0], e[1]];
  if (Math.abs(e[2]) > 1e-9 && e[2] < 0) dir = [-dir[0], -dir[1]];
  const n = Math.hypot(dir[0], dir[1]) || 1;
  const d = [dir[0] / n, dir[1] / n];
  const k = Math.min(Math.abs((W / 2 - 18) / (d[0] || 1e-9)), Math.abs((H / 2 - 18) / (d[1] || 1e-9)));
  const p = [W / 2 + d[0] * k, H / 2 + d[1] * k];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(p[0] + d[0] * 12, p[1] + d[1] * 12);
  ctx.lineTo(p[0] - d[1] * 7, p[1] + d[0] * 7);
  ctx.lineTo(p[0] + d[1] * 7, p[1] - d[0] * 7);
  ctx.fill();
  const txt = Math.abs(e[2]) > 1e-9 ? `${label} (far)` : `${label} at ∞`;
  const tw = ctx.measureText(txt).width;
  ctx.fillText(txt, Math.min(W - tw - 6, Math.max(6, p[0] - d[0] * 26 - tw / 2)), Math.min(H - 8, Math.max(16, p[1] - d[1] * 26 + 4)));
}

