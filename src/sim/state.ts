import { BALANCE, ENERGY_HISTORY_SAMPLES, SAVE_VERSION } from '../shared/constants.ts';
import { Rng } from '../shared/rng.ts';
import type {
  DemandStats,
  EnergyHistoryPoint,
  SaveGame,
  Speed,
  TileDiff,
  Weather,
} from '../shared/types.ts';
import { PlantType, SupplyStatus, TileType, Zone } from '../shared/types.ts';

/** One simulated vehicle. Continuous position in tile space. */
export interface Vehicle {
  x: number;
  y: number;
  angle: number;
  /** Tile index the vehicle is currently driving toward. */
  targetTile: number;
  /** Tile index the vehicle came from (avoids immediate U-turns). */
  previousTile: number;
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
  /** Ticks since the building on this tile last changed (not persisted). */
  buildingAge: Uint32Array;
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
  weather: Weather;
  layers: TileLayers;
  vehicles: Vehicle[];
  undoStack: UndoEntry[];
  energyHistory: EnergyHistoryPoint[];
  /** Tile indices changed since the last diff collection. */
  dirty: Set<number>;
  /** Demand computed during the last tick, shown in the HUD. */
  lastDemand: DemandStats;
  /** Set by the energy step; consumed by growth/happiness. */
  lastEnergy: {
    solar: number;
    wind: number;
    biogas: number;
    buildingConsumption: number;
    chargingConsumption: number;
    curtailment: number;
    deficit: number;
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
    buildingAge: new Uint32Array(tiles),
  };
}

export function createSimState(seed: number, size: number): SimState {
  return {
    seed,
    size,
    rng: new Rng(seed),
    tick: 0,
    speed: 1,
    money: BALANCE.startingMoney,
    taxRate: BALANCE.tax.defaultRate,
    smartCharging: false,
    happiness: BALANCE.happiness.base,
    storedEnergy: 0,
    weather: { cloudCover: 0.3, windSpeed: 0.5 },
    layers: createTileLayers(size),
    vehicles: [],
    undoStack: [],
    energyHistory: [],
    dirty: new Set(),
    lastDemand: { residential: 0, commercial: 0, retail: 0 },
    lastEnergy: {
      solar: 0,
      wind: 0,
      biogas: 0,
      buildingConsumption: 0,
      chargingConsumption: 0,
      curtailment: 0,
      deficit: 0,
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

/** Append an energy history sample, keeping one in-game day of samples. */
export function pushEnergyHistory(state: SimState, point: EnergyHistoryPoint): void {
  state.energyHistory.push(point);
  if (state.energyHistory.length > ENERGY_HISTORY_SAMPLES) {
    state.energyHistory.shift();
  }
}

export { SupplyStatus, TileType, Zone, PlantType };
