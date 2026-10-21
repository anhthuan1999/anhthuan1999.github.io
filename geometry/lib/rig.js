// three.js helpers: the 3D viewer with the shared scene, and a drawable camera rig.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { POINTS, EDGES, POINT_COLORS, W, H } from './scene.js';
import { add, scale, backproject } from './math.js';

export { THREE };

export function setLines(obj, segs, colors) {
  const pos = obj.geometry.attributes.position;
  segs.forEach(([a, b], i) => { pos.array.set(a, i * 6); pos.array.set(b, i * 6 + 3); });
  pos.needsUpdate = true;
  if (colors) {
    const col = obj.geometry.attributes.color;
    colors.forEach((c, i) => { col.array.set(c, i * 6); col.array.set(c, i * 6 + 3); });
    col.needsUpdate = true;
  }
  obj.geometry.setDrawRange(0, segs.length * 2);
}

export const rgb = (css) => {
  const c = new THREE.Color(css);
  return [c.r, c.g, c.b];
};

export function createViewer(container, { position, target }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f16);

  const viewer = new THREE.PerspectiveCamera(45, 1, 0.05, 200);
  viewer.position.set(...position);
  const controls = new OrbitControls(viewer, renderer.domElement);
  controls.target.set(...target);
  controls.enableDamping = true;

  scene.add(new THREE.GridHelper(10, 10, 0x3a4658, 0x1c2430));
  scene.add(new THREE.AxesHelper(1.2));

  const houseGeo = new THREE.BufferGeometry().setFromPoints(
    EDGES.flatMap(([a, b]) => [new THREE.Vector3(...POINTS[a]), new THREE.Vector3(...POINTS[b])]),
  );
  scene.add(new THREE.LineSegments(houseGeo, new THREE.LineBasicMaterial({ color: 0xc9d4e3 })));

  const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
  const pointMeshes = POINTS.map((p, i) => {
    const m = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color: POINT_COLORS[i] }));
    m.position.set(...p);
    m.scale.setScalar(0.07);
    m.userData.idx = i;
    scene.add(m);
    return m;
  });

  function resize() {
    const { clientWidth: w, clientHeight: h } = container;
    if (!w || !h) return;
    renderer.setSize(w, h);
    viewer.aspect = w / h;
    viewer.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function dynLines(maxSeg, material) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxSeg * 6), 3));
    if (material.vertexColors) {
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxSeg * 6), 3));
    }
    const obj = new THREE.LineSegments(geo, material);
    obj.frustumCulled = false;
    scene.add(obj);
    return obj;
  }

  function sphere(color, radius) {
    const m = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color }));
    m.scale.setScalar(radius);
    scene.add(m);
    return m;
  }

  // Calls onHover(index | null) when the mouse is over one of the scene points
  function onHoverPoint(onHover) {
    const raycaster = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    renderer.domElement.addEventListener('pointermove', (e) => {
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      raycaster.setFromCamera(ndc, viewer);
      const hit = raycaster.intersectObjects(pointMeshes)[0];
      onHover(hit ? hit.object.userData.idx : null);
    });
    renderer.domElement.addEventListener('pointerleave', () => onHover(null));
  }

  function render() {
    controls.update();
    renderer.render(scene, viewer);
  }

  return { scene, renderer, viewer, controls, pointMeshes, sphereGeo, resize, dynLines, sphere, onHoverPoint, render };
}

// A camera drawn in 3D: center, axes, frustum, and an image plane textured with its 2D canvas
export class CameraRig {
  constructor(v, canvas, color, { planeDepth = 1.5, farDepth = 7, axisLength = 0.6 } = {}) {
    this.planeDepth = planeDepth;
    this.farDepth = farDepth;
    this.axisLength = axisLength;
    this.frustum = v.dynLines(8, new THREE.LineBasicMaterial({ color }));
    this.far = v.dynLines(8, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22 }));
    this.axes = v.dynLines(3, new THREE.LineBasicMaterial({ vertexColors: true }));
    this.center = v.sphere(color, 0.06);

    this.texture = new THREE.CanvasTexture(canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.planeGeo = new THREE.BufferGeometry();
    this.planeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
    this.planeGeo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 1, 1, 1, 1, 0, 0, 0]), 2));
    this.planeGeo.setIndex([0, 1, 2, 0, 2, 3]);
    this.plane = new THREE.Mesh(this.planeGeo, new THREE.MeshBasicMaterial({
      map: this.texture, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.plane.frustumCulled = false;
    v.scene.add(this.plane);
  }

  update(cam, { plane = true, far = true } = {}) {
    const corners = [[0, 0], [W, 0], [W, H], [0, H]];
    const pc = corners.map(([u, v]) => backproject(cam, u, v, this.planeDepth));
    const fc = corners.map(([u, v]) => backproject(cam, u, v, this.farDepth));

    setLines(this.frustum, [...pc.map((p) => [cam.C, p]), ...pc.map((p, i) => [p, pc[(i + 1) % 4]])]);
    setLines(this.far, [...pc.map((p, i) => [p, fc[i]]), ...fc.map((p, i) => [p, fc[(i + 1) % 4]])]);
    this.far.visible = far;

    const pos = this.planeGeo.attributes.position;
    pc.forEach((p, i) => pos.array.set(p, i * 3));
    pos.needsUpdate = true;
    this.plane.visible = plane;
    this.texture.needsUpdate = true;

    setLines(this.axes, [0, 1, 2].map((k) => [cam.C, add(cam.C, scale(cam.R.slice(k * 3, k * 3 + 3), this.axisLength))]),
      [[1, 0.36, 0.36], [0.36, 1, 0.54], [0.36, 0.62, 1]]);
    this.center.position.set(...cam.C);
  }
}
