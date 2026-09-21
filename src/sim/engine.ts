import { BALANCE } from '../shared/constants.ts';
import type { SimCommand, SimEvent } from '../shared/messages.ts';
import type { VehicleState } from '../shared/types.ts';
import { buildRoads, bulldozeTiles, undoLastAction, type BuildResult } from './roads.ts';
import { placePlant } from './energy.ts';
import { paintZones } from './zones.ts';
import {
  collectDiffs,
  createSimState,
  deserializeState,
  serializeState,
  type SimState,
} from './state.ts';
import { buildStats, stepTick } from './tick.ts';

/**
 * The engine owns the simulation state and translates commands/ticks into
 * events. It is pure logic — scheduling and postMessage live in worker.ts.
 */
export class SimEngine {
  state: SimState;

  constructor(seed: number, size: number) {
    this.state = createSimState(seed, size);
  }

  /**
   * Apply a command. Returns events to send to the main thread
   * (rejections, save data); tile changes surface via the next tick event.
   */
  applyCommand(command: SimCommand): SimEvent[] {
    const { state } = this;
    switch (command.type) {
      case 'init':
        this.state = command.save
          ? deserializeState(command.save)
          : createSimState(command.seed, command.size);
        return [];
      case 'setSpeed':
        state.speed = command.speed;
        return [];
      case 'setTaxRate':
        state.taxRate = Math.min(Math.max(command.rate, 0), BALANCE.tax.maxRate);
        return [];
      case 'setSmartCharging':
        state.smartCharging = command.enabled;
        return [];
      case 'requestSave':
        return [{ type: 'saveData', save: serializeState(state) }];
      case 'buildRoad':
        return this.toEvents(buildRoads(state, command.tiles));
      case 'bulldoze':
        return this.toEvents(bulldozeTiles(state, command.tiles));
      case 'undo':
        return this.toEvents(undoLastAction(state));
      case 'paintZone':
        return this.toEvents(paintZones(state, command.tiles, command.zone));
      case 'placePlant':
        return this.toEvents(placePlant(state, command.tile, command.plant));
    }
  }

  private toEvents(result: BuildResult): SimEvent[] {
    return result.rejected ? [{ type: 'rejected', reason: result.rejected }] : [];
  }

  /**
   * Emit pending tile changes without advancing time — used so build
   * actions are visible immediately while the game is paused.
   */
  flush(): SimEvent | null {
    if (this.state.dirty.size === 0) return null;
    return {
      type: 'tick',
      diffs: collectDiffs(this.state),
      stats: buildStats(this.state),
      vehicles: this.collectVehicles(),
    };
  }

  /** Advance one tick and produce the tick event. */
  tick(): SimEvent {
    stepTick(this.state);
    return {
      type: 'tick',
      diffs: collectDiffs(this.state),
      stats: buildStats(this.state),
      vehicles: this.collectVehicles(),
    };
  }

  private collectVehicles(): VehicleState[] {
    return this.state.vehicles.map((v) => ({ x: v.x, y: v.y, angle: v.angle }));
  }
}
