import { useEffect, useRef, useState } from 'react';
import { OverlayMode, type SaveGame } from '../shared/types.ts';
import { IndexedDbStorage } from '../storage/indexeddb.ts';
import { OverlayToggle } from './OverlayToggle.tsx';
import type { GameRenderer, RendererCallbacks } from '../render/renderer.ts';
import type { Speed } from '../shared/types.ts';
import { Clock } from './Clock.tsx';
import { DemandBars } from './DemandBars.tsx';
import { EnergyPanel } from './EnergyPanel.tsx';
import { HelpPage } from './HelpPage.tsx';
import { ImprintPage } from './ImprintPage.tsx';
import { rejectionKey, useI18n, type Locale } from './i18n.tsx';
import { TaxSlider } from './TaxSlider.tsx';
import { GameView } from './GameView.tsx';
import { SpeedControls } from './SpeedControls.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useSimBridge } from './useSimBridge.ts';
import { useTools } from './useTools.ts';

const AUTOSAVE_INTERVAL_MS = 10_000;

const storage = new IndexedDbStorage();

function happinessEmoji(happiness: number): string {
  if (happiness >= 0.7) return '😊';
  if (happiness >= 0.45) return '😐';
  return '😞';
}

/** Loads the autosave before booting the simulation. */
export function App() {
  const { t } = useI18n();
  const [boot, setBoot] = useState<{ save: SaveGame | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    storage.load().then((save) => {
      if (!cancelled) setBoot({ save });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!boot) {
    return <div className="boot-screen">{t('boot.loading')}</div>;
  }
  return <Game save={boot.save} />;
}

function LanguageSwitch() {
  const { locale, setLocale } = useI18n();
  const options: Locale[] = ['en', 'de'];
  return (
    <span className="language-switch" data-testid="language-switch">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          className={locale === option ? 'active' : ''}
          data-testid={`language-${option}`}
          onClick={() => setLocale(option)}
        >
          {option.toUpperCase()}
        </button>
      ))}
    </span>
  );
}

function Game({ save }: { save: SaveGame | null }) {
  const { t } = useI18n();
  const bridge = useSimBridge({
    seed: save?.seed ?? Date.now() % 2147483647,
    ...(save ? { save } : {}),
  });
  const callbacksRef = useRef<RendererCallbacks>({});
  const rendererRef = useRef<GameRenderer | null>(null);
  const { tool, setTool } = useTools(bridge, callbacksRef, rendererRef);
  const [overlay, setOverlay] = useState<OverlayMode>(OverlayMode.None);
  const [page, setPage] = useState<'help' | 'imprint' | null>(null);

  const stats = bridge.stats;

  useEffect(() => {
    rendererRef.current?.setOverlayMode(overlay);
  }, [overlay]);

  // Autosave: periodically request a snapshot and persist it. The deps
  // must be the stable callbacks, NOT the bridge object — that changes
  // identity on every stats tick and would reset the interval before it
  // ever fires.
  const { send, onSaveData } = bridge;
  useEffect(() => {
    const unsubscribe = onSaveData((save) => {
      storage.save(save).catch((error) => console.warn('Autosave failed', error));
    });
    const timer = setInterval(
      () => send({ type: 'requestSave' }),
      AUTOSAVE_INTERVAL_MS,
    );
    // Quick-save on "s" (autosave covers the rest).
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 's' || e.key === 'S') send({ type: 'requestSave' });
    };
    // Best-effort save when the tab is hidden (switch, reload, close).
    const onVisibilityChange = (): void => {
      if (document.visibilityState === 'hidden') send({ type: 'requestSave' });
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [send, onSaveData]);

  const startNewGame = async (): Promise<void> => {
    if (!window.confirm(t('newCity.confirm'))) {
      return;
    }
    await storage.clear();
    window.location.reload();
  };

  useEffect(() => {
    if (stats) rendererRef.current?.setStats(stats);
  }, [stats]);

  const rejection = bridge.rejection
    ? (() => {
        const key = rejectionKey(bridge.rejection);
        return key ? t(key) : bridge.rejection;
      })()
    : null;

  return (
    <div className="app">
      <GameView bridge={bridge} callbacksRef={callbacksRef} rendererRef={rendererRef} />
      <header className="hud-top">
        <div className="hud-title">Voltopia</div>
        {stats && (
          <>
            <div className="hud-stat" data-testid="money">
              <span className="hud-stat-value">
                {Math.round(stats.money).toLocaleString('en-US')} ⌁
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
            <DemandBars demand={stats.demand} />
            <Clock timeOfDay={stats.timeOfDay} day={stats.day} />
            <div
              className="hud-weather"
              data-testid="weather"
              title={t('hud.weather.title')}
            >
              <span>☁️ {Math.round(stats.weather.cloudCover * 100)}%</span>
              <span>💨 {Math.round(stats.weather.windSpeed * 100)}%</span>
            </div>
            <SpeedControls
              speed={stats.speed as Speed}
              onChange={(speed) => bridge.send({ type: 'setSpeed', speed })}
            />
            <div className="hud-tick" data-testid="tick-counter">
              tick {stats.tick}
            </div>
          </>
        )}
      </header>
      <Toolbar
        tool={tool}
        onSelectTool={setTool}
        onUndo={() => bridge.send({ type: 'undo' })}
      />
      {stats && (
        <div className="right-panel">
          <EnergyPanel energy={stats.energy} />
          <TaxSlider
            rate={stats.taxRate}
            onChange={(rate) => bridge.send({ type: 'setTaxRate', rate })}
          />
          <label
            className="smart-charging-toggle"
            data-testid="smart-charging"
            title={t('smartCharging.title')}
          >
            <input
              type="checkbox"
              checked={stats.smartCharging}
              onChange={(e) =>
                bridge.send({ type: 'setSmartCharging', enabled: e.target.checked })
              }
            />
            <span>{t('smartCharging.label')}</span>
          </label>
          <button
            type="button"
            className="new-game-button"
            data-testid="new-game"
            onClick={() => void startNewGame()}
          >
            {t('newCity.label')}
          </button>
        </div>
      )}
      {rejection && (
        <div className="rejection-toast" data-testid="rejection">
          {rejection}
        </div>
      )}
      <OverlayToggle mode={overlay} onChange={setOverlay} />
      <footer className="hud-footer">
        <span className="hud-footer-hint">{t('footer.hint')}</span>
        <button
          type="button"
          data-testid="open-help"
          onClick={() => setPage('help')}
        >
          {t('footer.help')}
        </button>
        <button
          type="button"
          data-testid="open-imprint"
          onClick={() => setPage('imprint')}
        >
          {t('footer.imprint')}
        </button>
        <LanguageSwitch />
      </footer>
      {page === 'help' && <HelpPage onClose={() => setPage(null)} />}
      {page === 'imprint' && <ImprintPage onClose={() => setPage(null)} />}
    </div>
  );
}
