/** Core enums and data shapes shared between simulation, rendering and UI. */

export const TileType = {
  Empty: 0,
  Road: 1,
  Plant: 2,
} as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

/** Immutable ground type per tile, generated once per map. */
export const Terrain = {
  Land: 0,
  River: 1,
  Lake: 2,
} as const;
export type Terrain = (typeof Terrain)[keyof typeof Terrain];

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
  Park: 6,
  RunOfRiver: 7,
  PumpedStorage: 8,
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
  /** 0 = dry riverbed, 1 = river in full flow. Drives run-of-river output. */
  riverFlow: number;
  /** 0 = bare ground, 1 = full snow cover. Fed by sub-zero precipitation, melts into the river. */
  snowpack: number;
}

/** Seasons in year order; the year starts with the first spring day. */
export const SEASON_ORDER = ['spring', 'summer', 'autumn', 'winter'] as const;
export type SeasonId = (typeof SEASON_ORDER)[number];

/** Deterministic seasonal signal for one tick (no random component). */
export interface SeasonState {
  /** 0..1 through the year, 0 = first spring day, continuous within a day. */
  phase: number;
  season: SeasonId;
  /** 1..daysPerSeason */
  dayOfSeason: number;
  /** 1-based year counter. */
  year: number;
  /** Air temperature in °C incl. diurnal cycle and cloud damping. */
  temperature: number;
  /** Sunrise/sunset as fractions of the day (season-dependent day length). */
  sunrise: number;
  sunset: number;
  /** 0..1 sun elevation factor: 1 at the longest day. */
  solarStrength: number;
  /** Added to the weather-front base means (winter: more cloud and wind). */
  cloudBias: number;
  windBias: number;
}

export interface EnergyHistoryPoint {
  /** Total generation in energy units per tick. */
  generation: number;
  /** Total consumption in energy units per tick. */
  consumption: number;
  /** Combined state of charge of batteries and pumped storage, 0..1. */
  stateOfCharge: number;
}

export interface EnergyStats {
  generation: { solar: number; wind: number; biogas: number; rooftop: number; hydro: number };
  consumption: { buildings: number; charging: number; heating: number; cooling: number };
  /** Absolute stored energy across all batteries. */
  storedEnergy: number;
  /** Total installed battery capacity. */
  storageCapacity: number;
  /** Energy stored in pumped storage plants (second pool). */
  pumpedStoredEnergy: number;
  /** Installed pumped storage capacity. */
  pumpedCapacity: number;
  /** Dispatchable biogas output available per tick (0 without a plant). */
  biogasCapacity: number;
  /** Generation that had to be curtailed this tick (storage full, no demand). */
  curtailment: number;
  /** Consumption that could not be served this tick. */
  deficit: number;
  /** Energy bought from the transmission link this tick (expensive). */
  gridImport: number;
  /** Surplus sold to the transmission link this tick. */
  gridExport: number;
  /** Sampled history of the last in-game day, oldest first. */
  history: EnergyHistoryPoint[];
}

/** One per in-game day: averages/totals for the lifetime statistics. */
export interface LifetimeSample {
  day: number;
  population: number;
  jobs: number;
  /** 0..1 */
  happiness: number;
  /** Average energy generation per tick over the day. */
  avgGeneration: number;
  /** Average consumption per tick over the day. */
  avgConsumption: number;
  money: number;
  /** Daily mean air temperature in °C (absent in samples from before seasons). */
  temperature?: number;
  /** Average heating consumption per tick over the day (absent in older samples). */
  heating?: number;
  /** Average cooling consumption per tick over the day (absent in older samples). */
  cooling?: number;
}

export interface GoalState {
  id: string;
  achieved: boolean;
}

/** Rough tile counts for the HUD and the tutorial. */
export interface TileCounts {
  roadTiles: number;
  zonedTiles: number;
  plantTiles: number;
  buildingTiles: number;
  powerLineTiles: number;
}

export interface DemandStats {
  residential: number;
  commercial: number;
  retail: number;
}

export interface GlobalStats {
  /** World seed (identifies the city, e.g. for per-city UI flags). */
  seed: number;
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
  season: SeasonState;
  energy: EnergyStats;
  /** Current tax rate, 0..MAX_TAX_RATE. */
  taxRate: number;
  speed: Speed;
  /** Whether smart charging (charging follows surplus) is enabled. */
  smartCharging: boolean;
  /** Whether the building insulation upgrade has been bought. */
  insulation: boolean;
  goals: GoalState[];
  counts: TileCounts;
}

/** Per-tile fields the renderer needs; sent as diffs for changed tiles only. */
export interface TileDiff {
  index: number;
  tileType: TileType;
  /** 4-bit connection mask for roads (N=1, E=2, S=4, W=8). */
  roadMask: number;
  /** Power line mask: 0 = none, else LINE_PRESENT | connection bits (N=1, E=2, S=4, W=8). */
  powerLine: number;
  zone: Zone;
  /** 0 = no building, 1..3 = density level. */
  density: number;
  /** Seeded per-tile variation for procedural building shapes. */
  variant: number;
  supplied: SupplyStatus;
  plantType: PlantType;
  terrain: Terrain;
}

/** Position and heading of one vehicle, interpolated by the renderer. */
export interface VehicleState {
  /** Stable id so the renderer can track vehicles across updates. */
  id: number;
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
  /** Achieved goal ids (absent in older saves). */
  goals?: string[];
  /** Daily lifetime statistics (absent in older saves). */
  lifetime?: LifetimeSample[];
  /** River flow 0..1 (absent in older saves → dry baseline). */
  riverFlow?: number;
  /** Energy stored in pumped storage plants (absent in older saves). */
  pumpedStorageEnergy?: number;
  /** Day number on which year 1 started (absent in older saves → the save's current day). */
  seasonOriginDay?: number;
  /** Snow cover 0..1 (absent in older saves → 0). */
  snowpack?: number;
  /** Building insulation bought (absent in older saves → false). */
  insulation?: boolean;
  /** Consecutive deficit-free winter ticks so far (absent in older saves → 0). */
  winterTicks?: number;
  /** Raw copies of the tile layers. */
  layers: {
    tileType: ArrayBuffer;
    roadMask: ArrayBuffer;
    zone: ArrayBuffer;
    density: ArrayBuffer;
    variant: ArrayBuffer;
    supplied: ArrayBuffer;
    plantType: ArrayBuffer;
    /** Terrain layer; absent in older saves (all land). */
    terrain?: ArrayBuffer;
    /** Power line layer; absent in saves from before power lines. */
    powerLine?: ArrayBuffer;
  };
}
