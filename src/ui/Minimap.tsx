import { useEffect, useRef } from 'react';
import type { GameRenderer } from '../render/renderer.ts';

const CANVAS_SIZE = 144;
const REDRAW_MS = 400;

/**
 * Minimap: a live one-pixel-per-tile view of the city; clicking moves
 * the camera there. Redraws when the city or the camera target changes.
 */
export function Minimap({
  rendererRef,
  gridSize,
}: {
  rendererRef: React.RefObject<GameRenderer | null>;
  gridSize: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let lastVersion = -1;
    let lastTargetKey = '';
    const timer = setInterval(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      const target = renderer.getCameraTarget();
      const targetKey = `${target.x.toFixed(1)},${target.z.toFixed(1)}`;
      if (renderer.minimap.version === lastVersion && targetKey === lastTargetKey) {
        return;
      }
      lastVersion = renderer.minimap.version;
      lastTargetKey = targetKey;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(renderer.minimap.canvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      // Camera target marker
      const scale = CANVAS_SIZE / gridSize;
      ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
      ctx.lineWidth = 1.5;
      ctx.strokeRect(target.x * scale - 8, target.z * scale - 8, 16, 16);
    }, REDRAW_MS);
    return () => clearInterval(timer);
  }, [rendererRef, gridSize]);

  const handleClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const renderer = rendererRef.current;
    const canvas = canvasRef.current;
    if (!renderer || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * gridSize;
    const z = ((e.clientY - rect.top) / rect.height) * gridSize;
    renderer.panTo(x, z);
  };

  return (
    <canvas
      ref={canvasRef}
      className="minimap"
      data-testid="minimap"
      width={CANVAS_SIZE}
      height={CANVAS_SIZE}
      onClick={handleClick}
    />
  );
}
