import { BALANCE, TICK_RATE, TICKS_PER_DAY } from '../shared/constants.ts';
import { neighbors4, tileX, tileY } from '../shared/grid.ts';
import { Zone } from '../shared/types.ts';
import { censusPlants } from './energy.ts';
import {
  countPopulationAndJobs,
  TileType,
  VehiclePhase,
  type SimState,
  type Vehicle,
} from './state.ts';
import { timeOfDay } from './tick.ts';

/** Interpolated hourly factor from a 24-value profile. */
function profileFactor(profile: readonly number[], time: number): number {
  const hour = (time * 24) % 24;
  const lower = Math.floor(hour) % 24;
  const upper = (lower + 1) % 24;
  const blend = hour - Math.floor(hour);
  return profile[lower] * (1 - blend) + profile[upper] * blend;
}

/**
 * Breadth-first search over road tiles. Returns the tile path from
 * `from` to `to` (both included), or null when they are not connected.
 */
export function findRoadPath(state: SimState, from: number, to: number): number[] | null {
  const { tileType } = state.layers;
  if (tileType[from] !== TileType.Road || tileType[to] !== TileType.Road) {
    return null;
  }
  if (from === to) return [from];

  const cameFrom = new Int32Array(state.size * state.size).fill(-1);
  cameFrom[from] = from;
  let frontier = [from];
  while (frontier.length > 0) {
    const next: number[] = [];
    for (const tile of frontier) {
      for (const neighbor of neighbors4(tile, state.size)) {
        if (tileType[neighbor] !== TileType.Road || cameFrom[neighbor] !== -1) {
          continue;
        }
        cameFrom[neighbor] = tile;
        if (neighbor === to) {
          const path = [to];
          let current = to;
          while (current !== from) {
            current = cameFrom[current];
            path.push(current);
          }
          return path.reverse();
        }
        next.push(neighbor);
      }
    }
    frontier = next;
  }
  return null;
}

/** Road tiles adjacent to buildings of the given zones. */
function roadTilesNextToZones(state: SimState, zones: readonly Zone[]): number[] {
  const { tileType, zone, density } = state.layers;
  const result: number[] = [];
  const seen = new Set<number>();
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] !== TileType.Empty || density[i] === 0) continue;
    if (!zones.includes(zone[i] as Zone)) continue;
    for (const neighbor of neighbors4(i, state.size)) {
      if (tileType[neighbor] === TileType.Road && !seen.has(neighbor)) {
        seen.add(neighbor);
        result.push(neighbor);
      }
    }
  }
  return result;
}

function departureTicks(startHour: number, offset: number): number {
  return Math.floor((startHour / 24) * TICKS_PER_DAY) + offset;
}

function parkAt(state: SimState, vehicle: Vehicle, tile: number): void {
  vehicle.x = tileX(tile, state.size) + 0.5;
  vehicle.y = tileY(tile, state.size) + 0.5;
  vehicle.path = [];
  vehicle.pathIndex = 0;
}

/**
 * Commuting electric vehicles: every vehicle has a home and (if the city
 * offers one) a workplace, and drives the road network between them via
 * breadth-first pathfinding — to work in the morning, home in the
 * evening, with seeded departure offsets so traffic ramps up naturally.
 */
export function vehiclesStep(state: SimState): void {
  const { population, jobs } = countPopulationAndJobs(state);
  const targetCount = Math.min(
    BALANCE.vehicles.maxVehicles,
    Math.floor((population + jobs) / BALANCE.vehicles.citizensPerVehicle),
  );

  const homeRoads = roadTilesNextToZones(state, [Zone.Residential]);
  const workRoads = roadTilesNextToZones(state, [Zone.Commercial, Zone.Retail]);

  if (homeRoads.length === 0) {
    state.vehicles.length = 0;
    return;
  }

  while (state.vehicles.length > targetCount) state.vehicles.pop();
  const windowTicks = Math.floor(
    (BALANCE.vehicles.commute.departureWindowHours / 24) * TICKS_PER_DAY,
  );
  while (state.vehicles.length < targetCount) {
    const home = homeRoads[state.rng.nextInt(homeRoads.length)];
    const work = workRoads.length > 0 ? workRoads[state.rng.nextInt(workRoads.length)] : -1;
    const vehicle: Vehicle = {
      id: state.nextVehicleId++,
      homeRoad: home,
      workRoad: work,
      x: tileX(home, state.size) + 0.5,
      y: tileY(home, state.size) + 0.5,
      angle: 0,
      phase: VehiclePhase.ParkedHome,
      path: [],
      pathIndex: 0,
      departureOffset: state.rng.nextInt(Math.max(1, windowTicks)),
    };
    state.vehicles.push(vehicle);
  }

  const { tileType } = state.layers;
  const step = BALANCE.vehicles.speedTilesPerSecond / TICK_RATE;
  const ticksIntoDay = state.tick % TICKS_PER_DAY;
  const morningDeparture = departureTicks(BALANCE.vehicles.commute.morningStartHour, 0);
  const eveningDeparture = departureTicks(BALANCE.vehicles.commute.eveningStartHour, 0);

  for (const vehicle of state.vehicles) {
    // Reassign endpoints that were bulldozed or lost their buildings.
    if (tileType[vehicle.homeRoad] !== TileType.Road) {
      vehicle.homeRoad = homeRoads[state.rng.nextInt(homeRoads.length)];
      vehicle.phase = VehiclePhase.ParkedHome;
      parkAt(state, vehicle, vehicle.homeRoad);
    }
    if (vehicle.workRoad >= 0 && tileType[vehicle.workRoad] !== TileType.Road) {
      vehicle.workRoad = workRoads.length > 0 ? workRoads[state.rng.nextInt(workRoads.length)] : -1;
      if (vehicle.phase !== VehiclePhase.ParkedHome) {
        vehicle.phase = VehiclePhase.ParkedHome;
        parkAt(state, vehicle, vehicle.homeRoad);
      }
    }
    if (vehicle.workRoad < 0 && workRoads.length > 0) {
      vehicle.workRoad = workRoads[state.rng.nextInt(workRoads.length)];
    }

    switch (vehicle.phase) {
      case VehiclePhase.ParkedHome: {
        const departAt = morningDeparture + vehicle.departureOffset;
        if (vehicle.workRoad >= 0 && ticksIntoDay >= departAt && ticksIntoDay < eveningDeparture) {
          const path = findRoadPath(state, vehicle.homeRoad, vehicle.workRoad);
          if (path) {
            vehicle.path = path;
            vehicle.pathIndex = 0;
            vehicle.phase = VehiclePhase.ToWork;
          } else {
            // Not connected (yet): try again tomorrow.
            vehicle.departureOffset = state.rng.nextInt(Math.max(1, windowTicks));
          }
        }
        break;
      }
      case VehiclePhase.ParkedWork: {
        const departAt = eveningDeparture + vehicle.departureOffset;
        if (ticksIntoDay >= departAt || ticksIntoDay < morningDeparture) {
          const path = findRoadPath(state, vehicle.workRoad, vehicle.homeRoad);
          if (path) {
            vehicle.path = path;
            vehicle.pathIndex = 0;
            vehicle.phase = VehiclePhase.ToHome;
          }
        }
        break;
      }
      case VehiclePhase.ToWork:
      case VehiclePhase.ToHome: {
        driveAlongPath(state, vehicle, step);
        break;
      }
    }
  }
}

function driveAlongPath(state: SimState, vehicle: Vehicle, step: number): void {
  // A bulldozed tile on the route: abort the trip and re-plan next tick.
  const target = vehicle.path[vehicle.pathIndex];
  if (target === undefined || state.layers.tileType[target] !== TileType.Road) {
    const parked = vehicle.phase === VehiclePhase.ToWork ? vehicle.homeRoad : vehicle.workRoad;
    vehicle.phase =
      vehicle.phase === VehiclePhase.ToWork ? VehiclePhase.ParkedHome : VehiclePhase.ParkedWork;
    parkAt(state, vehicle, parked);
    return;
  }

  const targetX = tileX(target, state.size) + 0.5;
  const targetY = tileY(target, state.size) + 0.5;
  const dx = targetX - vehicle.x;
  const dy = targetY - vehicle.y;
  const distance = Math.hypot(dx, dy);

  if (distance <= step) {
    vehicle.x = targetX;
    vehicle.y = targetY;
    vehicle.pathIndex++;
    if (vehicle.pathIndex >= vehicle.path.length) {
      vehicle.phase =
        vehicle.phase === VehiclePhase.ToWork ? VehiclePhase.ParkedWork : VehiclePhase.ParkedHome;
      vehicle.path = [];
      vehicle.pathIndex = 0;
    }
  } else {
    vehicle.x += (dx / distance) * step;
    vehicle.y += (dy / distance) * step;
    vehicle.angle = Math.atan2(dy, dx);
  }
}

/** Vehicles currently on the road (parked ones are not rendered). */
export function drivingVehicles(state: SimState): Vehicle[] {
  return state.vehicles.filter(
    (v) => v.phase === VehiclePhase.ToWork || v.phase === VehiclePhase.ToHome,
  );
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
      state.lastEnergy.solar + state.lastEnergy.wind - state.lastEnergy.buildingConsumption,
    );
    return Math.min(fullLoad, baseline + lastSurplus);
  }

  const hubs = censusPlants(state).chargingHubs;
  const hubShare = Math.min(1, (hubs * BALANCE.vehicles.vehiclesPerHub) / vehicles);
  const home = profileFactor(BALANCE.vehicles.homeChargingProfile, time);
  const hub = profileFactor(BALANCE.vehicles.hubChargingProfile, time);
  return fullLoad * ((1 - hubShare) * home + hubShare * hub);
}

export { profileFactor };
