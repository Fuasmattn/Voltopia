import { OverlayMode } from '../shared/types.ts';

const MODES: Array<{ mode: OverlayMode; label: string; title: string }> = [
  { mode: OverlayMode.None, label: 'Off', title: 'No overlay' },
  {
    mode: OverlayMode.Supply,
    label: 'Supply',
    title: 'Supply status: green = supplied, orange = undersupplied, red = not connected',
  },
  {
    mode: OverlayMode.Demand,
    label: 'Demand',
    title: 'Growth demand per zone: red = none, green = high',
  },
];

export function OverlayToggle({
  mode,
  onChange,
}: {
  mode: OverlayMode;
  onChange: (mode: OverlayMode) => void;
}) {
  return (
    <div className="overlay-toggle" data-testid="overlay-toggle">
      <span className="overlay-toggle-label">Overlay</span>
      {MODES.map((entry) => (
        <button
          key={entry.mode}
          type="button"
          title={entry.title}
          className={mode === entry.mode ? 'active' : ''}
          data-testid={`overlay-${entry.label.toLowerCase()}`}
          onClick={() => onChange(entry.mode)}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
