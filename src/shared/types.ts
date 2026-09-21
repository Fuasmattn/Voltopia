/** Core enums and data shapes shared between simulation, rendering and UI. */

export const TileType = {
  Empty: 0,
  Road: 1,
  Plant: 2,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export const Zone = {
  None: 0,
  Residential: 1,
  Commercial: 2,
  Retail: 3,
} as const;
export type Zone = (typeof Zone)[keyof typeof Zone];

export const PlantType = {
  None: 0,
  SolarFarm: 1,
  WindTurbine: 2,
  Battery: 3,
  BiogasPlant: 4,
  ChargingHub: 5,
} as const;
export type PlantType = (typeof PlantType)[keyof typeof PlantType];

export const SupplyStatus = {
  NotConnected: 0,
  Undersupplied: 1,
  Supplied: 2,
} as const;
export type SupplyStatus = (typeof SupplyStatus)[keyof typeof SupplyStatus];

export type Speed = 0 | 1 | 3;

export const OverlayMode = {
  None: 0,
  Supply: 1,
  Demand: 2,
} as const;
export type OverlayMode = (typeof OverlayMode)[keyof typeof OverlayMode];

export interface Weather {
  /** 0 = clear sky, 1 = fully overcast. Reduces photovoltaic generation. */
  cloudCover: number;
  /** 0 = calm, 1 = strongest wind. Drives wind turbine generation. */
  windSpeed: number;
}

export interface EnergyHistoryPoint {
  /** Total generation in energy units per tick. */
  generation: number;
  /** Total consumption in energy units per tick. */
  consumption: number;
  /** Battery state of charge, 0..1 of installed capacity. */
  stateOfCharge: number;
}

export interface EnergyStats {
  generation: { solar: number; wind: number; biogas: number; rooftop: number };
  consumption: { buildings: number; charging: number };
  /** Absolute stored energy across all batteries. */
  storedEnergy: number;
  /** Total installed battery capacity. */
  storageCapacity: number;
  /** Generation that had to be curtailed this tick (storage full, no demand). */
  curtailment: number;
  /** Consumption that could not be served this tick. */
  deficit: number;
  /** Sampled history of the last in-game day, oldest first. */
  history: EnergyHistoryPoint[];
}

export interface DemandStats {
  residential: number;
  commercial: number;
  retail: number;
}

export interface GlobalStats {
  tick: number;
  money: number;
  population: number;
  jobs: number;
  /** 0..1 average citizen happiness. */
  happiness: number;
  /** Demand per zone type, -1..1 (positive = zone wants to grow). */
  demand: DemandStats;
  /** 0..1, 0 = midnight, 0.5 = noon. */
  timeOfDay: number;
  /** Day counter since city founding. */
  day: number;
  weather: Weather;
  energy: EnergyStats;
  /** Current tax rate, 0..MAX_TAX_RATE. */
  taxRate: number;
  speed: Speed;
  /** Whether smart charging (charging follows surplus) is enabled. */
  smartCharging: boolean;
}

/** Per-tile fields the renderer needs; sent as diffs for changed tiles only. */
export interface TileDiff {
  index: number;
  tileType: TileType;
  /** 4-bit connection mask for roads (N=1, E=2, S=4, W=8). */
  roadMask: number;
  zone: Zone;
  /** 0 = no building, 1..3 = density level. */
  density: number;
  /** Seeded per-tile variation for procedural building shapes. */
  variant: number;
  supplied: SupplyStatus;
  plantType: PlantType;
}

/** Position and heading of one vehicle, interpolated by the renderer. */
export interface VehicleState {
  /** Tile-space continuous position. */
  x: number;
  y: number;
  /** Heading angle in radians (0 = +x). */
  angle: number;
}

export interface SaveGame {
  version: number;
  seed: number;
  size: number;
  tick: number;
  money: number;
  taxRate: number;
  smartCharging: boolean;
  storedEnergy: number;
  /** Raw copies of the tile layers. */
  layers: {
    tileType: ArrayBuffer;
    roadMask: ArrayBuffer;
    zone: ArrayBuffer;
    density: ArrayBuffer;
    variant: ArrayBuffer;
    supplied: ArrayBuffer;
    plantType: ArrayBuffer;
  };
}
