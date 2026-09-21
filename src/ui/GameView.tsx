import { useEffect, useRef, useState } from 'react';
import { GameRenderer, type RendererCallbacks } from '../render/renderer.ts';
import { useI18n } from './i18n.tsx';
import type { SimBridge } from './useSimBridge.ts';

/**
 * Mounts the three.js renderer into the React tree and wires it to the
 * simulation bridge. The renderer lives outside React's render cycle.
 */
export function GameView({
  bridge,
  gridSize,
  callbacksRef,
  rendererRef,
}: {
  bridge: SimBridge;
  gridSize: number;
  /** Mutable callbacks so tools can change without remounting the canvas. */
  callbacksRef: React.RefObject<RendererCallbacks>;
  rendererRef: React.RefObject<GameRenderer | null>;
}) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [webglError, setWebglError] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let renderer: GameRenderer;
    try {
      renderer = createRenderer(container);
    } catch (error) {
      // Headless/old environments without WebGL: the simulation and HUD
      // still work, only the 3D view is unavailable.
      console.warn('WebGL unavailable, running without 3D view', error);
      setWebglError(true);
      return;
    }
    rendererRef.current = renderer;

    const unsubscribeDiffs = bridge.onDiffs((diffs) => renderer.applyDiffs(diffs));
    const unsubscribeVehicles = bridge.onVehicles((vehicles) => renderer.setVehicles(vehicles));

    return () => {
      unsubscribeDiffs();
      unsubscribeVehicles();
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function createRenderer(container: HTMLElement): GameRenderer {
    return new GameRenderer(container, gridSize, {
      onHover: (tile) => callbacksRef.current.onHover?.(tile),
      onBuildStart: (tile) => callbacksRef.current.onBuildStart?.(tile),
      onBuildDrag: (tile) => callbacksRef.current.onBuildDrag?.(tile),
      onBuildEnd: (tile) => callbacksRef.current.onBuildEnd?.(tile),
    });
  }

  return (
    <div ref={containerRef} className="game-view" data-testid="game-view">
      {webglError && (
        <div className="webgl-fallback" data-testid="webgl-fallback">
          {t('webgl.fallback')}
        </div>
      )}
    </div>
  );
}
