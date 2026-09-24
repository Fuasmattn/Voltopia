import { BALANCE, TICK_RATE, TICKS_PER_DAY } from '../shared/constants.ts';
import { neighbors4, tileIndex, tileX, tileY } from '../shared/grid.ts';
import { PlantType, Zone } from '../shared/types.ts';
import {
  countPopulationAndJobs,
  TileType,
  VehiclePhase,
  type SimState,
  type Vehicle,
} from './state.ts';
import { laneKey, updateTrafficLoad } from './traffic.ts';

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

/** Tile indices of all charging hubs. */
function chargingHubTiles(state: SimState): number[] {
  const { tileType, plantType } = state.layers;
  const hubs: number[] = [];
  for (let i = 0; i < tileType.length; i++) {
    if (tileType[i] === TileType.Plant && plantType[i] === PlantType.ChargingHub) {
      hubs.push(i);
    }
  }
  return hubs;
}

function departureTicks(startHour: number): number {
  return Math.floor((startHour / 24) * TICKS_PER_DAY);
}

function parkAt(state: SimState, vehicle: Vehicle, tile: number): void {
  vehicle.x = tileX(tile, state.size) + 0.5;
  vehicle.y = tileY(tile, state.size) + 0.5;
  vehicle.path = [];
  vehicle.pathIndex = 0;
}

function vehicleTile(state: SimState, vehicle: Vehicle): number {
  return tileIndex(Math.floor(vehicle.x), Math.floor(vehicle.y), state.size);
}

/** Heading from one tile to a 4-neighbour: 0 = north, 1 = east, 2 = south, 3 = west. */
function headingOf(from: number, to: number, size: number): number {
  const dx = tileX(to, size) - tileX(from, size);
  const dy = tileY(to, size) - tileY(from, size);
  if (dx > 0) return 1;
  if (dx < 0) return 3;
  if (dy > 0) return 2;
  return 0;
}

/**
 * The lane a driving vehicle currently occupies: its tile plus the
 * heading toward its next path tile (or the one after, while it is still
 * approaching the centre of its own tile).
 */
function vehicleLane(state: SimState, vehicle: Vehicle): number {
  const tile = vehicleTile(state, vehicle);
  let target = vehicle.path[vehicle.pathIndex];
  if (target === tile) target = vehicle.path[vehicle.pathIndex + 1];
  const heading = target === undefined ? 0 : headingOf(tile, target, state.size);
  return laneKey(tile, heading);
}

/**
 * Commuting electric vehicles with a physical battery model: driving
 * drains the battery, plugging in at home (evenings) or at a nearby
 * charging hub (workdays) recharges it — the charging load on the grid
 * emerges from what the fleet actually does. Congestion: at most a few
 * vehicles fit on a road tile; followers wait, so queues form.
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
    state.vehicles.push({
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
      charge: state.rng.nextRange(0.5, 0.9),
      tripTicks: 0,
      tripFreeFlowTicks: 0,
      charging: false,
      waitTicks: 0,
    });
  }

  const { tileType } = state.layers;
  const step = BALANCE.vehicles.speedTilesPerSecond / TICK_RATE;
  const ticksIntoDay = state.tick % TICKS_PER_DAY;
  const morningDeparture = departureTicks(BALANCE.vehicles.commute.morningStartHour);
  const eveningDeparture = departureTicks(BALANCE.vehicles.commute.eveningStartHour);

  // Congestion: how many driving vehicles occupy each lane (road tile
  // and heading). Oncoming traffic uses the other lane, so it never
  // blocks; only cars going the same way queue up.
  const occupancy = new Map<number, number>();
  for (const vehicle of state.vehicles) {
    if (vehicle.phase === VehiclePhase.ToWork || vehicle.phase === VehiclePhase.ToHome) {
      const lane = vehicleLane(state, vehicle);
      occupancy.set(lane, (occupancy.get(lane) ?? 0) + 1);
    }
  }

  // Work charging: hubs serve nearby workplaces up to their capacity.
  const hubs = chargingHubTiles(state);
  const hubLoad = new Map<number, number>();

  // Smart charging gate: is there renewable surplus right now (last tick)?
  // Compared against buildings plus heating and cooling load (not charging
  // itself, or the gate would feed back on its own dispatch decision).
  const surplusAvailable =
    state.lastEnergy.solar +
      state.lastEnergy.wind +
      state.lastEnergy.rooftop +
      state.lastEnergy.hydro >
    state.lastEnergy.buildingConsumption +
      state.lastEnergy.heatingConsumption +
      state.lastEnergy.coolingConsumption;

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
            startTripClock(vehicle, step);
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
            startTripClock(vehicle, step);
          }
        }
        break;
      }
      case VehiclePhase.ToWork:
      case VehiclePhase.ToHome: {
        vehicle.tripTicks++;
        driveAlongPath(state, vehicle, step, occupancy);
        break;
      }
    }

    vehicle.charging = decideCharging(state, vehicle, hubs, hubLoad, surplusAvailable);
    if (vehicle.charging) {
      vehicle.charge = Math.min(1, vehicle.charge + BALANCE.vehicles.chargeRatePerTick);
    }
  }

  updateTrafficLoad(state, occupancy);
}

/**
 * Plugged in? At home whenever the battery isn't full (smart charging
 * defers to renewable surplus unless the battery is low); at work only
 * when a charging hub with free capacity is near the workplace.
 */
function decideCharging(
  state: SimState,
  vehicle: Vehicle,
  hubs: number[],
  hubLoad: Map<number, number>,
  surplusAvailable: boolean,
): boolean {
  if (vehicle.charge >= 1) return false;

  if (vehicle.phase === VehiclePhase.ParkedHome) {
    if (!state.smartCharging) return true;
    return surplusAvailable || vehicle.charge < BALANCE.vehicles.smartChargeFloor;
  }

  if (vehicle.phase === VehiclePhase.ParkedWork && vehicle.workRoad >= 0) {
    const wx = tileX(vehicle.workRoad, state.size);
    const wy = tileY(vehicle.workRoad, state.size);
    for (const hub of hubs) {
      const distance = Math.max(
        Math.abs(wx - tileX(hub, state.size)),
        Math.abs(wy - tileY(hub, state.size)),
      );
      if (distance > BALANCE.vehicles.hubRadius) continue;
      const used = hubLoad.get(hub) ?? 0;
      if (used >= BALANCE.vehicles.vehiclesPerHub) continue;
      hubLoad.set(hub, used + 1);
      return true;
    }
  }
  return false;
}

function driveAlongPath(
  state: SimState,
  vehicle: Vehicle,
  step: number,
  occupancy: Map<number, number>,
): void {
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
  const move = Math.min(step, distance);

  // Congestion: entering a lane that is full means waiting — unless the
  // wait has gone on so long that this is a gridlock, in which case the
  // car squeezes past so traffic never freezes for good.
  const currentTile = vehicleTile(state, vehicle);
  const nextX = distance <= step ? targetX : vehicle.x + (dx / distance) * move;
  const nextY = distance <= step ? targetY : vehicle.y + (dy / distance) * move;
  const nextTile = tileIndex(Math.floor(nextX), Math.floor(nextY), state.size);
  if (nextTile !== currentTile) {
    const heading = headingOf(currentTile, nextTile, state.size);
    const nextLane = laneKey(nextTile, heading);
    const full = (occupancy.get(nextLane) ?? 0) >= BALANCE.vehicles.maxPerRoadTile;
    if (full && vehicle.waitTicks < BALANCE.vehicles.maxWaitTicks) {
      vehicle.waitTicks++;
      return; // queue behind the jam, try again next tick
    }
    const currentLane = vehicleLane(state, vehicle);
    occupancy.set(currentLane, Math.max(0, (occupancy.get(currentLane) ?? 1) - 1));
    occupancy.set(nextLane, (occupancy.get(nextLane) ?? 0) + 1);
  }
  vehicle.waitTicks = 0;

  vehicle.x = nextX;
  vehicle.y = nextY;
  if (move > 1e-9) {
    vehicle.angle = Math.atan2(dy, dx);
    vehicle.charge = Math.max(0, vehicle.charge - move * BALANCE.vehicles.batteryDrainPerTile);
  }

  if (distance <= step) {
    vehicle.pathIndex++;
    if (vehicle.pathIndex >= vehicle.path.length) {
      const arrivedAtWork = vehicle.phase === VehiclePhase.ToWork;
      vehicle.phase = arrivedAtWork ? VehiclePhase.ParkedWork : VehiclePhase.ParkedHome;
      const lane = vehicleLane(state, vehicle);
      occupancy.set(lane, Math.max(0, (occupancy.get(lane) ?? 1) - 1));
      recordCommute(state, vehicle);
      vehicle.path = [];
      vehicle.pathIndex = 0;
    }
  }
}

/** Reset a vehicle's trip clock and note its free-flow duration. */
function startTripClock(vehicle: Vehicle, step: number): void {
  vehicle.tripTicks = 0;
  vehicle.tripFreeFlowTicks = Math.max(1, Math.ceil(vehicle.path.length / step));
}

/** Congestion smoothing factor per completed commute. */
const COMMUTE_EMA = 0.05;

/** Fold a finished trip into the city's smoothed congestion ratio. */
function recordCommute(state: SimState, vehicle: Vehicle): void {
  if (vehicle.tripFreeFlowTicks <= 0) return;
  const ratio = vehicle.tripTicks / vehicle.tripFreeFlowTicks;
  state.commuteCongestion += (ratio - state.commuteCongestion) * COMMUTE_EMA;
}

/** Vehicles currently on the road (parked ones are not rendered). */
export function drivingVehicles(state: SimState): Vehicle[] {
  return state.vehicles.filter(
    (v) => v.phase === VehiclePhase.ToWork || v.phase === VehiclePhase.ToHome,
  );
}

/**
 * EV charging demand for this tick: the number of vehicles actually
 * plugged in right now times the charger power. The evening peak, the
 * daytime hub window, and smart charging's surplus-following all emerge
 * from individual vehicle behavior in vehiclesStep.
 */
export function chargingDemand(state: SimState): number {
  let charging = 0;
  for (const vehicle of state.vehicles) {
    if (vehicle.charging) charging++;
  }
  return charging * BALANCE.vehicles.chargingEnergyPerVehicle;
}
