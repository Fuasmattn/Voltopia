import * as THREE from 'three';
import type { TileDiff } from '../shared/types.ts';
import { BALANCE } from '../shared/constants.ts';
import type { DiffLayer, RenderEnvironment } from './renderer.ts';

const MAX_CLOUDS = 22;
const CLOUD_ALTITUDE = 9;
const CLOUD_DRIFT_TILES_PER_S = 0.7;
const MAX_RAIN = 400;
const RAIN_FALL_TILES_PER_S = 14;
const SNOW_FALL_TILES_PER_S = 3;
const SNOW_DRIFT_TILES = 1.2;
const RAIN_COLOR = 0x9fb6c9;
const SNOW_COLOR = 0xffffff;

/** Soft round sprite texture (white center fading out). */
function createPuffTexture(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(64, 64, 8, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.6, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

/** Deterministic hash to 0..1 per index/salt. */
function hash01(index: number, salt: number): number {
  let h = (index * 374761393 + salt * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h >>> 8) / 16777216;
}

/**
 * Weather made visible: cloud puffs with matching ground shadows drift
 * with the wind (count follows cloud cover), and rain streaks fall
 * during heavy overcast.
 */
export class WeatherFx implements DiffLayer {
  private readonly puffs: THREE.InstancedMesh;
  private readonly shadows: THREE.InstancedMesh;
  private readonly puffMaterial: THREE.MeshBasicMaterial;
  private readonly shadowMaterial: THREE.MeshBasicMaterial;
  private readonly rain: THREE.InstancedMesh;
  private readonly rainMaterial: THREE.MeshBasicMaterial;
  private readonly gridSize: number;
  private cloudCover = 0.3;
  private windFactor = 0.5;
  private nightFactor = 0;
  private temperature = 15;
  private reducedMotion = false;
  private drift = 0;
  private rainCycle = 0;
  private readonly rainPhase: Float32Array;
  private readonly matrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene, gridSize: number) {
    this.gridSize = gridSize;
    const texture = createPuffTexture();

    const puffGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.puffMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.puffs = new THREE.InstancedMesh(puffGeometry, this.puffMaterial, MAX_CLOUDS);
    this.puffs.frustumCulled = false;
    this.puffs.count = 0;
    this.puffs.renderOrder = 5;
    scene.add(this.puffs);

    const shadowGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.shadowMaterial = new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0.14,
      depthWrite: false,
      color: 0x000000,
    });
    this.shadows = new THREE.InstancedMesh(shadowGeometry, this.shadowMaterial, MAX_CLOUDS);
    this.shadows.frustumCulled = false;
    this.shadows.count = 0;
    this.shadows.renderOrder = 1;
    scene.add(this.shadows);

    const rainGeometry = new THREE.BoxGeometry(0.015, 0.9, 0.015);
    this.rainMaterial = new THREE.MeshBasicMaterial({
      color: RAIN_COLOR,
      transparent: true,
      opacity: 0.28,
    });
    this.rain = new THREE.InstancedMesh(rainGeometry, this.rainMaterial, MAX_RAIN);
    this.rain.frustumCulled = false;
    this.rain.count = 0;
    scene.add(this.rain);
    this.rainPhase = new Float32Array(MAX_RAIN);
    for (let i = 0; i < MAX_RAIN; i++) this.rainPhase[i] = hash01(i, 7);
  }

  applyDiffs(_diffs: TileDiff[]): void {
    // weather visuals do not depend on tiles
  }

  setEnvironment(environment: RenderEnvironment): void {
    this.windFactor = environment.windFactor;
    this.nightFactor = environment.nightFactor;
    this.temperature = environment.temperature;
  }

  /** Cloud cover comes from stats via the renderer. */
  setCloudCover(cloudCover: number): void {
    this.cloudCover = cloudCover;
  }

  setReducedMotion(reduced: boolean): void {
    this.reducedMotion = reduced;
  }

  update(deltaSeconds: number): void {
    if (!this.reducedMotion) {
      this.drift += deltaSeconds * CLOUD_DRIFT_TILES_PER_S * (0.3 + this.windFactor);
    }
    this.writeClouds();
    this.writeRain(deltaSeconds);
  }

  private writeClouds(): void {
    const span = this.gridSize * 1.4;
    const count = Math.round(this.cloudCover * MAX_CLOUDS);
    // Clouds fade at night (they'd read as glowing white blobs).
    this.puffMaterial.opacity = 0.5 * (1 - this.nightFactor * 0.75);
    for (let i = 0; i < count; i++) {
      const size = 5 + hash01(i, 1) * 9;
      const baseX = hash01(i, 2) * span;
      const z = -0.2 * this.gridSize + hash01(i, 3) * span;
      const x = (((baseX + this.drift * (0.7 + hash01(i, 4) * 0.6)) % span) + span) % span;
      const worldX = x - 0.2 * this.gridSize;
      this.matrix.makeScale(size, 1, size * (0.7 + hash01(i, 5) * 0.5));
      this.matrix.setPosition(worldX, CLOUD_ALTITUDE + hash01(i, 6) * 2, z);
      this.puffs.setMatrixAt(i, this.matrix);
      this.matrix.setPosition(worldX + 2, 0.05, z + 2);
      this.shadows.setMatrixAt(i, this.matrix);
    }
    this.puffs.count = count;
    this.shadows.count = count;
    this.puffs.instanceMatrix.needsUpdate = true;
    this.shadows.instanceMatrix.needsUpdate = true;
  }

  private writeRain(deltaSeconds: number): void {
    const intensity = Math.max(
      0,
      (this.cloudCover - BALANCE.water.rainCloudThreshold) / (1 - BALANCE.water.rainCloudThreshold),
    );
    const count = this.reducedMotion ? 0 : Math.round(intensity * MAX_RAIN);
    if (count === 0) {
      this.rain.count = 0;
      return;
    }
    const snowing = this.temperature < BALANCE.seasons.snowTemperature;
    this.rainMaterial.color.setHex(snowing ? SNOW_COLOR : RAIN_COLOR);
    this.rainMaterial.opacity = snowing ? 0.8 : 0.28;
    const fallSpeed = snowing ? SNOW_FALL_TILES_PER_S : RAIN_FALL_TILES_PER_S;
    if (!this.reducedMotion) {
      this.rainCycle += (deltaSeconds * fallSpeed) / CLOUD_ALTITUDE;
    }
    for (let i = 0; i < count; i++) {
      const phase = (this.rainPhase[i] + this.rainCycle) % 1;
      const y = CLOUD_ALTITUDE * (1 - phase);
      const baseX = hash01(i, 11) * this.gridSize;
      const z = hash01(i, 12) * this.gridSize;
      // Snow: fat, slow flakes drifting sideways; rain: thin fast streaks.
      const x = snowing
        ? baseX + Math.sin((phase + hash01(i, 13)) * 2 * Math.PI) * SNOW_DRIFT_TILES
        : baseX;
      if (snowing) this.matrix.makeScale(6, 0.12, 6);
      else this.matrix.identity();
      this.matrix.setPosition(x, y, z);
      this.rain.setMatrixAt(i, this.matrix);
    }
    this.rain.count = count;
    this.rain.instanceMatrix.needsUpdate = true;
  }
}
