import type { DemandStats } from '../shared/types.ts';

const BARS: Array<{ key: keyof DemandStats; label: string; className: string }> = [
  { key: 'residential', label: 'R', className: 'demand-residential' },
  { key: 'commercial', label: 'C', className: 'demand-commercial' },
  { key: 'retail', label: 'S', className: 'demand-retail' },
];

/** Compact R/C/S demand indicator (S = shopping/retail). */
export function DemandBars({ demand }: { demand: DemandStats }) {
  return (
    <div className="demand-bars" title="Demand: residential / commercial / retail">
      {BARS.map(({ key, label, className }) => {
        const value = demand[key];
        const height = Math.round(Math.abs(value) * 100);
        return (
          <div key={key} className="demand-bar-track" data-testid={`demand-${key}`}>
            <div
              className={`demand-bar-fill ${className} ${value < 0 ? 'negative' : ''}`}
              style={{ height: `${height}%` }}
            />
            <span className="demand-bar-label">{label}</span>
          </div>
        );
      })}
    </div>
  );
}
