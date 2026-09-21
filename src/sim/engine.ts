import { BALANCE } from '../shared/constants.ts';
import type { SimCommand, SimEvent } from '../shared/messages.ts';
import type { VehicleState } from '../shared/types.ts';
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
      case 'paintZone':
      case 'placePlant':
      case 'bulldoze':
      case 'undo':
        return [{ type: 'rejected', reason: `not implemented: ${command.type}` }];
    }
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
