import { BALANCE } from '../shared/constants.ts';

export function TaxSlider({
  rate,
  onChange,
}: {
  rate: number;
  onChange: (rate: number) => void;
}) {
  return (
    <label className="tax-slider" data-testid="tax-slider">
      <span>
        Tax rate <strong>{Math.round(rate * 100)}%</strong>
      </span>
      <input
        type="range"
        min={0}
        max={BALANCE.tax.maxRate * 100}
        step={1}
        value={Math.round(rate * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
      />
    </label>
  );
}
