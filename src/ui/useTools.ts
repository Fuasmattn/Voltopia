import { useEffect, useState } from 'react';
import type { GameRenderer, PickedTile, RendererCallbacks } from '../render/renderer.ts';
import { lShapedPath, rectTiles } from '../shared/grid.ts';
import { GRID_SIZE } from '../shared/constants.ts';
import { Zone } from '../shared/types.ts';
import type { SimBridge } from './useSimBridge.ts';

export type ToolId =
  | 'select'
  | 'road'
  | 'zone-residential'
  | 'zone-commercial'
  | 'zone-retail'
  | 'bulldoze';

const ZONE_BY_TOOL: Partial<Record<ToolId, Zone>> = {
  'zone-residential': Zone.Residential,
  'zone-commercial': Zone.Commercial,
  'zone-retail': Zone.Retail,
};

/**
 * Wires the active tool to renderer pointer callbacks: road drags preview
 * an L-shaped path and commit on release, the bulldozer clears while
 * dragging.
 */
export function useTools(
  bridge: SimBridge,
  callbacksRef: React.RefObject<RendererCallbacks>,
  rendererRef: React.RefObject<GameRenderer | null>,
): { tool: ToolId; setTool: (tool: ToolId) => void } {
  const [tool, setTool] = useState<ToolId>('select');

  useEffect(() => {
    const renderer = rendererRef.current;
    renderer?.showBuildGrid(tool !== 'select');

    let anchor: PickedTile | null = null;
    let path: number[] = [];

    const clearPreview = (): void => {
      path = [];
      anchor = null;
      rendererRef.current?.setPreviewTiles([]);
    };

    const callbacks: RendererCallbacks = {};
    if (tool === 'road') {
      callbacks.onBuildStart = (tile) => {
        anchor = tile;
        path = [tile.index];
        rendererRef.current?.setPreviewTiles(path);
      };
      callbacks.onBuildDrag = (tile) => {
        if (!anchor) return;
        path = lShapedPath(anchor.x, anchor.y, tile.x, tile.y, GRID_SIZE);
        rendererRef.current?.setPreviewTiles(path);
      };
      callbacks.onBuildEnd = (tile) => {
        if (anchor && tile) {
          path = lShapedPath(anchor.x, anchor.y, tile.x, tile.y, GRID_SIZE);
        }
        if (path.length > 0) bridge.send({ type: 'buildRoad', tiles: path });
        clearPreview();
      };
    } else if (ZONE_BY_TOOL[tool] !== undefined) {
      const zone = ZONE_BY_TOOL[tool]!;
      callbacks.onBuildStart = (tile) => {
        anchor = tile;
        path = [tile.index];
        rendererRef.current?.setPreviewTiles(path);
      };
      callbacks.onBuildDrag = (tile) => {
        if (!anchor) return;
        path = rectTiles(anchor.x, anchor.y, tile.x, tile.y, GRID_SIZE);
        rendererRef.current?.setPreviewTiles(path);
      };
      callbacks.onBuildEnd = (tile) => {
        if (anchor && tile) {
          path = rectTiles(anchor.x, anchor.y, tile.x, tile.y, GRID_SIZE);
        }
        if (path.length > 0) bridge.send({ type: 'paintZone', tiles: path, zone });
        clearPreview();
      };
    } else if (tool === 'bulldoze') {
      callbacks.onBuildStart = (tile) =>
        bridge.send({ type: 'bulldoze', tiles: [tile.index] });
      callbacks.onBuildDrag = (tile) =>
        bridge.send({ type: 'bulldoze', tiles: [tile.index] });
    }

    callbacksRef.current = callbacks;
    return clearPreview;
  }, [tool, bridge, callbacksRef, rendererRef]);

  return { tool, setTool };
}
