/**
 * Top-left HUD plate: the city at a glance — funds, residents, jobs,
 * happiness and zone demand. Docked into the top-left corner like the
 * resource bar of an RTS, so it reads as part of the frame, not a card.
 */
import { BALANCE } from '../shared/constants.ts';
import type { GlobalStats } from '../shared/types.ts';
import { DemandBars } from './DemandBars.tsx';
import { useI18n, type TranslationKey } from './i18n.tsx';

const CURRENCY = '⌁';

function happinessEmoji(happiness: number): string {
  if (happiness >= 0.7) return '😊';
  if (happiness >= 0.45) return '😐';
  return '😞';
}

function trafficLabel(congestion: number): TranslationKey {
  if (congestion <= BALANCE.traffic.flowing) return 'traffic.flowing';
  if (congestion <= BALANCE.traffic.jammed) return 'traffic.slow';
  return 'traffic.jammed';
}

export function CityVitals({ stats }: { stats: GlobalStats }) {
  const { t } = useI18n();
  return (
    <div className="hud-plate hud-vitals hud-row" data-testid="hud-vitals">
      <div className="hud-title">Voltopia</div>
      <div className="hud-stat hud-stat-wide" data-testid="money">
        <span className="hud-stat-value">
          {Math.round(stats.money).toLocaleString('en-US')} {CURRENCY}
        </span>
        <span className="hud-stat-label">{t('hud.funds')}</span>
      </div>
      <div className="hud-stat" data-testid="population">
        <span className="hud-stat-value">{stats.population}</span>
        <span className="hud-stat-label">{t('hud.residents')}</span>
      </div>
      <div className="hud-stat" data-testid="jobs">
        <span className="hud-stat-value">{stats.jobs}</span>
        <span className="hud-stat-label">{t('hud.jobs')}</span>
      </div>
      <div className="hud-stat" data-testid="happiness">
        <span className="hud-stat-value">
          {happinessEmoji(stats.happiness)} {Math.round(stats.happiness * 100)}%
        </span>
        <span className="hud-stat-label">{t('hud.happiness')}</span>
      </div>
      <div
        className={`hud-stat ${stats.traffic.congestion > BALANCE.traffic.jammed ? 'negative' : ''}`}
        data-testid="traffic"
        title={`${t('hud.traffic')}: ${t(trafficLabel(stats.traffic.congestion))}`}
      >
        <span className="hud-stat-value">🚗 {stats.traffic.congestion.toFixed(2)}×</span>
        <span className="hud-stat-label">{t('hud.traffic')}</span>
      </div>
      <DemandBars demand={stats.demand} />
    </div>
  );
}
