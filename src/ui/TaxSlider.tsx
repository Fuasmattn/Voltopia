import { BALANCE } from '../shared/constants.ts';
import { useI18n } from './i18n.tsx';

export function TaxSlider({ rate, onChange }: { rate: number; onChange: (rate: number) => void }) {
  const { t } = useI18n();
  return (
    <label className="tax-slider" data-testid="tax-slider">
      <span>
        {t('tax.label')} <strong>{Math.round(rate * 100)}%</strong>
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
