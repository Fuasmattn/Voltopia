/**
 * Top-right HUD plate: clock, weather, simulation speed and the way out
 * to a new city. Docked into the top-right corner, opposite the vitals.
 */
import { BALANCE } from '../shared/constants.ts';
import type { GlobalStats, SeasonId, Speed } from '../shared/types.ts';
import { Clock } from './Clock.tsx';
import { useI18n, type TranslationKey } from './i18n.tsx';
import { SpeedControls } from './SpeedControls.tsx';

const SEASON_GLYPH: Record<SeasonId, string> = {
  spring: '🌸',
  summer: '☀️',
  autumn: '🍂',
  winter: '❄️',
};

export function TimeControls({
  stats,
  onSetSpeed,
  onNewGame,
}: {
  stats: GlobalStats;
  onSetSpeed: (speed: Speed) => void;
  onNewGame: () => void;
}) {
  const { t } = useI18n();
  return (
    <div className="hud-plate hud-controls hud-row" data-testid="hud-controls">
      <Clock timeOfDay={stats.timeOfDay} day={stats.day} />
      <div className="hud-weather" data-testid="weather" title={t('hud.weather.title')}>
        <span data-testid="season">
          {SEASON_GLYPH[stats.season.season]}{' '}
          {t('hud.season', {
            season: t(`season.${stats.season.season}` as TranslationKey),
            day: stats.season.dayOfSeason,
            days: BALANCE.seasons.daysPerSeason,
            temperature: Math.round(stats.season.temperature),
          })}
        </span>
        <span>☁️ {Math.round(stats.weather.cloudCover * 100)}%</span>
        <span>💨 {Math.round(stats.weather.windSpeed * 100)}%</span>
      </div>
      <SpeedControls speed={stats.speed as Speed} onChange={onSetSpeed} />
      <button type="button" className="new-game-button" data-testid="new-game" onClick={onNewGame}>
        {t('newCity.label')}
      </button>
    </div>
  );
}
