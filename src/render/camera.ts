import * as THREE from 'three';

/** Classic isometric elevation angle (arctan(1/sqrt(2))). */
const ISO_ELEVATION_RAD = Math.atan(1 / Math.SQRT2);
const CAMERA_DISTANCE = 120;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 5;
const ZOOM_WHEEL_FACTOR = 0.0015;
const ROTATION_ANIMATION_SECONDS = 0.25;

/**
 * Orthographic isometric camera: rotatable in 90° steps, zoomable,
 * pannable. The camera orbits a target point on the ground plane.
 */
export class IsoCamera {
  readonly camera: THREE.OrthographicCamera;
  private target = new THREE.Vector3();
  private rotationIndex = 0;
  private animatedAzimuth: number;
  private azimuthTarget: number;
  private viewportHeightWorld = 40;

  constructor(worldSize: number) {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    this.target.set(worldSize / 2, 0, worldSize / 2);
    this.animatedAzimuth = this.currentAzimuth();
    this.azimuthTarget = this.animatedAzimuth;
    this.updatePosition();
  }

  private currentAzimuth(): number {
    return Math.PI / 4 + this.rotationIndex * (Math.PI / 2);
  }

  /** Rotate the view by 90°; direction is +1 (counter-clockwise) or -1. */
  rotate(direction: 1 | -1): void {
    this.rotationIndex = (this.rotationIndex + direction + 4) % 4;
    this.azimuthTarget += direction * (Math.PI / 2);
  }

  zoomBy(wheelDeltaY: number): void {
    this.zoomByFactor(Math.exp(-wheelDeltaY * ZOOM_WHEEL_FACTOR));
  }

  /** Multiply the zoom level, e.g. by a pinch-gesture distance ratio. */
  zoomByFactor(factor: number): void {
    this.camera.zoom = THREE.MathUtils.clamp(this.camera.zoom * factor, MIN_ZOOM, MAX_ZOOM);
    this.camera.updateProjectionMatrix();
  }

  /** Pan by a screen-pixel delta, moving the target on the ground plane. */
  pan(deltaXPixels: number, deltaYPixels: number, viewportHeightPixels: number): void {
    const worldPerPixel = this.viewportHeightWorld / this.camera.zoom / viewportHeightPixels;
    // Screen right/up vectors projected onto the ground plane.
    const azimuth = this.animatedAzimuth;
    const right = new THREE.Vector3(
      Math.sin(azimuth + Math.PI / 2),
      0,
      Math.cos(azimuth + Math.PI / 2),
    );
    const forward = new THREE.Vector3(-Math.sin(azimuth), 0, -Math.cos(azimuth));
    // Compensate for the isometric foreshortening of vertical screen movement.
    const verticalScale = 1 / Math.sin(ISO_ELEVATION_RAD);
    this.target
      .addScaledVector(right, -deltaXPixels * worldPerPixel)
      .addScaledVector(forward, deltaYPixels * worldPerPixel * verticalScale);
    this.updatePosition();
  }

  setViewport(widthPixels: number, heightPixels: number): void {
    const aspect = widthPixels / heightPixels;
    const halfHeight = this.viewportHeightWorld / 2;
    this.camera.left = -halfHeight * aspect;
    this.camera.right = halfHeight * aspect;
    this.camera.top = halfHeight;
    this.camera.bottom = -halfHeight;
    this.camera.updateProjectionMatrix();
  }

  /** Advance the rotation animation; call once per frame. */
  update(deltaSeconds: number): void {
    const remaining = this.azimuthTarget - this.animatedAzimuth;
    if (Math.abs(remaining) > 1e-4) {
      const step = remaining * Math.min(1, deltaSeconds / ROTATION_ANIMATION_SECONDS);
      this.animatedAzimuth += step;
      if (Math.abs(this.azimuthTarget - this.animatedAzimuth) < 1e-3) {
        this.animatedAzimuth = this.azimuthTarget;
      }
      this.updatePosition();
    }
  }

  private updatePosition(): void {
    const azimuth = this.animatedAzimuth;
    const horizontal = CAMERA_DISTANCE * Math.cos(ISO_ELEVATION_RAD);
    const vertical = CAMERA_DISTANCE * Math.sin(ISO_ELEVATION_RAD);
    this.camera.position.set(
      this.target.x + horizontal * Math.sin(azimuth),
      this.target.y + vertical,
      this.target.z + horizontal * Math.cos(azimuth),
    );
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  }
}
