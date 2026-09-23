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
    let lastViewKey = '';
    const timer = setInterval(() => {
      const renderer = rendererRef.current;
      const canvas = canvasRef.current;
      if (!renderer || !canvas) return;
      // The viewfinder is the ground the camera actually shows, so it
      // shrinks and grows with the zoom and turns with the camera.
      const footprint = renderer.getViewFootprint();
      const viewKey = footprint.map((p) => `${p.x.toFixed(1)},${p.z.toFixed(1)}`).join(';');
      if (renderer.minimap.version === lastVersion && viewKey === lastViewKey) {
        return;
      }
      lastVersion = renderer.minimap.version;
      lastViewKey = viewKey;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(renderer.minimap.canvas, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
      // Viewfinder: the visible patch of ground, drawn as the polygon it
      // is (a rotated rectangle in isometric view), clipped to the map.
      if (footprint.length === 4) {
        const scale = CANVAS_SIZE / gridSize;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
        ctx.clip();
        ctx.beginPath();
        footprint.forEach((p, i) => {
          if (i === 0) ctx.moveTo(p.x * scale, p.z * scale);
          else ctx.lineTo(p.x * scale, p.z * scale);
        });
        ctx.closePath();
        ctx.strokeStyle = 'rgba(255, 209, 102, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
      }
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
