import { useEffect, useRef, useState } from 'react';
import { OverlayMode, type SaveGame } from '../shared/types.ts';
import { IndexedDbStorage } from '../storage/indexeddb.ts';
import { OverlayToggle } from './OverlayToggle.tsx';
import type { GameRenderer, RendererCallbacks } from '../render/renderer.ts';
import type { Speed } from '../shared/types.ts';
import { Clock } from './Clock.tsx';
import { DemandBars } from './DemandBars.tsx';
import { EnergyPanel } from './EnergyPanel.tsx';
import { TaxSlider } from './TaxSlider.tsx';
import { GameView } from './GameView.tsx';
import { SpeedControls } from './SpeedControls.tsx';
import { Toolbar } from './Toolbar.tsx';
import { useSimBridge } from './useSimBridge.ts';
import { useTools } from './useTools.ts';

const AUTOSAVE_INTERVAL_MS = 30_000;

const storage = new IndexedDbStorage();

function happinessEmoji(happiness: number): string {
  if (happiness >= 0.7) return '😊';
  if (happiness >= 0.45) return '😐';
  return '😞';
}

/** Loads the autosave before booting the simulation. */
export function App() {
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
    return <div className="boot-screen">Voltopia is loading…</div>;
  }
  return <Game save={boot.save} />;
}

function Game({ save }: { save: SaveGame | null }) {
  const bridge = useSimBridge({
    seed: save?.seed ?? Date.now() % 2147483647,
    ...(save ? { save } : {}),
  });
  const callbacksRef = useRef<RendererCallbacks>({});
  const rendererRef = useRef<GameRenderer | null>(null);
  const { tool, setTool } = useTools(bridge, callbacksRef, rendererRef);
  const [overlay, setOverlay] = useState<OverlayMode>(OverlayMode.None);

  const stats = bridge.stats;

  useEffect(() => {
    rendererRef.current?.setOverlayMode(overlay);
  }, [overlay]);

  // Autosave: periodically request a snapshot and persist it.
  useEffect(() => {
    const unsubscribe = bridge.onSaveData((save) => {
      storage.save(save).catch((error) => console.warn('Autosave failed', error));
    });
    const timer = setInterval(
      () => bridge.send({ type: 'requestSave' }),
      AUTOSAVE_INTERVAL_MS,
    );
    // Quick-save on "s" (autosave covers the rest).
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 's' || e.key === 'S') bridge.send({ type: 'requestSave' });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      unsubscribe();
      clearInterval(timer);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [bridge]);

  const startNewGame = async (): Promise<void> => {
    if (!window.confirm('Start a new city? The current one will be erased.')) {
      return;
    }
    await storage.clear();
    window.location.reload();
  };

  useEffect(() => {
    if (stats) rendererRef.current?.setStats(stats);
  }, [stats]);

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
              <span className="hud-stat-label">funds</span>
            </div>
            <div className="hud-stat" data-testid="population">
              <span className="hud-stat-value">{stats.population}</span>
              <span className="hud-stat-label">residents</span>
            </div>
            <div className="hud-stat" data-testid="jobs">
              <span className="hud-stat-value">{stats.jobs}</span>
              <span className="hud-stat-label">jobs</span>
            </div>
            <div className="hud-stat" data-testid="happiness">
              <span className="hud-stat-value">
                {happinessEmoji(stats.happiness)} {Math.round(stats.happiness * 100)}%
              </span>
              <span className="hud-stat-label">happiness</span>
            </div>
            <DemandBars demand={stats.demand} />
            <Clock timeOfDay={stats.timeOfDay} day={stats.day} />
            <div
              className="hud-weather"
              data-testid="weather"
              title="Cloud cover / wind speed"
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
            title="EV charging automatically follows the generation surplus"
          >
            <input
              type="checkbox"
              checked={stats.smartCharging}
              onChange={(e) =>
                bridge.send({ type: 'setSmartCharging', enabled: e.target.checked })
              }
            />
            <span>⚡ Smart charging</span>
          </label>
          <button
            type="button"
            className="new-game-button"
            data-testid="new-game"
            onClick={() => void startNewGame()}
          >
            New city
          </button>
        </div>
      )}
      {bridge.rejection && (
        <div className="rejection-toast" data-testid="rejection">
          {bridge.rejection}
        </div>
      )}
      <OverlayToggle mode={overlay} onChange={setOverlay} />
      <footer className="hud-help">
        drag right mouse: pan · wheel: zoom · Q/E: rotate
      </footer>
    </div>
  );
}
