import { useI18n } from './i18n.tsx';

/** Formats the in-game time of day (0..1) as HH:MM. */
export function formatTimeOfDay(timeOfDay: number): string {
  const totalMinutes = Math.floor(timeOfDay * 24 * 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function Clock({ timeOfDay, day }: { timeOfDay: number; day: number }) {
  const { t } = useI18n();
  return (
    <div className="hud-clock" data-testid="clock">
      <span className="hud-clock-time" data-testid="clock-time">
        {formatTimeOfDay(timeOfDay)}
      </span>
      <span className="hud-clock-day">{t('hud.day', { n: day + 1 })}</span>
    </div>
  );
}
