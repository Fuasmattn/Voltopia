import type { Speed } from '../shared/types.ts';

const SPEEDS: Array<{ value: Speed; label: string; title: string }> = [
  { value: 0, label: '⏸', title: 'Pause' },
  { value: 1, label: '▶', title: 'Normal speed' },
  { value: 3, label: '▶▶▶', title: 'Fast (3x)' },
];

export function SpeedControls({
  speed,
  onChange,
}: {
  speed: Speed;
  onChange: (speed: Speed) => void;
}) {
  return (
    <div className="speed-controls" data-testid="speed-controls">
      {SPEEDS.map(({ value, label, title }) => (
        <button
          key={value}
          type="button"
          title={title}
          className={speed === value ? 'active' : ''}
          data-testid={`speed-${value}`}
          onClick={() => onChange(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
