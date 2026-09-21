import { useEffect, useRef } from 'react';
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

const DEFAULT_SEED = 20260921;

function happinessEmoji(happiness: number): string {
  if (happiness >= 0.7) return '😊';
  if (happiness >= 0.45) return '😐';
  return '😞';
}

export function App() {
  const bridge = useSimBridge({ seed: DEFAULT_SEED });
  const callbacksRef = useRef<RendererCallbacks>({});
  const rendererRef = useRef<GameRenderer | null>(null);
  const { tool, setTool } = useTools(bridge, callbacksRef, rendererRef);

  const stats = bridge.stats;

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
        </div>
      )}
      {bridge.rejection && (
        <div className="rejection-toast" data-testid="rejection">
          {bridge.rejection}
        </div>
      )}
      <footer className="hud-help">
        drag right mouse: pan · wheel: zoom · Q/E: rotate
      </footer>
    </div>
  );
}
