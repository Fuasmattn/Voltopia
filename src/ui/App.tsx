import { useRef } from 'react';
import type { GameRenderer, RendererCallbacks } from '../render/renderer.ts';
import type { Speed } from '../shared/types.ts';
import { Clock } from './Clock.tsx';
import { GameView } from './GameView.tsx';
import { SpeedControls } from './SpeedControls.tsx';
import { useSimBridge } from './useSimBridge.ts';

const DEFAULT_SEED = 20260921;

export function App() {
  const bridge = useSimBridge({ seed: DEFAULT_SEED });
  const callbacksRef = useRef<RendererCallbacks>({});
  const rendererRef = useRef<GameRenderer | null>(null);

  const stats = bridge.stats;

  return (
    <div className="app">
      <GameView bridge={bridge} callbacksRef={callbacksRef} rendererRef={rendererRef} />
      <header className="hud-top">
        <div className="hud-title">Voltopia</div>
        {stats && (
          <>
            <Clock timeOfDay={stats.timeOfDay} day={stats.day} />
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
