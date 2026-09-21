import { useEffect, useState } from 'react';
import type { GlobalStats } from '../shared/types.ts';
import { useI18n } from './i18n.tsx';

function winShownKey(seed: number): string {
  return `voltopia.winShown.${seed}`;
}

/**
 * Celebration overlay shown once per city when every goal is achieved.
 */
export function WinScreen({
  stats,
  onCelebrate,
}: {
  stats: GlobalStats;
  /** Called when the screen appears (e.g. to play a fanfare). */
  onCelebrate?: () => void;
}) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  const allDone = stats.goals.length > 0 && stats.goals.every((g) => g.achieved);

  useEffect(() => {
    if (!allDone || visible) return;
    try {
      if (localStorage.getItem(winShownKey(stats.seed)) === '1') return;
      localStorage.setItem(winShownKey(stats.seed), '1');
    } catch {
      // storage unavailable: still celebrate, just maybe twice
    }
    setVisible(true);
    onCelebrate?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allDone, stats.seed]);

  if (!visible) return null;

  return (
    <div className="win-backdrop" data-testid="win-screen">
      <div className="win-card">
        <div className="win-emoji">🏆⚡🎉</div>
        <h2>{t('win.title')}</h2>
        <p>{t('win.body')}</p>
        <p className="win-stats">
          {t('hud.residents')}: <strong>{stats.population}</strong> ·{' '}
          {t('hud.day', { n: stats.day + 1 })} · {t('hud.happiness')}:{' '}
          <strong>{Math.round(stats.happiness * 100)}%</strong>
        </p>
        <button
          type="button"
          className="primary"
          data-testid="win-continue"
          onClick={() => setVisible(false)}
        >
          {t('win.continue')}
        </button>
      </div>
    </div>
  );
}
