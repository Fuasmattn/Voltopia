import { useEffect, useRef, useState } from 'react';
import type { GoalState } from '../shared/types.ts';
import { useI18n, type TranslationKey } from './i18n.tsx';

const TOAST_MS = 4000;

/**
 * City goals: a compact checklist plus a toast when a goal unlocks.
 */
export function GoalsPanel({
  goals,
  onAchievement,
}: {
  goals: GoalState[];
  /** Called once per newly achieved goal (e.g. to play a chime). */
  onAchievement?: (id: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const achievedCount = goals.filter((g) => g.achieved).length;

  useEffect(() => {
    const achievedNow = new Set(goals.filter((g) => g.achieved).map((g) => g.id));
    if (known.current) {
      for (const id of achievedNow) {
        if (!known.current.has(id)) {
          setToast(id);
          onAchievement?.(id);
          if (toastTimer.current) clearTimeout(toastTimer.current);
          toastTimer.current = setTimeout(() => setToast(null), TOAST_MS);
        }
      }
    }
    known.current = achievedNow;
  }, [goals, onAchievement]);

  return (
    <>
      <div className="goals-panel" data-testid="goals-panel">
        <button
          type="button"
          className="goals-header"
          data-testid="goals-toggle"
          onClick={() => setOpen((value) => !value)}
        >
          🏆 {t('goals.title')} {achievedCount}/{goals.length}
        </button>
        {open && (
          <ul className="goals-list">
            {goals.map((goal) => (
              <li
                key={goal.id}
                className={goal.achieved ? 'achieved' : ''}
                data-testid={`goal-${goal.id}`}
              >
                <span className="goals-check">{goal.achieved ? '✓' : '○'}</span>
                <span>
                  <strong>{t(`goal.${goal.id}.title` as TranslationKey)}</strong>
                  <br />
                  <small>{t(`goal.${goal.id}.body` as TranslationKey)}</small>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {toast && (
        <div className="goal-toast" data-testid="goal-toast">
          🏆 {t(`goal.${toast}.title` as TranslationKey)}
        </div>
      )}
    </>
  );
}
