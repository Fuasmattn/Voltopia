import * as THREE from 'three';
import type { TileDiff } from '../shared/types.ts';
import { OverlayMode, SupplyStatus, TileType, Zone } from '../shared/types.ts';
import type { DiffLayer, RenderEnvironment } from './renderer.ts';

const SUPPLY_COLORS: Record<number, number> = {
  [SupplyStatus.Supplied]: 0x4cd964,
  [SupplyStatus.Undersupplied]: 0xffb347,
  [SupplyStatus.NotConnected]: 0xe05263,
};

const SERVICE_FIRE = 1;
const SERVICE_POLICE = 2;
const SERVICE_COLORS = {
  both: 0x4cd964,
  fireOnly: 0xffb347,
  policeOnly: 0x5b9bd5,
  none: 0xe05263,
};

interface OverlayTile {
  zone: Zone;
  density: number;
  supplied: SupplyStatus;
  tileType: TileType;
  services: number;
}

/**
 * Toggleable color maps over the city: supply status of every building,
 * growth demand tinting all zoned tiles, or fire/police service coverage
 * of every building.
 */
export class OverlaysMesh implements DiffLayer {
  private readonly mesh: THREE.InstancedMesh;
  private readonly gridSize: number;
  private readonly tiles = new Map<number, OverlayTile>();
  private mode: OverlayMode = OverlayMode.None;
  private demand = { residential: 0, commercial: 0, retail: 0 };
  private readonly matrix = new THREE.Matrix4();
  private readonly color = new THREE.Color();

  constructor(scene: THREE.Scene, gridSize: number) {
    this.gridSize = gridSize;
    const geometry = new THREE.PlaneGeometry(0.96, 0.96).rotateX(-Math.PI / 2);
    const material = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geometry, material, gridSize * gridSize);
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }

  setMode(mode: OverlayMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.rebuild();
  }

  setEnvironment(environment: RenderEnvironment): void {
    this.demand = environment.demand;
    if (this.mode === OverlayMode.Demand) this.rebuild();
  }

  applyDiffs(diffs: TileDiff[]): void {
    for (const diff of diffs) {
      if (diff.zone !== Zone.None || diff.density > 0) {
        this.tiles.set(diff.index, {
          zone: diff.zone,
          density: diff.density,
          supplied: diff.supplied,
          tileType: diff.tileType,
          services: diff.services,
        });
      } else {
        this.tiles.delete(diff.index);
      }
    }
    if (this.mode !== OverlayMode.None) this.rebuild();
  }

  private demandFor(zone: Zone): number {
    switch (zone) {
      case Zone.Residential:
        return this.demand.residential;
      case Zone.Commercial:
        return this.demand.commercial;
      case Zone.Retail:
        return this.demand.retail;
      default:
        return 0;
    }
  }

  private rebuild(): void {
    let slot = 0;
    if (this.mode !== OverlayMode.None) {
      for (const [index, tile] of this.tiles) {
        let colorHex: number | null = null;
        if (this.mode === OverlayMode.Supply) {
          if (tile.tileType === TileType.Empty && tile.density > 0) {
            colorHex = SUPPLY_COLORS[tile.supplied] ?? null;
          }
        } else if (this.mode === OverlayMode.Demand) {
          if (tile.tileType === TileType.Empty && tile.zone !== Zone.None) {
            const demand = this.demandFor(tile.zone);
            // Hue from red (negative demand) over yellow to green (high).
            this.color.setHSL(THREE.MathUtils.clamp((0.33 * (demand + 1)) / 2, 0, 0.33), 0.85, 0.5);
            colorHex = this.color.getHex();
          }
        } else if (this.mode === OverlayMode.Services) {
          if (tile.tileType === TileType.Empty && tile.density > 0) {
            const fire = (tile.services & SERVICE_FIRE) !== 0;
            const police = (tile.services & SERVICE_POLICE) !== 0;
            colorHex =
              fire && police
                ? SERVICE_COLORS.both
                : fire
                  ? SERVICE_COLORS.fireOnly
                  : police
                    ? SERVICE_COLORS.policeOnly
                    : SERVICE_COLORS.none;
          }
        }
        if (colorHex === null) continue;
        this.matrix.setPosition(
          (index % this.gridSize) + 0.5,
          0.07,
          Math.floor(index / this.gridSize) + 0.5,
        );
        this.mesh.setMatrixAt(slot, this.matrix);
        this.mesh.setColorAt(slot, this.color.setHex(colorHex));
        slot++;
      }
    }
    this.mesh.count = slot;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
