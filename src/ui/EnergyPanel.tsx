import type { EnergyStats } from '../shared/types.ts';

const GRAPH_WIDTH = 220;
const GRAPH_HEIGHT = 64;

/** Polyline points for one metric over the history samples. */
function polyline(
  values: number[],
  maxValue: number,
): string {
  if (values.length < 2) return '';
  const stepX = GRAPH_WIDTH / (values.length - 1);
  return values
    .map((value, i) => {
      const y = GRAPH_HEIGHT - (Math.min(value, maxValue) / maxValue) * (GRAPH_HEIGHT - 4) - 2;
      return `${(i * stepX).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function formatEnergy(value: number): string {
  return value.toFixed(1);
}

/**
 * Energy panel: per-source generation, consumption, storage state of
 * charge, curtailment/deficit, and a mini graph of the last in-game day.
 */
export function EnergyPanel({ energy }: { energy: EnergyStats }) {
  const totalGeneration =
    energy.generation.solar +
    energy.generation.wind +
    energy.generation.biogas +
    energy.generation.rooftop;
  const totalConsumption =
    energy.consumption.buildings + energy.consumption.charging;
  const balance = totalGeneration - totalConsumption;
  const stateOfCharge =
    energy.storageCapacity > 0 ? energy.storedEnergy / energy.storageCapacity : 0;

  const generationSeries = energy.history.map((p) => p.generation);
  const consumptionSeries = energy.history.map((p) => p.consumption);
  const graphMax = Math.max(1, ...generationSeries, ...consumptionSeries) * 1.1;

  return (
    <aside className="energy-panel" data-testid="energy-panel">
      <h2>Energy</h2>
      <div className="energy-rows">
        <div className="energy-row" data-testid="energy-solar">
          <span>☀️ Solar</span>
          <span>{formatEnergy(energy.generation.solar)}</span>
        </div>
        <div className="energy-row" data-testid="energy-wind">
          <span>🌀 Wind</span>
          <span>{formatEnergy(energy.generation.wind)}</span>
        </div>
        <div className="energy-row" data-testid="energy-biogas">
          <span>♻️ Biogas</span>
          <span>{formatEnergy(energy.generation.biogas)}</span>
        </div>
        {energy.generation.rooftop > 0.05 && (
          <div className="energy-row" data-testid="energy-rooftop">
            <span>🏠 Rooftop PV</span>
            <span>{formatEnergy(energy.generation.rooftop)}</span>
          </div>
        )}
        <div className="energy-row" data-testid="energy-consumption">
          <span>🏙 Consumption</span>
          <span>{formatEnergy(totalConsumption)}</span>
        </div>
        <div className="energy-row" data-testid="energy-charging">
          <span>🔌 EV charging</span>
          <span>{formatEnergy(energy.consumption.charging)}</span>
        </div>
        <div
          className={`energy-row balance ${balance >= 0 ? 'positive' : 'negative'}`}
          data-testid="energy-balance"
        >
          <span>{balance >= 0 ? 'Surplus' : 'Deficit'}</span>
          <span>{formatEnergy(Math.abs(balance))}</span>
        </div>
        {energy.curtailment > 0.05 && (
          <div className="energy-row muted" data-testid="energy-curtailment">
            <span>Curtailed</span>
            <span>{formatEnergy(energy.curtailment)}</span>
          </div>
        )}
      </div>

      <div className="soc-block" data-testid="energy-soc">
        <div className="soc-label">
          <span>Storage (SoC)</span>
          <span>
            {energy.storageCapacity > 0
              ? `${Math.round(stateOfCharge * 100)}%`
              : '—'}
          </span>
        </div>
        <div className="soc-track">
          <div className="soc-fill" style={{ width: `${stateOfCharge * 100}%` }} />
        </div>
      </div>

      <svg
        className="energy-graph"
        viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`}
        role="img"
        aria-label="Generation and consumption over the last day"
      >
        <polyline
          points={polyline(consumptionSeries, graphMax)}
          fill="none"
          stroke="#e0788a"
          strokeWidth="1.5"
        />
        <polyline
          points={polyline(generationSeries, graphMax)}
          fill="none"
          stroke="#7be07f"
          strokeWidth="1.5"
        />
      </svg>
      <div className="energy-legend">
        <span className="legend-generation">generation</span>
        <span className="legend-consumption">consumption</span>
      </div>
    </aside>
  );
}
