import { describe, expect, it } from 'vitest';
import { BALANCE, TICKS_PER_DAY } from '../shared/constants.ts';
import { tileIndex } from '../shared/grid.ts';
import { PlantType, Zone } from '../shared/types.ts';
import { placePlant } from './energy.ts';
import { buildRoads } from './roads.ts';
import { createSimState, TileType, VehiclePhase, type SimState } from './state.ts';
import { chargingDemand, drivingVehicles, findRoadPath, vehiclesStep } from './vehicles.ts';

const SIZE = 24;
const at = (x: number, y: number) => tileIndex(x, y, SIZE);

/**
 * A commuter town: homes in the west, jobs in the east, one main road.
 * ~citizens residents plus enough commercial density for workplaces.
 */
function commuterTown(seed = 1, citizens = 150): SimState {
  const state = createSimState(seed, SIZE);
  const road = Array.from({ length: 16 }, (_, x) => at(x + 3, 10));
  buildRoads(state, road);
  const perBuilding = BALANCE.growth.populationByDensity[3];
  const homes = Math.ceil(citizens / perBuilding);
  for (let i = 0; i < homes; i++) {
    state.layers.zone[at(3 + i, 9)] = Zone.Residential;
    state.layers.density[at(3 + i, 9)] = 3;
  }
  for (let i = 0; i < 4; i++) {
    state.layers.zone[at(15 + i, 9)] = Zone.Commercial;
    state.layers.density[at(15 + i, 9)] = 3;
  }
  return state;
}

function setHour(state: SimState, hour: number): void {
  state.tick =
    Math.floor(state.tick / TICKS_PER_DAY) * TICKS_PER_DAY +
    Math.round((hour / 24) * TICKS_PER_DAY);
}

/** Run whole in-game hours of vehicle simulation. */
function runHours(state: SimState, hours: number): void {
  const ticks = Math.round((hours / 24) * TICKS_PER_DAY);
  for (let i = 0; i < ticks; i++) {
    vehiclesStep(state);
    state.tick++;
  }
}

describe('findRoadPath', () => {
  it('finds a connected path along roads', () => {
    const state = commuterTown();
    const path = findRoadPath(state, at(3, 10), at(18, 10));
    expect(path).not.toBeNull();
    expect(path![0]).toBe(at(3, 10));
    expect(path![path!.length - 1]).toBe(at(18, 10));
    for (const tile of path!) {
      expect(state.layers.tileType[tile]).toBe(TileType.Road);
    }
    // Straight road: the path is the direct line.
    expect(path!.length).toBe(16);
  });

  it('returns null for disconnected networks', () => {
    const state = createSimState(1, SIZE);
    buildRoads(state, [at(2, 2), at(3, 2)]);
    buildRoads(state, [at(10, 10), at(11, 10)]);
    expect(findRoadPath(state, at(2, 2), at(10, 10))).toBeNull();
  });

  it('handles from === to', () => {
    const state = commuterTown();
    expect(findRoadPath(state, at(5, 10), at(5, 10))).toEqual([at(5, 10)]);
  });
});

describe('vehiclesStep (commuting)', () => {
  it('fleet size scales with population', () => {
    const small = commuterTown(1, 60);
    const large = commuterTown(1, 250);
    vehiclesStep(small);
    vehiclesStep(large);
    expect(large.vehicles.length).toBeGreaterThan(small.vehicles.length);
  });

  it('no vehicles without residential buildings next to roads', () => {
    const state = createSimState(1, SIZE);
    buildRoads(state, [at(2, 2), at(3, 2)]);
    vehiclesStep(state);
    expect(state.vehicles).toHaveLength(0);
  });

  it('vehicles drive to work in the morning and are parked before dawn', () => {
    const state = commuterTown(7, 200);
    setHour(state, 5);
    vehiclesStep(state);
    expect(drivingVehicles(state)).toHaveLength(0);

    setHour(state, BALANCE.vehicles.commute.morningStartHour);
    runHours(state, BALANCE.vehicles.commute.departureWindowHours / 2);
    expect(drivingVehicles(state).length).toBeGreaterThan(0);
  });

  it('vehicles arrive at work and later return home', () => {
    const state = commuterTown(3, 200);
    setHour(state, BALANCE.vehicles.commute.morningStartHour);
    vehiclesStep(state); // spawn fleet
    runHours(state, 4); // morning window + travel time
    const atWork = state.vehicles.filter((v) => v.phase === VehiclePhase.ParkedWork);
    expect(atWork.length).toBe(state.vehicles.length);

    setHour(state, BALANCE.vehicles.commute.eveningStartHour);
    runHours(state, 4);
    const atHome = state.vehicles.filter((v) => v.phase === VehiclePhase.ParkedHome);
    expect(atHome.length).toBe(state.vehicles.length);
  });

  it('driving vehicles stay on road tiles', () => {
    const state = commuterTown(9, 200);
    setHour(state, BALANCE.vehicles.commute.morningStartHour);
    const ticks = Math.round((3 / 24) * TICKS_PER_DAY);
    for (let i = 0; i < ticks; i++) {
      vehiclesStep(state);
      state.tick++;
      for (const v of drivingVehicles(state)) {
        const tile = at(Math.floor(v.x), Math.floor(v.y));
        expect(state.layers.tileType[tile]).toBe(TileType.Road);
      }
    }
  });

  it('without workplaces, vehicles stay parked at home', () => {
    const state = createSimState(1, SIZE);
    buildRoads(
      state,
      Array.from({ length: 8 }, (_, x) => at(x + 3, 10)),
    );
    for (let i = 0; i < 4; i++) {
      state.layers.zone[at(3 + i, 9)] = Zone.Residential;
      state.layers.density[at(3 + i, 9)] = 3;
    }
    setHour(state, 8);
    runHours(state, 3);
    expect(state.vehicles.length).toBeGreaterThan(0);
    expect(drivingVehicles(state)).toHaveLength(0);
  });

  it('a disconnected workplace means no trip (and no crash)', () => {
    const state = createSimState(1, SIZE);
    buildRoads(
      state,
      Array.from({ length: 4 }, (_, x) => at(x + 2, 5)),
    );
    buildRoads(
      state,
      Array.from({ length: 4 }, (_, x) => at(x + 12, 15)),
    );
    state.layers.zone[at(2, 4)] = Zone.Residential;
    state.layers.density[at(2, 4)] = 3;
    state.layers.zone[at(12, 14)] = Zone.Commercial;
    state.layers.density[at(12, 14)] = 3;
    setHour(state, 8);
    runHours(state, 3);
    expect(drivingVehicles(state)).toHaveLength(0);
  });

  it('is deterministic', () => {
    const a = commuterTown(5, 200);
    const b = commuterTown(5, 200);
    setHour(a, 6);
    setHour(b, 6);
    for (let i = 0; i < 800; i++) {
      vehiclesStep(a);
      a.tick++;
      vehiclesStep(b);
      b.tick++;
    }
    expect(a.vehicles).toEqual(b.vehicles);
  });
});

/** Simulate from the state's current tick for whole in-game days. */
function runDays(state: SimState, days: number, sample?: (hour: number) => void): void {
  const ticks = days * TICKS_PER_DAY;
  for (let i = 0; i < ticks; i++) {
    vehiclesStep(state);
    if (sample) sample(((state.tick % TICKS_PER_DAY) / TICKS_PER_DAY) * 24);
    state.tick++;
  }
}

describe('emergent charging', () => {
  it('driving drains the battery', () => {
    const state = commuterTown(3, 200);
    setHour(state, BALANCE.vehicles.commute.morningStartHour);
    vehiclesStep(state);
    const before = state.vehicles.map((v) => v.charge);
    runHours(state, 4);
    const drained = state.vehicles.filter((v, i) => v.charge < before[i]);
    expect(drained.length).toBeGreaterThan(0);
  });

  it('the evening home-charging peak emerges from arrivals', () => {
    const state = commuterTown(11, 200);
    const demandByHour = new Map<number, number>();
    runDays(state, 2, (hour) => {
      // keep the day-2 samples only (day 1 still burns the spawn charge)
      if (state.tick >= TICKS_PER_DAY) {
        demandByHour.set(Math.floor(hour), chargingDemand(state));
      }
    });
    const atWorkNoon = demandByHour.get(13) ?? 0;
    const evening = demandByHour.get(19) ?? 0;
    // No hubs: nothing charges at work; plugging in happens after the
    // evening commute.
    expect(atWorkNoon).toBe(0);
    expect(evening).toBeGreaterThan(0);
  });

  it('charging hubs near workplaces shift load into the day', () => {
    const withHub = commuterTown(11, 200);
    placePlant(withHub, at(17, 11), PlantType.ChargingHub); // next to the jobs
    const demandByHour = new Map<number, number>();
    runDays(withHub, 2, (hour) => {
      if (withHub.tick >= TICKS_PER_DAY) {
        demandByHour.set(Math.floor(hour), chargingDemand(withHub));
      }
    });
    // Mid-morning, arrivals are plugged in at the hub (PV ramp window).
    expect(demandByHour.get(10) ?? 0).toBeGreaterThan(0);
  });

  it('a hub only serves a limited number of vehicles', () => {
    const state = commuterTown(11, 250);
    placePlant(state, at(17, 11), PlantType.ChargingHub);
    setHour(state, 12);
    // Everyone parked at work with an empty-ish battery.
    vehiclesStep(state);
    for (const v of state.vehicles) {
      v.phase = VehiclePhase.ParkedWork;
      v.charge = 0.3;
      v.path = [];
    }
    vehiclesStep(state);
    const charging = state.vehicles.filter((v) => v.charging).length;
    expect(charging).toBeGreaterThan(0);
    expect(charging).toBeLessThanOrEqual(BALANCE.vehicles.vehiclesPerHub);
  });

  it('smart charging defers home charging until there is surplus', () => {
    const state = commuterTown(5, 200);
    state.smartCharging = true;
    setHour(state, 3); // everyone parked at home
    vehiclesStep(state);
    for (const v of state.vehicles) v.charge = 0.8; // above the floor

    // No renewable surplus: nobody charges.
    state.lastEnergy.solar = 0;
    state.lastEnergy.wind = 0;
    state.lastEnergy.rooftop = 0;
    state.lastEnergy.buildingConsumption = 50;
    vehiclesStep(state);
    expect(chargingDemand(state)).toBe(0);

    // Surplus appears: charging follows it.
    state.lastEnergy.wind = 500;
    vehiclesStep(state);
    expect(chargingDemand(state)).toBeGreaterThan(0);

    // Below the floor, vehicles charge even without surplus.
    state.lastEnergy.wind = 0;
    for (const v of state.vehicles) v.charge = BALANCE.vehicles.smartChargeFloor - 0.1;
    vehiclesStep(state);
    expect(chargingDemand(state)).toBeGreaterThan(0);
  });

  it('smart charging counts hydro surplus (run-of-river covers night load too)', () => {
    const state = commuterTown(5, 200);
    state.smartCharging = true;
    setHour(state, 3); // everyone parked at home
    vehiclesStep(state);
    for (const v of state.vehicles) v.charge = 0.8; // above the floor

    // Only hydro is generating, but it covers the load: this is a
    // surplus and smart charging should let vehicles charge past the
    // floor, same as with solar/wind/rooftop surplus.
    state.lastEnergy.solar = 0;
    state.lastEnergy.wind = 0;
    state.lastEnergy.rooftop = 0;
    state.lastEnergy.hydro = 500;
    state.lastEnergy.buildingConsumption = 50;
    vehiclesStep(state);
    expect(chargingDemand(state)).toBeGreaterThan(0);
  });

  it('smart charging gate counts cooling load, not just building consumption', () => {
    const state = commuterTown(5, 200);
    state.smartCharging = true;
    setHour(state, 3); // everyone parked at home
    vehiclesStep(state);
    for (const v of state.vehicles) v.charge = 0.8; // above the floor

    // Generation covers buildings alone, but the cooling load eats the
    // rest: this is not a real surplus, so smart charging must not
    // dispatch vehicles into the shortfall.
    state.lastEnergy.solar = 60;
    state.lastEnergy.wind = 0;
    state.lastEnergy.rooftop = 0;
    state.lastEnergy.hydro = 0;
    state.lastEnergy.buildingConsumption = 50;
    state.lastEnergy.heatingConsumption = 0;
    state.lastEnergy.coolingConsumption = 20;
    vehiclesStep(state);
    expect(chargingDemand(state)).toBe(0);

    // With cooling load at 0, the same generation is a real surplus.
    state.lastEnergy.coolingConsumption = 0;
    vehiclesStep(state);
    expect(chargingDemand(state)).toBeGreaterThan(0);
  });

  it('full batteries stop charging', () => {
    const state = commuterTown(5, 200);
    setHour(state, 3);
    vehiclesStep(state);
    for (const v of state.vehicles) v.charge = 1;
    vehiclesStep(state);
    expect(chargingDemand(state)).toBe(0);
  });
});

describe('congestion', () => {
  /** A hand-built driving vehicle for gate tests. */
  function makeDriver(state: SimState, id: number, tile: number, path: number[], workRoad: number) {
    state.vehicles.push({
      id,
      homeRoad: tile,
      workRoad,
      x: (tile % SIZE) + 0.5,
      y: Math.floor(tile / SIZE) + 0.5,
      angle: 0,
      phase: VehiclePhase.ToWork,
      path,
      pathIndex: 0,
      departureOffset: 0,
      charge: 0.8,
      tripTicks: 0,
      tripFreeFlowTicks: 0,
      charging: false,
      waitTicks: 0,
    });
  }

  /**
   * Enough residents next to the road that vehiclesStep keeps the
   * hand-built drivers (it trims the fleet to population / citizensPerVehicle).
   */
  function residents(state: SimState, xFrom: number, y: number, tiles = 4): void {
    for (let i = 0; i < tiles; i++) {
      state.layers.zone[at(xFrom + i, y)] = Zone.Residential;
      state.layers.density[at(xFrom + i, y)] = 3;
    }
  }

  it('a full tile blocks followers from entering', () => {
    const state = createSimState(1, SIZE);
    const a = at(3, 5);
    const b = at(4, 5);
    const c = at(5, 5);
    buildRoads(state, [a, b, c]);
    residents(state, 3, 4);
    // The follower is processed first; two blockers already fill tile b's
    // eastbound lane and are held there.
    makeDriver(state, 100, a, [b, c], c);
    makeDriver(state, 101, b, [b, c], c);
    makeDriver(state, 102, b, [b, c], c);
    const [follower, ...blockers] = state.vehicles;
    for (let i = 0; i < 5; i++) {
      vehiclesStep(state);
      for (const blocker of blockers) {
        blocker.x = (b % SIZE) + 0.5;
        blocker.pathIndex = 0;
      }
    }
    expect(follower.x).toBeLessThan(4); // rolled to the edge of a, never entered b
  });

  it('queues form at a bottleneck but everyone still arrives', () => {
    const state = createSimState(2, SIZE);
    const road = Array.from({ length: 14 }, (_, x) => at(x + 3, 10));
    buildRoads(state, road);
    // Homes spread along the road, one shared workplace at the far end.
    for (let i = 0; i < 8; i++) {
      state.layers.zone[at(3 + i, 9)] = Zone.Residential;
      state.layers.density[at(3 + i, 9)] = 3;
    }
    state.layers.zone[at(16, 9)] = Zone.Commercial;
    state.layers.density[at(16, 9)] = 3;
    setHour(state, BALANCE.vehicles.commute.morningStartHour);
    vehiclesStep(state);
    for (const v of state.vehicles) v.departureOffset = 0; // rush together

    let sawWaiting = false;
    const positions = new Map<number, number>();
    for (let i = 0; i < TICKS_PER_DAY / 4; i++) {
      for (const v of drivingVehicles(state)) positions.set(v.id, v.x);
      vehiclesStep(state);
      state.tick++;
      for (const v of drivingVehicles(state)) {
        if (positions.get(v.id) === v.x && v.path.length > 0) sawWaiting = true;
      }
    }
    expect(sawWaiting).toBe(true);
    expect(state.vehicles.every((v) => v.phase === VehiclePhase.ParkedWork)).toBe(true);
  });

  it('oncoming traffic uses the other lane and does not block', () => {
    const state = createSimState(1, SIZE);
    const a = at(3, 5);
    const b = at(4, 5);
    const c = at(5, 5);
    buildRoads(state, [a, b, c]);
    residents(state, 3, 4);
    // Two westbound cars fill tile b's westbound lane; the eastbound
    // follower on a must still be able to enter b.
    makeDriver(state, 100, a, [b, c], c);
    makeDriver(state, 101, b, [b, a], a);
    makeDriver(state, 102, b, [b, a], a);
    const follower = state.vehicles[0];
    const xBefore = follower.x;
    vehiclesStep(state);
    expect(follower.x).toBeGreaterThan(xBefore);
  });

  it('head-on traffic on a single road never deadlocks', () => {
    const state = createSimState(1, SIZE);
    const road = Array.from({ length: 12 }, (_, x) => at(x + 2, 5));
    buildRoads(state, road);
    residents(state, 2, 4);
    const east = road.slice(4); // from x=6 to the east end
    const west = road.slice(0, 6).reverse(); // from x=7 to the west end
    makeDriver(state, 100, at(6, 5), east, road[11]);
    makeDriver(state, 101, at(6, 5), east, road[11]);
    makeDriver(state, 102, at(7, 5), west, road[0]);
    makeDriver(state, 103, at(7, 5), west, road[0]);
    state.tick = TICKS_PER_DAY / 2; // noon: no scheduled departures interfere
    for (let i = 0; i < 200; i++) {
      vehiclesStep(state);
      state.tick++;
    }
    // Everyone got past the oncoming pair and finished the trip.
    expect(state.vehicles.slice(0, 4).every((v) => v.phase === VehiclePhase.ParkedWork)).toBe(true);
  });

  it('a car blocked for too long squeezes past instead of waiting forever', () => {
    const state = createSimState(1, SIZE);
    const a = at(3, 5);
    const b = at(4, 5);
    const c = at(5, 5);
    buildRoads(state, [a, b, c]);
    residents(state, 3, 4);
    makeDriver(state, 100, a, [b, c], c);
    makeDriver(state, 101, b, [b, c], c);
    makeDriver(state, 102, b, [b, c], c);
    const [follower, ...blockers] = state.vehicles;
    const xBefore = follower.x;
    const freeze = () => {
      for (const blocker of blockers) {
        blocker.x = (b % SIZE) + 0.5;
        blocker.pathIndex = 0;
        blocker.phase = VehiclePhase.ToWork;
      }
    };
    // One tick to reach the edge of a, then maxWaitTicks ticks of waiting.
    for (let i = 0; i < BALANCE.vehicles.maxWaitTicks + 1; i++) {
      vehiclesStep(state);
      freeze();
    }
    expect(follower.x).toBeGreaterThan(xBefore);
    expect(follower.x).toBeLessThan(4);
    vehiclesStep(state);
    expect(follower.x).toBeGreaterThanOrEqual(4); // squeezed into b
  });
});

describe('commute congestion metric', () => {
  it('stays near 1 with free-flowing traffic', () => {
    const state = commuterTown(5, 120);
    setHour(state, 6);
    runDays(state, 1);
    expect(state.commuteCongestion).toBeGreaterThan(0.8);
    expect(state.commuteCongestion).toBeLessThan(1.3);
  });

  it('rises when a bottleneck jams the commute', () => {
    const state = createSimState(2, SIZE);
    buildRoads(
      state,
      Array.from({ length: 14 }, (_, x) => at(x + 3, 10)),
    );
    for (let i = 0; i < 8; i++) {
      state.layers.zone[at(3 + i, 9)] = Zone.Residential;
      state.layers.density[at(3 + i, 9)] = 3;
    }
    state.layers.zone[at(16, 9)] = Zone.Commercial;
    state.layers.density[at(16, 9)] = 3;
    setHour(state, 6);
    vehiclesStep(state);
    for (const v of state.vehicles) v.departureOffset = 0; // rush together
    runDays(state, 1);
    const jammed = state.commuteCongestion;

    const calm = commuterTown(2, 120);
    setHour(calm, 6);
    runDays(calm, 1);
    expect(jammed).toBeGreaterThan(calm.commuteCongestion);
  });
});
