import { BALANCE, ENERGY_HISTORY_SAMPLES, SAVE_VERSION } from '../shared/constants.ts';
import { neighbors4 } from '../shared/grid.ts';
import { Rng } from '../shared/rng.ts';
import type {
  DemandStats,
  LifetimeSample,
  EnergyHistoryPoint,
  SaveGame,
  Speed,
  TileDiff,
  Weather,
} from '../shared/types.ts';
import { PlantType, SupplyStatus, Terrain, TileType, Zone } from '../shared/types.ts';

/** Commute phases of a vehicle. */
export const VehiclePhase = {
  ParkedHome: 0,
  ToWork: 1,
  ParkedWork: 2,
  ToHome: 3,
} as const;
export type VehiclePhase = (typeof VehiclePhase)[keyof typeof VehiclePhase];

/** One simulated vehicle. Continuous position in tile space. */
export interface Vehicle {
  /** Stable id so the renderer can interpolate across updates. */
  id: number;
  /** Road tile next to the home building (-1 = unassigned). */
  homeRoad: number;
  /** Road tile next to the workplace (-1 = no workplace found). */
  workRoad: number;
  x: number;
  y: number;
  angle: number;
  phase: VehiclePhase;
  /** Road tiles of the current trip (empty while parked). */
  path: number[];
  pathIndex: number;
  /** Departure offset in ticks within the commute window. */
  departureOffset: number;
  /** Battery state of charge, 0..1. Drains while driving. */
  charge: number;
  /** Ticks spent on the current trip (congestion measurement). */
  tripTicks: number;
  /** Ticks the current trip would take with free-flowing traffic. */
  tripFreeFlowTicks: number;
  /** True while plugged in this tick (drives the charging load). */
  charging: boolean;
}

/** A reversible build action for the undo tool. */
export interface UndoEntry {
  /** Money to restore (refunds the cost of the undone action). */
  moneyDelta: number;
  /** Tile snapshots to restore, keyed by index. */
  tiles: Array<{
    index: number;
    tileType: number;
    roadMask: number;
    zone: number;
    density: number;
    variant: number;
    plantType: number;
  }>;
}

export interface TileLayers {
  tileType: Uint8Array;
  roadMask: Uint8Array;
  zone: Uint8Array;
  density: Uint8Array;
  variant: Uint8Array;
  supplied: Uint8Array;
  plantType: Uint8Array;
  /** Immutable ground type (land / river / lake), generated per map. */
  terrain: Uint8Array;
  /** Ticks since the building on this tile last changed (not persisted). */
  buildingAge: Uint32Array;
  /** Consecutive ticks without full supply (not persisted). */
  troubledTicks: Uint32Array;
}

export interface SimState {
  seed: number;
  size: number;
  rng: Rng;
  tick: number;
  speed: Speed;
  money: number;
  taxRate: number;
  smartCharging: boolean;
  happiness: number;
  storedEnergy: number;
  /** Energy stored in pumped storage plants (separate pool from batteries). */
  pumpedStorageEnergy: number;
  weather: Weather;
  layers: TileLayers;
  vehicles: Vehicle[];
  undoStack: UndoEntry[];
  energyHistory: EnergyHistoryPoint[];
  /** Tile indices changed since the last diff collection. */
  dirty: Set<number>;
  /** Demand computed during the last tick, shown in the HUD. */
  lastDemand: DemandStats;
  /** Achieved goal ids (persisted with the save game). */
  goalsAchieved: Set<string>;
  /** Transient goal progress counters. */
  goalProgress: { cleanDayTicks: number; exportedTotal: number };
  /** Monotonic id source for vehicles (not persisted). */
  nextVehicleId: number;
  /**
   * Smoothed ratio of actual to free-flow commute time (1 = no jams).
   * Feeds the commute happiness penalty.
   */
  commuteCongestion: number;
  /** Daily lifetime statistics (persisted) plus running day sums. */
  lifetime: {
    samples: LifetimeSample[];
    daySums: { generation: number; consumption: number; ticks: number };
  };
  /** Set by the energy step; consumed by growth/happiness. */
  lastEnergy: {
    solar: number;
    wind: number;
    biogas: number;
    hydro: number;
    rooftop: number;
    buildingConsumption: number;
    chargingConsumption: number;
    curtailment: number;
    deficit: number;
    gridImport: number;
    gridExport: number;
  };
}

export function createTileLayers(size: number): TileLayers {
  const tiles = size * size;
  return {
    tileType: new Uint8Array(tiles),
    roadMask: new Uint8Array(tiles),
    zone: new Uint8Array(tiles),
    density: new Uint8Array(tiles),
    variant: new Uint8Array(tiles),
    supplied: new Uint8Array(tiles),
    plantType: new Uint8Array(tiles),
    terrain: new Uint8Array(tiles),
    buildingAge: new Uint32Array(tiles),
    troubledTicks: new Uint32Array(tiles),
  };
}

export function createSimState(
  seed: number,
  size: number,
  startingMoney: number = BALANCE.startingMoney,
): SimState {
  return {
    seed,
    size,
    rng: new Rng(seed),
    tick: 0,
    speed: 1,
    money: startingMoney,
    taxRate: BALANCE.tax.defaultRate,
    smartCharging: false,
    happiness: BALANCE.happiness.base,
    storedEnergy: 0,
    pumpedStorageEnergy: 0,
    weather: { cloudCover: 0.3, windSpeed: 0.5, riverFlow: BALANCE.water.initialFlow },
    layers: createTileLayers(size),
    vehicles: [],
    undoStack: [],
    energyHistory: [],
    dirty: new Set(),
    lastDemand: { residential: 0, commercial: 0, retail: 0 },
    goalsAchieved: new Set(),
    goalProgress: { cleanDayTicks: 0, exportedTotal: 0 },
    nextVehicleId: 1,
    commuteCongestion: 1,
    lifetime: { samples: [], daySums: { generation: 0, consumption: 0, ticks: 0 } },
    lastEnergy: {
      solar: 0,
      wind: 0,
      biogas: 0,
      hydro: 0,
      rooftop: 0,
      buildingConsumption: 0,
      chargingConsumption: 0,
      curtailment: 0,
      deficit: 0,
      gridImport: 0,
      gridExport: 0,
    },
  };
}

export function markDirty(state: SimState, index: number): void {
  state.dirty.add(index);
}

/** Collect and clear the pending tile diffs. */
export function collectDiffs(state: SimState): TileDiff[] {
  const { layers } = state;
  const diffs: TileDiff[] = [];
  for (const index of state.dirty) {
    diffs.push({
      index,
      tileType: layers.tileType[index] as TileDiff['tileType'],
      roadMask: layers.roadMask[index],
      zone: layers.zone[index] as TileDiff['zone'],
      density: layers.density[index],
      variant: layers.variant[index],
      supplied: layers.supplied[index] as TileDiff['supplied'],
      plantType: layers.plantType[index] as TileDiff['plantType'],
      terrain: layers.terrain[index] as TileDiff['terrain'],
    });
  }
  state.dirty.clear();
  return diffs;
}

/** Mark every tile dirty, e.g. after loading a save game. */
export function markAllDirty(state: SimState): void {
  for (let i = 0; i < state.size * state.size; i++) {
    state.dirty.add(i);
  }
}

/** What a placement is trying to do; decides which terrain accepts it. */
export const BuildIntent = { Road: 0, Zone: 1, Plant: 2 } as const;
export type BuildIntent = (typeof BuildIntent)[keyof typeof BuildIntent];

/** True when any 4-neighbour is a lake tile. */
export function isLakeShore(state: SimState, index: number): boolean {
  const { terrain } = state.layers;
  return neighbors4(index, state.size).some((n) => terrain[n] === Terrain.Lake);
}

/**
 * Why a tile cannot be built on with the given intent, or null when it
 * can. Land accepts everything (except run-of-river, which needs the
 * river); river tiles accept bridges and run-of-river plants; lakes
 * accept nothing. Pumped storage additionally needs a lake shore.
 */
export function buildRejection(
  state: SimState,
  index: number,
  intent: BuildIntent,
  plant: PlantType = PlantType.None,
): string | null {
  const { layers } = state;
  if (layers.tileType[index] !== TileType.Empty || layers.density[index] !== 0) {
    return 'tileOccupied';
  }
  const terrain = layers.terrain[index] as Terrain;
  const wantsRiver = intent === BuildIntent.Plant && plant === PlantType.RunOfRiver;
  if (terrain === Terrain.Lake) return 'cannotBuildOnWater';
  if (terrain === Terrain.River) {
    if (intent === BuildIntent.Road || wantsRiver) return null;
    return 'cannotBuildOnWater';
  }
  if (wantsRiver) return 'needsRiverTile';
  if (
    intent === BuildIntent.Plant &&
    plant === PlantType.PumpedStorage &&
    !isLakeShore(state, index)
  ) {
    return 'needsLakeShore';
  }
  return null;
}

export function isBuildable(
  state: SimState,
  index: number,
  intent: BuildIntent,
  plant: PlantType = PlantType.None,
): boolean {
  return buildRejection(state, index, intent, plant) === null;
}

function copyBuffer(view: Uint8Array | Uint32Array): ArrayBuffer {
  return view.slice().buffer as ArrayBuffer;
}

export function serializeState(state: SimState): SaveGame {
  const { layers } = state;
  return {
    version: SAVE_VERSION,
    seed: state.seed,
    size: state.size,
    tick: state.tick,
    money: state.money,
    taxRate: state.taxRate,
    smartCharging: state.smartCharging,
    storedEnergy: state.storedEnergy,
    goals: [...state.goalsAchieved],
    lifetime: state.lifetime.samples.map((sample) => ({ ...sample })),
    layers: {
      tileType: copyBuffer(layers.tileType),
      roadMask: copyBuffer(layers.roadMask),
      zone: copyBuffer(layers.zone),
      density: copyBuffer(layers.density),
      variant: copyBuffer(layers.variant),
      supplied: copyBuffer(layers.supplied),
      plantType: copyBuffer(layers.plantType),
    },
  };
}

export function deserializeState(save: SaveGame): SimState {
  const state = createSimState(save.seed, save.size);
  state.tick = save.tick;
  state.money = save.money;
  state.taxRate = save.taxRate;
  state.smartCharging = save.smartCharging;
  state.storedEnergy = save.storedEnergy;
  state.goalsAchieved = new Set(save.goals ?? []);
  state.lifetime.samples = (save.lifetime ?? []).map((sample) => ({ ...sample }));
  state.layers.tileType.set(new Uint8Array(save.layers.tileType));
  state.layers.roadMask.set(new Uint8Array(save.layers.roadMask));
  state.layers.zone.set(new Uint8Array(save.layers.zone));
  state.layers.density.set(new Uint8Array(save.layers.density));
  state.layers.variant.set(new Uint8Array(save.layers.variant));
  state.layers.supplied.set(new Uint8Array(save.layers.supplied));
  state.layers.plantType.set(new Uint8Array(save.layers.plantType));
  // Advance the RNG deterministically past the founding state so a loaded
  // game does not replay the exact random sequence from tick zero.
  state.rng.setState(save.seed ^ save.tick);
  markAllDirty(state);
  return state;
}

/** Count population and jobs from the current building layers. */
export function countPopulationAndJobs(state: SimState): {
  population: number;
  jobs: number;
} {
  const { zone, density, tileType } = state.layers;
  let population = 0;
  let jobs = 0;
  for (let i = 0; i < zone.length; i++) {
    if (tileType[i] !== TileType.Empty) continue;
    const d = density[i];
    if (d === 0) continue;
    const z = zone[i] as Zone;
    if (z === Zone.Residential) {
      population += BALANCE.growth.populationByDensity[d];
    } else if (z === Zone.Commercial || z === Zone.Retail) {
      jobs += BALANCE.growth.jobsByZoneAndDensity[z][d];
    }
  }
  return { population, jobs };
}

/** Number of plants of a given type currently placed. */
export function countPlants(state: SimState, plant: PlantType): number {
  const { tileType, plantType } = state.layers;
  let count = 0;
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] === TileType.Plant && plantType[i] === plant) count++;
  }
  return count;
}

export function totalStorageCapacity(state: SimState): number {
  return countPlants(state, PlantType.Battery) * BALANCE.energy.batteryCapacity;
}

export function totalPumpedStorageCapacity(state: SimState): number {
  return countPlants(state, PlantType.PumpedStorage) * BALANCE.energy.pumpedStorageCapacity;
}

/** Append an energy history sample, keeping one in-game day of samples. */
export function pushEnergyHistory(state: SimState, point: EnergyHistoryPoint): void {
  state.energyHistory.push(point);
  if (state.energyHistory.length > ENERGY_HISTORY_SAMPLES) {
    state.energyHistory.shift();
  }
}

export { SupplyStatus, TileType, Zone, PlantType, Terrain };
