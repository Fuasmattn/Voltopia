import * as THREE from 'three';
import type { GlobalStats, TileDiff, VehicleState } from '../shared/types.ts';
import { IsoCamera } from './camera.ts';
import { pickTile } from './picking.ts';
import { nightFactor, SUNRISE, SUNSET, sunIntensity } from '../shared/daylight.ts';
import { createScene, PALETTE, type SceneLights } from './scene.ts';
import { createTerrain } from './terrain.ts';
import { RoadsMesh } from './roadsMesh.ts';
import { BuildingsMesh } from './buildingsMesh.ts';
import { PlantsMesh } from './plantsMesh.ts';
import { VehiclesMesh } from './vehiclesMesh.ts';
import { OverlaysMesh } from './overlays.ts';
import type { OverlayMode } from '../shared/types.ts';
import { ZoneTilesMesh } from './zoneTilesMesh.ts';

export interface PickedTile {
  index: number;
  x: number;
  y: number;
}

export interface RendererCallbacks {
  /** Hovered tile changed (null = left the grid). */
  onHover?: (tile: PickedTile | null) => void;
  /** Left button pressed on a tile. */
  onBuildStart?: (tile: PickedTile) => void;
  /** Pointer moved onto another tile while left button held. */
  onBuildDrag?: (tile: PickedTile) => void;
  /** Left button released (tile may be null when released off-grid). */
  onBuildEnd?: (tile: PickedTile | null) => void;
}

/** Stats-derived visual environment shared with render layers. */
export interface RenderEnvironment {
  /** 0 = bright day .. 1 = full night. */
  nightFactor: number;
  /** Sun intensity 0..1. */
  sunFactor: number;
  /** Current wind factor 0..1 (drives rotor speed). */
  windFactor: number;
  /** Battery state of charge 0..1. */
  stateOfCharge: number;
  /** Global zone demand, -1..1 each (drives the demand overlay). */
  demand: { residential: number; commercial: number; retail: number };
}

/** A renderable layer that reacts to sim tile diffs (roads, buildings, ...). */
export interface DiffLayer {
  applyDiffs(diffs: TileDiff[]): void;
  /** Optional per-frame hook for animations. */
  update?(deltaSeconds: number, nowSeconds: number): void;
  /** Optional hook for day/night and weather driven visuals. */
  setEnvironment?(environment: RenderEnvironment): void;
}

const HOVER_COLOR = 0xffffff;
const SKY_DAY_COLOR = new THREE.Color(PALETTE.skyDay);
const SKY_NIGHT_COLOR = new THREE.Color(PALETTE.skyNight);
const SKY_DUSK_COLOR = new THREE.Color(0xf2a05e);
const SUN_DAY_COLOR = new THREE.Color(0xfff2dd);
const SUN_DUSK_COLOR = new THREE.Color(0xff9e5e);
const AMBIENT_DAY_COLOR = new THREE.Color(0xdfeef5);
const AMBIENT_NIGHT_COLOR = new THREE.Color(0x46557a);

/** Warm dusk tint peaks when the sun is low but not gone. */
function duskAmount(sunFactor: number, night: number): number {
  return Math.max(0, Math.min(1, sunFactor * 4)) * Math.min(1, night * 2);
}

export class GameRenderer {
  readonly scene: THREE.Scene;
  readonly lights: SceneLights;
  readonly isoCamera: IsoCamera;
  private readonly webgl: THREE.WebGLRenderer;
  private readonly container: HTMLElement;
  private readonly gridSize: number;
  private readonly callbacks: RendererCallbacks;
  private readonly diffLayers: DiffLayer[] = [];
  private readonly hoverMarker: THREE.Mesh;
  private previewMesh!: THREE.InstancedMesh;
  private radiusRing!: THREE.Mesh;
  private radiusTiles = 0;
  private vehiclesMesh!: VehiclesMesh;
  private overlays!: OverlaysMesh;
  private readonly setGridVisible: (visible: boolean) => void;
  private hoveredIndex: number | null = null;
  private buildPointerActive = false;
  private panPointer: { x: number; y: number } | null = null;
  private animationFrame = 0;
  private lastFrameTime = 0;
  private frameListeners: Array<(deltaSeconds: number, nowSeconds: number) => void> = [];
  private disposed = false;

  constructor(container: HTMLElement, gridSize: number, callbacks: RendererCallbacks = {}) {
    this.container = container;
    this.gridSize = gridSize;
    this.callbacks = callbacks;

    const { scene, lights } = createScene();
    this.scene = scene;
    this.lights = lights;

    const terrain = createTerrain(gridSize);
    this.setGridVisible = terrain.setGridVisible;
    scene.add(terrain.group);

    this.addDiffLayer(new RoadsMesh(scene, gridSize));
    this.addDiffLayer(new ZoneTilesMesh(scene, gridSize));
    this.addDiffLayer(new BuildingsMesh(scene, gridSize));
    this.addDiffLayer(new PlantsMesh(scene, gridSize));
    this.vehiclesMesh = new VehiclesMesh(scene);
    this.overlays = new OverlaysMesh(scene, gridSize);
    this.addDiffLayer(this.overlays);

    const radiusGeometry = new THREE.RingGeometry(0.95, 1, 48).rotateX(-Math.PI / 2);
    this.radiusRing = new THREE.Mesh(
      radiusGeometry,
      new THREE.MeshBasicMaterial({
        color: 0x58b7a4,
        transparent: true,
        opacity: 0.7,
        depthWrite: false,
        side: THREE.DoubleSide,
      }),
    );
    this.radiusRing.visible = false;
    scene.add(this.radiusRing);

    const previewGeometry = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    const previewMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    this.previewMesh = new THREE.InstancedMesh(
      previewGeometry,
      previewMaterial,
      gridSize * gridSize,
    );
    this.previewMesh.count = 0;
    scene.add(this.previewMesh);

    this.isoCamera = new IsoCamera(gridSize);

    this.webgl = new THREE.WebGLRenderer({ antialias: true });
    this.webgl.shadowMap.enabled = true;
    this.webgl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.webgl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.webgl.domElement);

    const hoverGeometry = new THREE.PlaneGeometry(1, 1);
    const hoverMaterial = new THREE.MeshBasicMaterial({
      color: HOVER_COLOR,
      transparent: true,
      opacity: 0.25,
      depthWrite: false,
    });
    this.hoverMarker = new THREE.Mesh(hoverGeometry, hoverMaterial);
    this.hoverMarker.rotation.x = -Math.PI / 2;
    this.hoverMarker.visible = false;
    scene.add(this.hoverMarker);

    this.handleResize();
    this.attachInput();
    window.addEventListener('resize', this.handleResize);
    this.lastFrameTime = performance.now();
    this.renderLoop(this.lastFrameTime);
  }

  addDiffLayer(layer: DiffLayer): void {
    this.diffLayers.push(layer);
  }

  /** Register a per-frame callback (animations, interpolation). */
  onFrame(listener: (deltaSeconds: number, nowSeconds: number) => void): void {
    this.frameListeners.push(listener);
  }

  applyDiffs(diffs: TileDiff[]): void {
    for (const layer of this.diffLayers) layer.applyDiffs(diffs);
  }

  /** Update day/night lighting and layer environments from sim stats. */
  setStats(stats: GlobalStats): void {
    const sunFactor = sunIntensity(stats.timeOfDay);
    const night = nightFactor(stats.timeOfDay);
    const environment: RenderEnvironment = {
      nightFactor: night,
      sunFactor,
      windFactor: Math.min(1, stats.weather.windSpeed),
      stateOfCharge:
        stats.energy.storageCapacity > 0
          ? stats.energy.storedEnergy / stats.energy.storageCapacity
          : 0,
      demand: stats.demand,
    };

    // Sun travels east -> west across the grid during the day.
    const dayPhase = THREE.MathUtils.clamp(
      (stats.timeOfDay - SUNRISE) / (SUNSET - SUNRISE),
      0,
      1,
    );
    const azimuth = Math.PI * (1 - dayPhase);
    const elevation = 0.25 + 0.9 * Math.sin(Math.PI * dayPhase);
    const center = this.gridSize / 2;
    const radius = this.gridSize * 1.2;
    this.lights.sun.position.set(
      center + radius * Math.cos(elevation) * Math.cos(azimuth),
      Math.max(6, radius * Math.sin(elevation) * sunFactor + 6),
      center + radius * Math.cos(elevation) * Math.sin(azimuth) * 0.5,
    );
    this.lights.sun.target.position.set(center, 0, center);
    const cloudDimming = 1 - 0.45 * stats.weather.cloudCover;
    this.lights.sun.intensity = (0.15 + 1.6 * sunFactor) * cloudDimming;
    this.lights.sun.color.copy(SUN_DAY_COLOR).lerp(SUN_DUSK_COLOR, duskAmount(sunFactor, night));
    this.lights.ambient.intensity = 0.35 + 0.65 * sunFactor;
    this.lights.ambient.color.copy(AMBIENT_DAY_COLOR).lerp(AMBIENT_NIGHT_COLOR, night);

    const background = this.scene.background as THREE.Color;
    background
      .copy(SKY_DAY_COLOR)
      .lerp(SKY_NIGHT_COLOR, night)
      .lerp(SKY_DUSK_COLOR, duskAmount(sunFactor, night) * 0.5);

    for (const layer of this.diffLayers) layer.setEnvironment?.(environment);
    this.vehiclesMesh.setEnvironment(environment);
  }

  setVehicles(vehicles: VehicleState[]): void {
    this.vehiclesMesh.setVehicles(vehicles, performance.now() / 1000);
  }

  /** Highlight tiles for a pending drag action (e.g. road preview). */
  setPreviewTiles(indices: number[]): void {
    const matrix = new THREE.Matrix4();
    const count = Math.min(indices.length, this.previewMesh.instanceMatrix.count);
    for (let i = 0; i < count; i++) {
      const index = indices[i];
      matrix.setPosition(
        (index % this.gridSize) + 0.5,
        0.06,
        Math.floor(index / this.gridSize) + 0.5,
      );
      this.previewMesh.setMatrixAt(i, matrix);
    }
    this.previewMesh.count = count;
    this.previewMesh.instanceMatrix.needsUpdate = true;
  }

  setOverlayMode(mode: OverlayMode): void {
    this.overlays.setMode(mode);
  }

  /**
   * Show a supply-radius ring following the hovered tile (0 disables).
   * The ring approximates the Chebyshev radius as a circle.
   */
  setHoverRadius(tiles: number): void {
    this.radiusTiles = tiles;
    if (tiles <= 0) this.radiusRing.visible = false;
  }

  showBuildGrid(visible: boolean): void {
    this.setGridVisible(visible);
  }

  setHoverVisible(visible: boolean): void {
    if (!visible) this.hoverMarker.visible = false;
  }

  private attachInput(): void {
    const el = this.webgl.domElement;
    el.style.touchAction = 'none';
    el.addEventListener('contextmenu', (e) => e.preventDefault());

    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      if (e.button === 0) {
        const tile = this.pick(e);
        if (tile) {
          this.buildPointerActive = true;
          this.callbacks.onBuildStart?.(tile);
        }
      } else {
        this.panPointer = { x: e.clientX, y: e.clientY };
      }
    });

    el.addEventListener('pointermove', (e) => {
      if (this.panPointer) {
        this.isoCamera.pan(
          e.clientX - this.panPointer.x,
          e.clientY - this.panPointer.y,
          el.clientHeight,
        );
        this.panPointer = { x: e.clientX, y: e.clientY };
        return;
      }
      const tile = this.pick(e);
      const index = tile?.index ?? null;
      if (index !== this.hoveredIndex) {
        this.hoveredIndex = index;
        this.updateHoverMarker(tile);
        this.callbacks.onHover?.(tile);
        if (tile && this.buildPointerActive) this.callbacks.onBuildDrag?.(tile);
      }
    });

    const endPointer = (e: PointerEvent): void => {
      if (this.panPointer && e.button !== 0) {
        this.panPointer = null;
        return;
      }
      if (e.button === 0 && this.buildPointerActive) {
        this.buildPointerActive = false;
        this.callbacks.onBuildEnd?.(this.pick(e));
      }
    };
    el.addEventListener('pointerup', endPointer);
    el.addEventListener('pointercancel', () => {
      this.panPointer = null;
      this.buildPointerActive = false;
    });

    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.isoCamera.zoomBy(e.deltaY);
      },
      { passive: false },
    );

    window.addEventListener('keydown', this.handleKeyDown);
  }

  private handleKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'q' || e.key === 'Q') this.isoCamera.rotate(1);
    if (e.key === 'e' || e.key === 'E') this.isoCamera.rotate(-1);
  };

  private pick(e: PointerEvent): PickedTile | null {
    return pickTile(
      e.clientX,
      e.clientY,
      this.webgl.domElement,
      this.isoCamera.camera,
      this.gridSize,
    );
  }

  private updateHoverMarker(tile: PickedTile | null): void {
    if (!tile) {
      this.hoverMarker.visible = false;
      this.radiusRing.visible = false;
      return;
    }
    this.hoverMarker.visible = true;
    this.hoverMarker.position.set(tile.x + 0.5, 0.03, tile.y + 0.5);
    if (this.radiusTiles > 0) {
      this.radiusRing.visible = true;
      this.radiusRing.position.set(tile.x + 0.5, 0.05, tile.y + 0.5);
      this.radiusRing.scale.setScalar(this.radiusTiles);
    }
  }

  private handleResize = (): void => {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.webgl.setSize(width, height);
    this.isoCamera.setViewport(width, height);
  };

  private renderLoop = (now: number): void => {
    if (this.disposed) return;
    const deltaSeconds = Math.min((now - this.lastFrameTime) / 1000, 0.1);
    this.lastFrameTime = now;
    this.isoCamera.update(deltaSeconds);
    for (const layer of this.diffLayers) layer.update?.(deltaSeconds, now / 1000);
    this.vehiclesMesh.update(now / 1000);
    for (const listener of this.frameListeners) listener(deltaSeconds, now / 1000);
    this.webgl.render(this.scene, this.isoCamera.camera);
    this.animationFrame = requestAnimationFrame(this.renderLoop);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.animationFrame);
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeyDown);
    this.webgl.dispose();
    this.webgl.domElement.remove();
  }
}
