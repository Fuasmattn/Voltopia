import { useEffect, useState } from 'react';
import type { GameRenderer, PickedTile, RendererCallbacks } from '../render/renderer.ts';
import { lShapedPath, rectTiles } from '../shared/grid.ts';
import { BALANCE } from '../shared/constants.ts';
import { PlantType, Zone } from '../shared/types.ts';
import { sound } from './sound.ts';
import type { SimBridge } from './useSimBridge.ts';

export type ToolId =
  | 'select'
  | 'road'
  | 'zone-residential'
  | 'zone-commercial'
  | 'zone-retail'
  | 'plant-solar'
  | 'plant-wind'
  | 'plant-battery'
  | 'plant-biogas'
  | 'plant-hub'
  | 'plant-park'
  | 'bulldoze';

const ZONE_BY_TOOL: Partial<Record<ToolId, Zone>> = {
  'zone-residential': Zone.Residential,
  'zone-commercial': Zone.Commercial,
  'zone-retail': Zone.Retail,
};

/** Keyboard shortcuts for tools (digits row + B for the bulldozer). */
export const TOOL_HOTKEYS: Record<string, ToolId> = {
  '1': 'select',
  '2': 'road',
  '3': 'zone-residential',
  '4': 'zone-commercial',
  '5': 'zone-retail',
  '6': 'plant-solar',
  '7': 'plant-wind',
  '8': 'plant-battery',
  '9': 'plant-biogas',
  '0': 'plant-hub',
  b: 'bulldoze',
  p: 'plant-park',
};

export interface DragCostPreview {
  tiles: number;
  cost: number;
}

export const PLANT_BY_TOOL: Partial<Record<ToolId, PlantType>> = {
  'plant-solar': PlantType.SolarFarm,
  'plant-wind': PlantType.WindTurbine,
  'plant-battery': PlantType.Battery,
  'plant-biogas': PlantType.BiogasPlant,
  'plant-hub': PlantType.ChargingHub,
  'plant-park': PlantType.Park,
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
  gridSize: number,
): {
  tool: ToolId;
  setTool: (tool: ToolId) => void;
  /** Tile count and cost of the pending drag (road/zone), else null. */
  costPreview: DragCostPreview | null;
} {
  const [tool, setTool] = useState<ToolId>('select');
  const [costPreview, setCostPreview] = useState<DragCostPreview | null>(null);
  // Depend on the stable send callback, not the bridge object — the
  // bridge changes identity on every stats tick, which would re-run this
  // effect 4x/s and reset the drag anchor mid-drag.
  const send = bridge.send;

  useEffect(() => {
    const renderer = rendererRef.current;
    renderer?.showBuildGrid(tool !== 'select');

    let anchor: PickedTile | null = null;
    let path: number[] = [];

    renderer?.setHoverRadius(0);

    const clearPreview = (): void => {
      path = [];
      anchor = null;
      rendererRef.current?.setPreviewTiles([]);
      rendererRef.current?.setHoverRadius(0);
      setCostPreview(null);
    };

    const showCost = (tileCount: number, perTile: number): void => {
      setCostPreview({ tiles: tileCount, cost: tileCount * perTile });
    };

    const callbacks: RendererCallbacks = {};
    if (tool === 'road') {
      callbacks.onBuildStart = (tile) => {
        anchor = tile;
        path = [tile.index];
        rendererRef.current?.setPreviewTiles(path);
        showCost(1, BALANCE.costs.roadPerTile);
      };
      callbacks.onBuildDrag = (tile) => {
        if (!anchor) return;
        path = lShapedPath(anchor.x, anchor.y, tile.x, tile.y, gridSize);
        rendererRef.current?.setPreviewTiles(path);
        showCost(path.length, BALANCE.costs.roadPerTile);
      };
      callbacks.onBuildEnd = (tile) => {
        if (anchor && tile) {
          path = lShapedPath(anchor.x, anchor.y, tile.x, tile.y, gridSize);
        }
        if (path.length > 0) {
          send({ type: 'buildRoad', tiles: path });
          sound.play('build');
        }
        clearPreview();
      };
    } else if (ZONE_BY_TOOL[tool] !== undefined) {
      const zone = ZONE_BY_TOOL[tool]!;
      callbacks.onBuildStart = (tile) => {
        anchor = tile;
        path = [tile.index];
        rendererRef.current?.setPreviewTiles(path);
        showCost(1, BALANCE.costs.zonePerTile);
      };
      callbacks.onBuildDrag = (tile) => {
        if (!anchor) return;
        path = rectTiles(anchor.x, anchor.y, tile.x, tile.y, gridSize);
        rendererRef.current?.setPreviewTiles(path);
        showCost(path.length, BALANCE.costs.zonePerTile);
      };
      callbacks.onBuildEnd = (tile) => {
        if (anchor && tile) {
          path = rectTiles(anchor.x, anchor.y, tile.x, tile.y, gridSize);
        }
        if (path.length > 0) {
          send({ type: 'paintZone', tiles: path, zone });
          sound.play('build');
        }
        clearPreview();
      };
    } else if (PLANT_BY_TOOL[tool] !== undefined) {
      const plant = PLANT_BY_TOOL[tool]!;
      // Show the relevant radius while placing: supply for power plants,
      // the happiness radius for parks, the service radius for hubs.
      if (plant === PlantType.Park) {
        renderer?.setHoverRadius(BALANCE.happiness.parkRadius);
      } else if (plant === PlantType.ChargingHub) {
        renderer?.setHoverRadius(BALANCE.vehicles.hubRadius);
      } else {
        renderer?.setHoverRadius(BALANCE.energy.supplyRadius);
      }
      callbacks.onBuildStart = (tile) => {
        send({ type: 'placePlant', tile: tile.index, plant });
        sound.play('build');
      };
    } else if (tool === 'bulldoze') {
      callbacks.onBuildStart = (tile) => send({ type: 'bulldoze', tiles: [tile.index] });
      callbacks.onBuildDrag = (tile) => send({ type: 'bulldoze', tiles: [tile.index] });
    }

    callbacksRef.current = callbacks;
    return clearPreview;
  }, [tool, send, callbacksRef, rendererRef, gridSize]);

  // Tool hotkeys: digits + B, Escape returns to select.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return;
      }
      if (e.key === 'Escape') {
        setTool('select');
        return;
      }
      const mapped = TOOL_HOTKEYS[e.key.toLowerCase()];
      if (mapped) setTool(mapped);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return { tool, setTool, costPreview };
}
