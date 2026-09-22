import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { TileDiff } from '../shared/types.ts';
import { PlantType, Terrain, TileType } from '../shared/types.ts';
import type { DiffLayer, RenderEnvironment } from './renderer.ts';

const MAX_BOX_PARTS_PER_PLANT = 8;
const ROTOR_MAX_SPEED_RAD_PER_S = 6;
const HUB_HEIGHT = 0.85;

interface BoxPart {
  sx: number;
  sy: number;
  sz: number;
  ox: number;
  oy: number;
  oz: number;
  color: number;
  /** Rotation around the x axis (e.g. tilted solar panels). */
  rotX?: number;
}

const COLORS = {
  pedestal: 0x8a9099,
  panel: 0x2b3d66,
  pole: 0xe8eaec,
  nacelle: 0xd5d8db,
  batteryCabinet: 0x4d6b57,
  batteryFrame: 0x3a4048,
  biogasTank: 0x6c7f5a,
  biogasDome: 0x93ab6d,
  hubCanopy: 0x58b7a4,
  hubPillar: 0x3a4048,
  parkGrass: 0x7cb35e,
  treeTrunk: 0x6e4f36,
  treeFoliage: 0x3f7d46,
  treeFoliageLight: 0x549a54,
  weir: 0x9aa3ad,
  powerhouse: 0x5d6b7a,
  penstock: 0x7a8593,
  waterLight: 0x7fb6dd,
} as const;

/** Where a plant stands: which neighbours are water (for hydro shapes). */
interface PlantSite {
  /** River continues north/south of the tile (else east/west). */
  riverAlongZ: boolean;
  /** Direction to the nearest lake neighbour (0,0 when none). */
  lakeDx: number;
  lakeDz: number;
}

/** Static box parts per plant type (rotors/domes/fills are separate). */
function plantBoxParts(plant: PlantType, site: PlantSite): BoxPart[] {
  switch (plant) {
    case PlantType.SolarFarm: {
      const rows: BoxPart[] = [];
      for (let i = 0; i < 3; i++) {
        rows.push({
          sx: 0.8,
          sy: 0.02,
          sz: 0.24,
          ox: 0,
          oy: 0.14,
          oz: -0.3 + i * 0.3,
          color: COLORS.panel,
          rotX: -0.5,
        });
        rows.push({
          sx: 0.8,
          sy: 0.1,
          sz: 0.04,
          ox: 0,
          oy: 0,
          oz: -0.3 + i * 0.3,
          color: COLORS.pedestal,
        });
      }
      return rows;
    }
    case PlantType.WindTurbine:
      return [
        { sx: 0.07, sy: HUB_HEIGHT, sz: 0.07, ox: 0, oy: 0, oz: 0, color: COLORS.pole },
        {
          sx: 0.1,
          sy: 0.09,
          sz: 0.2,
          ox: 0,
          oy: HUB_HEIGHT,
          oz: 0.03,
          color: COLORS.nacelle,
        },
      ];
    case PlantType.Battery:
      return [
        { sx: 0.55, sy: 0.5, sz: 0.4, ox: 0, oy: 0, oz: 0, color: COLORS.batteryCabinet },
        { sx: 0.62, sy: 0.06, sz: 0.46, ox: 0, oy: 0.5, oz: 0, color: COLORS.batteryFrame },
      ];
    case PlantType.BiogasPlant:
      return [{ sx: 0.34, sy: 0.34, sz: 0.34, ox: 0.22, oy: 0, oz: 0.2, color: COLORS.biogasTank }];
    case PlantType.ChargingHub:
      return [
        { sx: 0.08, sy: 0.45, sz: 0.08, ox: -0.3, oy: 0, oz: -0.3, color: COLORS.hubPillar },
        { sx: 0.08, sy: 0.45, sz: 0.08, ox: 0.3, oy: 0, oz: -0.3, color: COLORS.hubPillar },
        { sx: 0.9, sy: 0.05, sz: 0.9, ox: 0, oy: 0.45, oz: 0, color: COLORS.hubCanopy },
        { sx: 0.2, sy: 0.35, sz: 0.12, ox: 0, oy: 0, oz: 0.32, color: COLORS.batteryFrame },
      ];
    case PlantType.Park:
      return [
        { sx: 0.94, sy: 0.03, sz: 0.94, ox: 0, oy: 0, oz: 0, color: COLORS.parkGrass },
        // three low-poly trees: trunk + foliage cube each
        { sx: 0.05, sy: 0.16, sz: 0.05, ox: -0.24, oy: 0.03, oz: -0.2, color: COLORS.treeTrunk },
        { sx: 0.22, sy: 0.26, sz: 0.22, ox: -0.24, oy: 0.17, oz: -0.2, color: COLORS.treeFoliage },
        { sx: 0.05, sy: 0.2, sz: 0.05, ox: 0.22, oy: 0.03, oz: -0.05, color: COLORS.treeTrunk },
        {
          sx: 0.26,
          sy: 0.32,
          sz: 0.26,
          ox: 0.22,
          oy: 0.2,
          oz: -0.05,
          color: COLORS.treeFoliageLight,
        },
        { sx: 0.05, sy: 0.13, sz: 0.05, ox: -0.05, oy: 0.03, oz: 0.28, color: COLORS.treeTrunk },
        { sx: 0.18, sy: 0.2, sz: 0.18, ox: -0.05, oy: 0.14, oz: 0.28, color: COLORS.treeFoliage },
      ];
    case PlantType.RunOfRiver: {
      // A weir across the river with a small powerhouse at one bank.
      const across = site.riverAlongZ;
      return [
        {
          sx: across ? 0.96 : 0.3,
          sy: 0.2,
          sz: across ? 0.3 : 0.96,
          ox: 0,
          oy: 0,
          oz: 0,
          color: COLORS.weir,
        },
        {
          sx: across ? 0.9 : 0.08,
          sy: 0.26,
          sz: across ? 0.08 : 0.9,
          ox: 0,
          oy: 0,
          oz: 0,
          color: COLORS.waterLight,
        },
        {
          sx: 0.3,
          sy: 0.34,
          sz: 0.3,
          ox: across ? 0.3 : 0,
          oy: 0,
          oz: across ? 0 : 0.3,
          color: COLORS.powerhouse,
        },
      ];
    }
    case PlantType.PumpedStorage: {
      // Powerhouse with a penstock pipe running toward the lake.
      const alongX = site.lakeDx !== 0;
      return [
        { sx: 0.6, sy: 0.45, sz: 0.5, ox: 0, oy: 0, oz: 0, color: COLORS.powerhouse },
        { sx: 0.66, sy: 0.05, sz: 0.56, ox: 0, oy: 0.45, oz: 0, color: COLORS.batteryFrame },
        {
          sx: alongX ? 0.5 : 0.12,
          sy: 0.1,
          sz: alongX ? 0.12 : 0.5,
          ox: site.lakeDx * 0.3,
          oy: 0.3,
          oz: site.lakeDz * 0.3,
          color: COLORS.penstock,
        },
        {
          sx: alongX ? 0.5 : 0.12,
          sy: 0.1,
          sz: alongX ? 0.12 : 0.5,
          ox: site.lakeDx * 0.3,
          oy: 0.16,
          oz: site.lakeDz * 0.3,
          color: COLORS.penstock,
        },
      ];
    }
    default:
      return [];
  }
}

/** Three thin blades merged into one rotor geometry, hub at the origin. */
function createRotorGeometry(): THREE.BufferGeometry {
  const blades: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const blade = new THREE.BoxGeometry(0.015, 0.42, 0.05);
    blade.translate(0, 0.21, 0);
    blade.rotateX((i * 2 * Math.PI) / 3);
    blades.push(blade);
  }
  const merged = mergeGeometries(blades);
  // Blades live in the yz-plane and spin around the x axis.
  merged.rotateY(Math.PI / 2);
  return merged;
}

/**
 * All energy plants: instanced static parts, spinning turbine rotors
 * (speed proportional to wind output), biogas domes, and battery
 * state-of-charge fill bars.
 */
export class PlantsMesh implements DiffLayer {
  private readonly boxMesh: THREE.InstancedMesh;
  private readonly rotorMesh: THREE.InstancedMesh;
  private readonly domeMesh: THREE.InstancedMesh;
  private readonly socFillMesh: THREE.InstancedMesh;
  private readonly gridSize: number;
  private readonly plants = new Map<number, PlantType>();
  private readonly terrain: Uint8Array;
  private readonly rotorPositions: THREE.Vector3[] = [];
  private rotorAngle = 0;
  private rotorSpeedFactor = 0;
  private stateOfCharge = 0;
  private readonly batteryPositions: THREE.Vector3[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();
  private readonly position = new THREE.Vector3();

  constructor(scene: THREE.Scene, gridSize: number) {
    this.gridSize = gridSize;
    const capacity = gridSize * gridSize;
    this.terrain = new Uint8Array(capacity);

    const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
    boxGeometry.translate(0, 0.5, 0);
    this.boxMesh = new THREE.InstancedMesh(
      boxGeometry,
      new THREE.MeshLambertMaterial(),
      capacity * MAX_BOX_PARTS_PER_PLANT,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.boxMesh.frustumCulled = false;
    this.boxMesh.castShadow = true;
    this.boxMesh.count = 0;
    scene.add(this.boxMesh);

    this.rotorMesh = new THREE.InstancedMesh(
      createRotorGeometry(),
      new THREE.MeshLambertMaterial({ color: COLORS.pole }),
      capacity,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.rotorMesh.frustumCulled = false;
    this.rotorMesh.count = 0;
    scene.add(this.rotorMesh);

    const domeGeometry = new THREE.SphereGeometry(0.3, 10, 6);
    this.domeMesh = new THREE.InstancedMesh(
      domeGeometry,
      new THREE.MeshLambertMaterial({ color: COLORS.biogasDome }),
      capacity,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.domeMesh.frustumCulled = false;
    this.domeMesh.castShadow = true;
    this.domeMesh.count = 0;
    scene.add(this.domeMesh);

    const fillGeometry = new THREE.BoxGeometry(1, 1, 1);
    fillGeometry.translate(0, 0.5, 0);
    this.socFillMesh = new THREE.InstancedMesh(
      fillGeometry,
      new THREE.MeshBasicMaterial({ color: 0x7be07f }),
      capacity,
    );
    // Instance transforms live across the whole grid; the base geometry's
    // bounds would wrongly cull the mesh, so culling is disabled.
    this.socFillMesh.frustumCulled = false;
    this.socFillMesh.count = 0;
    scene.add(this.socFillMesh);
  }

  applyDiffs(diffs: TileDiff[]): void {
    let changed = false;
    for (const diff of diffs) {
      if (this.terrain[diff.index] !== diff.terrain) {
        this.terrain[diff.index] = diff.terrain;
        changed = true;
      }
      const plant = diff.tileType === TileType.Plant ? diff.plantType : PlantType.None;
      const existing = this.plants.get(diff.index) ?? PlantType.None;
      if (plant !== existing) {
        if (plant === PlantType.None) this.plants.delete(diff.index);
        else this.plants.set(diff.index, plant);
        changed = true;
      }
    }
    if (changed) this.rebuild();
  }

  setEnvironment(environment: RenderEnvironment): void {
    this.rotorSpeedFactor = environment.windFactor;
    if (Math.abs(environment.stateOfCharge - this.stateOfCharge) > 0.002) {
      this.stateOfCharge = environment.stateOfCharge;
      this.writeSocFills();
    }
  }

  update(deltaSeconds: number): void {
    if (this.rotorPositions.length === 0) return;
    // Rotor speed is proportional to wind output (cut-in below ~10%).
    const speed =
      this.rotorSpeedFactor > 0.05 ? ROTOR_MAX_SPEED_RAD_PER_S * this.rotorSpeedFactor : 0;
    if (speed === 0) return;
    this.rotorAngle = (this.rotorAngle + speed * deltaSeconds) % (2 * Math.PI);
    this.writeRotors();
  }

  private rebuild(): void {
    let boxSlot = 0;
    let domeSlot = 0;
    this.rotorPositions.length = 0;
    this.batteryPositions.length = 0;
    const color = new THREE.Color();

    for (const [index, plant] of this.plants) {
      const cx = (index % this.gridSize) + 0.5;
      const cz = Math.floor(index / this.gridSize) + 0.5;
      const site = this.siteOf(index);
      for (const part of plantBoxParts(plant, site)) {
        this.position.set(cx + part.ox, part.oy, cz + part.oz);
        this.quaternion.setFromEuler(new THREE.Euler(part.rotX ?? 0, 0, 0));
        this.scale.set(part.sx, part.sy, part.sz);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.boxMesh.setMatrixAt(boxSlot, this.matrix);
        this.boxMesh.setColorAt(boxSlot, color.setHex(part.color));
        boxSlot++;
      }
      if (plant === PlantType.WindTurbine) {
        this.rotorPositions.push(new THREE.Vector3(cx, HUB_HEIGHT, cz + 0.09));
      } else if (plant === PlantType.BiogasPlant) {
        this.matrix.makeScale(1, 0.75, 1);
        this.matrix.setPosition(cx - 0.12, 0.12, cz - 0.05);
        this.domeMesh.setMatrixAt(domeSlot++, this.matrix);
      } else if (plant === PlantType.Battery) {
        this.batteryPositions.push(new THREE.Vector3(cx, 0, cz));
      }
    }

    this.boxMesh.count = boxSlot;
    this.boxMesh.instanceMatrix.needsUpdate = true;
    if (this.boxMesh.instanceColor) this.boxMesh.instanceColor.needsUpdate = true;
    this.domeMesh.count = domeSlot;
    this.domeMesh.instanceMatrix.needsUpdate = true;
    this.writeRotors();
    this.writeSocFills();
  }

  private siteOf(index: number): PlantSite {
    const size = this.gridSize;
    const x = index % size;
    const y = Math.floor(index / size);
    const terrainAt = (tx: number, ty: number): number =>
      tx < 0 || ty < 0 || tx >= size || ty >= size ? Terrain.Land : this.terrain[ty * size + tx];
    const riverAlongZ =
      terrainAt(x, y - 1) === Terrain.River || terrainAt(x, y + 1) === Terrain.River;
    let lakeDx = 0;
    let lakeDz = 0;
    for (const [dx, dz] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      if (terrainAt(x + dx, y + dz) === Terrain.Lake) {
        lakeDx = dx;
        lakeDz = dz;
        break;
      }
    }
    return { riverAlongZ, lakeDx, lakeDz };
  }

  private writeRotors(): void {
    for (let i = 0; i < this.rotorPositions.length; i++) {
      const hub = this.rotorPositions[i];
      this.matrix.makeRotationZ(this.rotorAngle + i * 0.7);
      this.matrix.setPosition(hub.x, hub.y, hub.z);
      this.rotorMesh.setMatrixAt(i, this.matrix);
    }
    this.rotorMesh.count = this.rotorPositions.length;
    this.rotorMesh.instanceMatrix.needsUpdate = true;
  }

  /** Front bar on each battery cabinet showing the state of charge. */
  private writeSocFills(): void {
    const height = 0.04 + 0.42 * this.stateOfCharge;
    for (let i = 0; i < this.batteryPositions.length; i++) {
      const p = this.batteryPositions[i];
      this.matrix.makeScale(0.1, height, 0.03);
      this.matrix.setPosition(p.x + 0.18, 0.03, p.z + 0.2);
      this.socFillMesh.setMatrixAt(i, this.matrix);
    }
    this.socFillMesh.count = this.batteryPositions.length;
    this.socFillMesh.instanceMatrix.needsUpdate = true;
  }
}
