import * as THREE from 'three';
import type { GlobalStats, TileDiff, VehicleState } from '../shared/types.ts';
import { IsoCamera } from './camera.ts';
import { pickTile } from './picking.ts';
import { createScene, type SceneLights } from './scene.ts';
import { createTerrain } from './terrain.ts';

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

/** A renderable layer that reacts to sim tile diffs (roads, buildings, ...). */
export interface DiffLayer {
  applyDiffs(diffs: TileDiff[]): void;
}

const HOVER_COLOR = 0xffffff;

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

  /** Hook for stats-driven visuals (day/night lighting from M4 on). */
  setStats(_stats: GlobalStats): void {
    // extended in later milestones
  }

  setVehicles(_vehicles: VehicleState[]): void {
    // extended in M6
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
      return;
    }
    this.hoverMarker.visible = true;
    this.hoverMarker.position.set(tile.x + 0.5, 0.03, tile.y + 0.5);
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
