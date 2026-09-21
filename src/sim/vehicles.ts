import { BALANCE, TICK_RATE } from '../shared/constants.ts';
import { neighbors4, tileIndex, tileX, tileY } from '../shared/grid.ts';
import { PlantType } from '../shared/types.ts';
import { censusPlants } from './energy.ts';
import { countPopulationAndJobs, TileType, type SimState, type Vehicle } from './state.ts';
import { timeOfDay } from './tick.ts';

/** Interpolated hourly factor from a 24-value profile. */
function profileFactor(profile: readonly number[], time: number): number {
  const hour = (time * 24) % 24;
  const lower = Math.floor(hour) % 24;
  const upper = (lower + 1) % 24;
  const blend = hour - Math.floor(hour);
  return profile[lower] * (1 - blend) + profile[upper] * blend;
}

/** All road tile indices (used to spawn vehicles). */
function collectRoadTiles(state: SimState): number[] {
  const roads: number[] = [];
  const { tileType } = state.layers;
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] === TileType.Road) roads.push(i);
  }
  return roads;
}

/**
 * Keep the visible EV fleet in sync with the city size and drive each
 * vehicle along road tiles with a seeded random walk (no pathfinding,
 * U-turns only at dead ends).
 */
export function vehiclesStep(state: SimState): void {
  const { population, jobs } = countPopulationAndJobs(state);
  const targetCount = Math.min(
    BALANCE.vehicles.maxVehicles,
    Math.floor((population + jobs) / BALANCE.vehicles.citizensPerVehicle),
  );

  const roads = collectRoadTiles(state);
  if (roads.length === 0) {
    state.vehicles.length = 0;
    return;
  }

  while (state.vehicles.length > targetCount) state.vehicles.pop();
  while (state.vehicles.length < targetCount) {
    const spawn = roads[state.rng.nextInt(roads.length)];
    state.vehicles.push({
      x: tileX(spawn, state.size) + 0.5,
      y: tileY(spawn, state.size) + 0.5,
      angle: 0,
      targetTile: spawn,
      previousTile: spawn,
    });
  }

  const step = BALANCE.vehicles.speedTilesPerSecond / TICK_RATE;
  for (const vehicle of state.vehicles) {
    driveVehicle(state, vehicle, step);
  }
}

function driveVehicle(state: SimState, vehicle: Vehicle, step: number): void {
  const { tileType } = state.layers;
  // Target got bulldozed: hop to the nearest road tile under the vehicle.
  if (tileType[vehicle.targetTile] !== TileType.Road) {
    const current = tileIndex(
      Math.floor(vehicle.x),
      Math.floor(vehicle.y),
      state.size,
    );
    vehicle.targetTile = tileType[current] === TileType.Road ? current : -1;
    if (vehicle.targetTile < 0) return; // parked until roads come back
  }

  const targetX = tileX(vehicle.targetTile, state.size) + 0.5;
  const targetY = tileY(vehicle.targetTile, state.size) + 0.5;
  const dx = targetX - vehicle.x;
  const dy = targetY - vehicle.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= step) {
    vehicle.x = targetX;
    vehicle.y = targetY;
    const options = neighbors4(vehicle.targetTile, state.size).filter(
      (n) => state.layers.tileType[n] === TileType.Road,
    );
    if (options.length === 0) return; // isolated tile
    const forward = options.filter((n) => n !== vehicle.previousTile);
    const choices = forward.length > 0 ? forward : options;
    const next = choices[state.rng.nextInt(choices.length)];
    vehicle.previousTile = vehicle.targetTile;
    vehicle.targetTile = next;
  } else {
    vehicle.x += (dx / distance) * step;
    vehicle.y += (dy / distance) * step;
    vehicle.angle = Math.atan2(dy, dx);
  }
}

/**
 * EV charging demand for this tick.
 *
 * - Home charging peaks in the evening (commuters plug in).
 * - Charging hubs shift a share of the fleet into a daytime window that
 *   matches PV generation.
 * - The smart-charging upgrade instead follows the current generation
 *   surplus (last tick's balance), keeping only a small baseline load.
 */
export function chargingDemand(state: SimState): number {
  const vehicles = state.vehicles.length;
  if (vehicles === 0) return 0;
  const time = timeOfDay(state.tick);
  const perVehicle = BALANCE.vehicles.chargingEnergyPerVehicle;
  const fullLoad = vehicles * perVehicle;

  if (state.smartCharging) {
    const baseline = fullLoad * BALANCE.vehicles.smartChargingBaseline;
    const lastSurplus = Math.max(
      0,
      state.lastEnergy.solar +
        state.lastEnergy.wind -
        state.lastEnergy.buildingConsumption,
    );
    return Math.min(fullLoad, baseline + lastSurplus);
  }

  const hubs = censusPlants(state).chargingHubs;
  const hubShare = Math.min(
    1,
    (hubs * BALANCE.vehicles.vehiclesPerHub) / vehicles,
  );
  const home = profileFactor(BALANCE.vehicles.homeChargingProfile, time);
  const hub = profileFactor(BALANCE.vehicles.hubChargingProfile, time);
  return fullLoad * ((1 - hubShare) * home + hubShare * hub);
}

export { profileFactor, PlantType };
