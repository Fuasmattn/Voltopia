/**
 * Condensed energy row of the HUD console: one icon plus the current value
 * per source, then consumption and the balance. It doubles as the handle
 * for the detail drawer, where the same numbers appear labelled.
 */
import type { EnergyStats } from '../shared/types.ts';
import { EnergySparkline } from './EnergyGraph.tsx';
import { useI18n } from './i18n.tsx';

function formatEnergy(value: number): string {
  return value.toFixed(1);
}

interface Chip {
  /** Matches the old panel rows, so tests and muscle memory still work. */
  testId: string;
  icon: string;
  /** Full label, shown as a native tooltip and in the drawer. */
  label: string;
  value: number;
}

export function EnergyStrip({
  energy,
  riverFlow,
  timeOfDay,
  open,
  onToggle,
}: {
  energy: EnergyStats;
  riverFlow: number;
  timeOfDay: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useI18n();

  const totalGeneration =
    energy.generation.solar +
    energy.generation.wind +
    energy.generation.biogas +
    energy.generation.rooftop +
    energy.generation.hydro;
  const totalConsumption =
    energy.consumption.buildings + energy.consumption.charging + energy.consumption.heating;
  const balance = totalGeneration - totalConsumption;

  const generation: Chip[] = [
    {
      testId: 'energy-solar',
      icon: '☀️',
      label: t('energy.solar'),
      value: energy.generation.solar,
    },
    { testId: 'energy-wind', icon: '🌀', label: t('energy.wind'), value: energy.generation.wind },
    {
      testId: 'energy-hydro',
      icon: '💧',
      label: t('energy.hydro', { flow: Math.round(riverFlow * 100) }),
      value: energy.generation.hydro,
    },
    {
      testId: 'energy-biogas',
      icon: '♻️',
      label: t('energy.biogas'),
      value: energy.generation.biogas,
    },
  ];
  if (energy.generation.rooftop > 0.05) {
    generation.push({
      testId: 'energy-rooftop',
      icon: '🏠',
      label: t('energy.rooftop'),
      value: energy.generation.rooftop,
    });
  }
  const consumption: Chip[] = [
    {
      testId: 'energy-consumption',
      icon: '🏙',
      label: t('energy.consumption'),
      value: totalConsumption,
    },
    {
      testId: 'energy-charging',
      icon: '🔌',
      label: t('energy.charging'),
      value: energy.consumption.charging,
    },
    {
      testId: 'energy-heating',
      icon: '🔥',
      label: t('energy.heating'),
      value: energy.consumption.heating,
    },
  ];

  const chip = (item: Chip) => (
    <span
      key={item.testId}
      className="energy-chip"
      data-testid={item.testId}
      // An icon alone is ambiguous with the drawer closed.
      title={`${item.label}: ${formatEnergy(item.value)}`}
    >
      <span className="energy-chip-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="energy-chip-value">{formatEnergy(item.value)}</span>
      <span className="sr-only">{item.label}</span>
    </span>
  );

  const balanceLabel = balance >= 0 ? t('energy.surplus') : t('energy.deficit');

  return (
    <div className="hud-row hud-row-energy" data-testid="energy-strip">
      {generation.map(chip)}
      <span className="energy-chip-divider" aria-hidden="true" />
      {consumption.map(chip)}
      <span
        className={`energy-chip balance ${balance >= 0 ? 'positive' : 'negative'}`}
        data-testid="energy-balance"
        title={`${balanceLabel}: ${formatEnergy(Math.abs(balance))}`}
      >
        <span className="energy-chip-icon" aria-hidden="true">
          {balance >= 0 ? '▲' : '▼'}
        </span>
        <span className="energy-chip-value">{formatEnergy(Math.abs(balance))}</span>
        <span className="sr-only">{balanceLabel}</span>
      </span>
      <EnergySparkline energy={energy} timeOfDay={timeOfDay} collapsed={open} />
      <button
        type="button"
        className="hud-details-toggle"
        data-testid="hud-details-toggle"
        aria-expanded={open}
        onClick={onToggle}
      >
        {t('hud.details')} <span aria-hidden="true">{open ? '▴' : '▾'}</span>
      </button>
    </div>
  );
}
