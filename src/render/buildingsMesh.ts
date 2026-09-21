import * as THREE from 'three';
import type { TileDiff } from '../shared/types.ts';
import { SupplyStatus, TileType, Zone } from '../shared/types.ts';
import type { DiffLayer, RenderEnvironment } from './renderer.ts';

/** Max boxes composing one building. */
const PARTS_PER_TILE = 3;
const GROW_ANIMATION_SECONDS = 0.45;
/** Max lit window quads per building (two faces). */
const WINDOWS_PER_TILE = 16;
const WINDOW_COLOR = 0xffc978;

interface BuildingPart {
  /** Footprint size (tile fractions) and height. */
  sx: number;
  sy: number;
  sz: number;
  /** Offset from tile center (tile fractions) and base height. */
  ox: number;
  oy: number;
  oz: number;
  color: THREE.Color;
}

interface TileBuilding {
  zone: Zone;
  density: number;
  variant: number;
  supplied: SupplyStatus;
}

const ZONE_BASE_COLORS: Record<number, THREE.Color> = {
  [Zone.Residential]: new THREE.Color(0xe7d7b8),
  [Zone.Commercial]: new THREE.Color(0x9db4c8),
  [Zone.Retail]: new THREE.Color(0xd8a09a),
};

const ROOF_COLORS: Record<number, THREE.Color> = {
  [Zone.Residential]: new THREE.Color(0xc06a4f),
  [Zone.Commercial]: new THREE.Color(0x6f8aa0),
  [Zone.Retail]: new THREE.Color(0xb85f66),
};

const ROOFTOP_PV_COLOR = new THREE.Color(0x2b3d66);

/**
 * Rooftop PV panel on top of the finished part stack — buildings grow
 * panels automatically from density 2 (mirrors the sim's rooftop
 * feed-in).
 */
function withRooftopPanel(parts: BuildingPart[], density: number): BuildingPart[] {
  if (density < 2 || parts.length === 0) return parts;
  let top = 0;
  let topPart = parts[0];
  for (const p of parts) {
    if (p.oy + p.sy > top) {
      top = p.oy + p.sy;
      topPart = p;
    }
  }
  parts.push(
    part(
      topPart.sx * 0.7,
      0.03,
      topPart.sz * 0.55,
      topPart.ox,
      top,
      topPart.oz,
      ROOFTOP_PV_COLOR,
    ),
  );
  return parts;
}

/**
 * Procedural low-poly building parts for a zone/density/variant triple.
 * Deterministic in its inputs so every client renders the same city.
 */
export function buildingParts(
  zone: Zone,
  density: number,
  variant: number,
): BuildingPart[] {
  const base = ZONE_BASE_COLORS[zone] ?? new THREE.Color(0xffffff);
  const roof = ROOF_COLORS[zone] ?? new THREE.Color(0xcccccc);
  // Small deterministic variation derived from the variant id.
  const jitter = (variant % 4) * 0.04;
  const wallColor = base.clone().offsetHSL(0, 0, (variant % 3) * 0.03 - 0.03);
  const parts: BuildingPart[] = [];

  if (zone === Zone.Residential) {
    if (density === 1) {
      const h = 0.32 + jitter;
      parts.push(part(0.5, h, 0.55, 0, 0, 0, wallColor));
      parts.push(part(0.56, 0.12, 0.61, 0, h, 0, roof));
    } else if (density === 2) {
      const h = 0.55 + jitter;
      parts.push(part(0.62, h, 0.62, 0, 0, 0, wallColor));
      parts.push(part(0.68, 0.12, 0.68, 0, h, 0, roof));
    } else {
      const h = 1.05 + jitter;
      parts.push(part(0.72, h, 0.72, 0, 0, 0, wallColor));
      parts.push(part(0.5, 0.22, 0.5, 0, h, 0, wallColor));
    }
  } else if (zone === Zone.Commercial) {
    if (density === 1) {
      parts.push(part(0.62, 0.4 + jitter, 0.62, 0, 0, 0, wallColor));
    } else if (density === 2) {
      parts.push(part(0.62, 1.0 + jitter, 0.62, 0, 0, 0, wallColor));
      parts.push(part(0.66, 0.06, 0.66, 0, 1.0 + jitter, 0, roof));
    } else {
      const h = 1.7 + jitter * 2;
      parts.push(part(0.66, h, 0.66, 0, 0, 0, wallColor));
      parts.push(part(0.46, 0.45, 0.46, 0, h, 0, wallColor));
    }
  } else if (zone === Zone.Retail) {
    if (density === 1) {
      parts.push(part(0.72, 0.3 + jitter, 0.6, 0, 0, 0, wallColor));
      parts.push(part(0.76, 0.08, 0.2, 0, 0.3 + jitter, 0.24, roof));
    } else if (density === 2) {
      parts.push(part(0.78, 0.45 + jitter, 0.7, 0, 0, 0, wallColor));
      parts.push(part(0.82, 0.08, 0.2, 0, 0.45 + jitter, 0.28, roof));
    } else {
      const h = 0.8 + jitter;
      parts.push(part(0.8, h, 0.78, 0, 0, 0, wallColor));
      parts.push(part(0.84, 0.1, 0.84, 0, h, 0, roof));
    }
  }
  return withRooftopPanel(parts, density);
}

function part(
  sx: number,
  sy: number,
  sz: number,
  ox: number,
  oy: number,
  oz: number,
  color: THREE.Color,
): BuildingPart {
  return { sx, sy, sz, ox, oy, oz, color };
}

/**
 * All zone buildings as one InstancedMesh with per-instance colors.
 * New/densified buildings scale in with a short animation.
 */
export class BuildingsMesh implements DiffLayer {
  readonly mesh: THREE.InstancedMesh;
  private readonly windowsMesh: THREE.InstancedMesh;
  private readonly windowsMaterial: THREE.MeshBasicMaterial;
  private readonly gridSize: number;
  private readonly buildings = new Map<number, TileBuilding>();
  private readonly animations = new Map<number, number>(); // tile -> elapsed
  private tileSlots = new Map<number, { start: number; count: number }>();
  private windowsDirty = false;
  private readonly matrix = new THREE.Matrix4();

  constructor(scene: THREE.Scene, gridSize: number) {
    this.gridSize = gridSize;
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    geometry.translate(0, 0.5, 0); // origin at the base for easy scaling
    const material = new THREE.MeshLambertMaterial();
    this.mesh = new THREE.InstancedMesh(
      geometry,
      material,
      gridSize * gridSize * PARTS_PER_TILE,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    scene.add(this.mesh);

    const windowGeometry = new THREE.PlaneGeometry(0.09, 0.11);
    this.windowsMaterial = new THREE.MeshBasicMaterial({
      color: WINDOW_COLOR,
      transparent: true,
      opacity: 0,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    this.windowsMesh = new THREE.InstancedMesh(
      windowGeometry,
      this.windowsMaterial,
      gridSize * gridSize * WINDOWS_PER_TILE,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.windowsMesh.frustumCulled = false;
    this.windowsMesh.count = 0;
    this.windowsMesh.visible = false;
    scene.add(this.windowsMesh);
  }

  /** Warm window lights fade in with the night. */
  setEnvironment(environment: RenderEnvironment): void {
    const opacity = Math.max(0, environment.nightFactor - 0.25) / 0.75;
    this.windowsMaterial.opacity = opacity * 0.95;
    this.windowsMesh.visible = opacity > 0.02;
  }

  applyDiffs(diffs: TileDiff[]): void {
    let changed = false;
    for (const diff of diffs) {
      const hasBuilding = diff.tileType === TileType.Empty && diff.density > 0;
      const existing = this.buildings.get(diff.index);
      if (hasBuilding) {
        if (
          !existing ||
          existing.density !== diff.density ||
          existing.zone !== diff.zone ||
          existing.variant !== diff.variant
        ) {
          this.buildings.set(diff.index, {
            zone: diff.zone,
            density: diff.density,
            variant: diff.variant,
            supplied: diff.supplied,
          });
          this.animations.set(diff.index, 0);
          changed = true;
        } else if (existing.supplied !== diff.supplied) {
          // Supply flips only affect the lit windows (flicker/dark), so a
          // window rebuild is enough — no grow animation.
          existing.supplied = diff.supplied;
          this.windowsDirty = true;
        }
      } else if (existing) {
        this.buildings.delete(diff.index);
        this.animations.delete(diff.index);
        changed = true;
      }
    }
    if (changed) this.rebuild();
    else if (this.windowsDirty) {
      this.windowsDirty = false;
      this.rebuildWindows();
    }
  }

  update(deltaSeconds: number): void {
    if (this.animations.size === 0) return;
    for (const [index, elapsed] of this.animations) {
      const next = elapsed + deltaSeconds;
      if (next >= GROW_ANIMATION_SECONDS) {
        this.animations.delete(index);
        this.writeTileMatrices(index, 1);
      } else {
        this.animations.set(index, next);
        // Ease-out cubic for a satisfying pop-in.
        const t = next / GROW_ANIMATION_SECONDS;
        this.writeTileMatrices(index, 1 - Math.pow(1 - t, 3));
      }
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  private rebuild(): void {
    this.tileSlots = new Map();
    let slot = 0;
    const color = new THREE.Color();
    for (const [index, building] of this.buildings) {
      const parts = buildingParts(building.zone, building.density, building.variant);
      this.tileSlots.set(index, { start: slot, count: parts.length });
      for (const p of parts) {
        color.copy(p.color);
        this.mesh.setColorAt(slot, color);
        slot++;
      }
      const scale = this.animations.has(index)
        ? Math.max(0.01, this.animations.get(index)! / GROW_ANIMATION_SECONDS)
        : 1;
      this.writeTileMatrices(index, scale);
    }
    this.mesh.count = slot;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.rebuildWindows();
  }

  /**
   * Lit window quads on the ±z faces of each building's main box. A
   * deterministic pattern keeps some windows dark for variety.
   */
  private rebuildWindows(): void {
    const matrix = new THREE.Matrix4();
    const rotationBack = new THREE.Matrix4().makeRotationY(Math.PI);
    let slot = 0;
    for (const [index, building] of this.buildings) {
      // Buildings without (enough) power stay dark — undersupply flips
      // tick to tick, which reads as flickering at night.
      if (building.supplied !== SupplyStatus.Supplied) continue;
      const main = buildingParts(building.zone, building.density, building.variant)[0];
      if (!main) continue;
      const cx = (index % this.gridSize) + 0.5 + main.ox;
      const cz = Math.floor(index / this.gridSize) + 0.5 + main.oz;
      const cols = Math.min(3, Math.max(1, Math.round(main.sx / 0.24)));
      const rows = Math.min(4, Math.max(1, Math.round(main.sy / 0.28)));
      let windowId = 0;
      for (const face of [1, -1]) {
        for (let col = 0; col < cols; col++) {
          for (let row = 0; row < rows; row++) {
            windowId++;
            // Deterministically leave ~1/3 of windows dark.
            if ((index * 7 + windowId * 13 + building.variant) % 3 === 0) continue;
            if (slot >= this.windowsMesh.instanceMatrix.count) break;
            const x = cx + ((col + 0.5) / cols - 0.5) * main.sx * 0.8;
            const y = main.oy + ((row + 0.55) / rows) * main.sy * 0.82;
            const z = cz + face * (main.sz / 2 + 0.012);
            if (face === 1) matrix.identity();
            else matrix.copy(rotationBack);
            matrix.setPosition(x, y, z);
            this.windowsMesh.setMatrixAt(slot++, matrix);
          }
        }
      }
    }
    this.windowsMesh.count = slot;
    this.windowsMesh.instanceMatrix.needsUpdate = true;
  }

  private writeTileMatrices(index: number, scale: number): void {
    const slots = this.tileSlots.get(index);
    const building = this.buildings.get(index);
    if (!slots || !building) return;
    const parts = buildingParts(building.zone, building.density, building.variant);
    const cx = (index % this.gridSize) + 0.5;
    const cz = Math.floor(index / this.gridSize) + 0.5;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      this.matrix.makeScale(p.sx * scale, p.sy * scale, p.sz * scale);
      this.matrix.setPosition(cx + p.ox * scale, p.oy * scale, cz + p.oz * scale);
      this.mesh.setMatrixAt(slots.start + i, this.matrix);
    }
  }
}
