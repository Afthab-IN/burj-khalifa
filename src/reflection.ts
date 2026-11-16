import * as THREE from 'three';
const ICE_LEVEL = 0;

// Planar reflection for the horizontal ice plane (adapted from three's Reflector).
export class PlanarReflection {
  rt: THREE.WebGLRenderTarget;
  textureMatrix = new THREE.Matrix4();
  cam = new THREE.PerspectiveCamera();
  private plane = new THREE.Plane();
  private clip = new THREE.Vector4();
  private q = new THREE.Vector4();
  private v = new THREE.Vector3();
  private lookAt = new THREE.Vector3();
  private rot = new THREE.Matrix4();
  private normal = new THREE.Vector3(0, 1, 0);
  private origin = new THREE.Vector3(0, ICE_LEVEL, 0);
  scale = 0.5;
  onBefore: (() => void) | null = null;
  onAfter: (() => void) | null = null;

  constructor(w: number, h: number) {
    this.rt = new THREE.WebGLRenderTarget(Math.max(2, w * this.scale), Math.max(2, h * this.scale), {
      type: THREE.HalfFloatType,
      samples: 4,
    });
  }

  setSize(w: number, h: number) {
    this.rt.setSize(Math.max(2, Math.floor(w * this.scale)), Math.max(2, Math.floor(h * this.scale)));
  }

  render(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera, hide: THREE.Object3D[]) {
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    if (camPos.y < this.origin.y) return;
    const view = this.v.subVectors(this.origin, camPos);
    view.reflect(this.normal).negate().add(this.origin);

    this.rot.extractRotation(camera.matrixWorld);
    this.lookAt.set(0, 0, -1).applyMatrix4(this.rot).add(camPos);
    const target = new THREE.Vector3().subVectors(this.origin, this.lookAt).reflect(this.normal).negate().add(this.origin);

    const rc = this.cam;
    rc.position.copy(view);
    rc.up.set(0, 1, 0).applyMatrix4(this.rot).reflect(this.normal);
    rc.lookAt(target);
    rc.far = camera.far;
    rc.near = camera.near;
    rc.layers.set(0);
    rc.updateMatrixWorld();
    rc.projectionMatrix.copy(camera.projectionMatrix);
    rc.projectionMatrix.elements[8] *= -1;
    rc.projectionMatrix.elements[12] *= -1;

    this.textureMatrix.set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    this.textureMatrix.multiply(rc.projectionMatrix);
    this.textureMatrix.multiply(rc.matrixWorldInverse);

    // oblique near plane = water plane, so nothing under the water leaks in
    this.plane.setFromNormalAndCoplanarPoint(this.normal, this.origin);
    this.plane.applyMatrix4(rc.matrixWorldInverse);
    this.clip.set(this.plane.normal.x, this.plane.normal.y, this.plane.normal.z, this.plane.constant);
    const pm = rc.projectionMatrix;
    const q = this.q;
    q.x = (Math.sign(this.clip.x) + pm.elements[8]) / pm.elements[0];
    q.y = (Math.sign(this.clip.y) + pm.elements[9]) / pm.elements[5];
    q.z = -1.0;
    q.w = (1.0 + pm.elements[10]) / pm.elements[14];
    this.clip.multiplyScalar(2.0 / this.clip.dot(q));
    pm.elements[2] = this.clip.x;
    pm.elements[6] = this.clip.y;
    pm.elements[10] = this.clip.z + 1.0 - 0.003;
    pm.elements[14] = this.clip.w;

    const vis = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    const prevTarget = renderer.getRenderTarget();
    const prevShadow = renderer.shadowMap.autoUpdate;
    const prevNeeds = renderer.shadowMap.needsUpdate;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = false;
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    this.onBefore?.();
    renderer.render(scene, rc);
    this.onAfter?.();
    renderer.setRenderTarget(prevTarget);
    renderer.shadowMap.autoUpdate = prevShadow;
    renderer.shadowMap.needsUpdate = prevNeeds;
    hide.forEach((o, i) => (o.visible = vis[i]));
  }
}

