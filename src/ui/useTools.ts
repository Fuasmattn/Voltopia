import { useCallback, useEffect, useState } from 'react';
import type { GameRenderer, PickedTile, RendererCallbacks } from '../render/renderer.ts';
import { lShapedPath, rectTiles } from '../shared/grid.ts';
import { BALANCE } from '../shared/constants.ts';
import { PlantType, Terrain, Zone } from '../shared/types.ts';
import { sound } from './sound.ts';
import type { SimBridge } from './useSimBridge.ts';

export type ToolId =
  | 'select'
  | 'road'
  | 'power-line'
  | 'zone-residential'
  | 'zone-commercial'
  | 'zone-retail'
  | 'plant-solar'
  | 'plant-wind'
  | 'plant-battery'
  | 'plant-biogas'
  | 'plant-hub'
  | 'plant-park'
  | 'plant-hydro'
  | 'plant-pumped'
  | 'bulldoze';

const ZONE_BY_TOOL: Partial<Record<ToolId, Zone>> = {
  'zone-residential': Zone.Residential,
  'zone-commercial': Zone.Commercial,
  'zone-retail': Zone.Retail,
};

/** Keyboard shortcuts for tools (digits row plus B, P, H, U and L). */
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
  h: 'plant-hydro',
  u: 'plant-pumped',
  l: 'power-line',
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
  'plant-hydro': PlantType.RunOfRiver,
  'plant-pumped': PlantType.PumpedStorage,
};

/**
 * Wires the active tool to renderer pointer callbacks: road and power line
 * drags preview an L-shaped path and commit on release, the bulldozer
 * clears while dragging.
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
  /** Tile clicked with the select tool, null when none. */
  selectedTile: number | null;
  clearSelectedTile: () => void;
} {
  const [tool, setTool] = useState<ToolId>('select');
  const [selectedTile, setSelectedTile] = useState<number | null>(null);
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

    // Mirrors the sim's per-tile pricing (src/sim/roads.ts, powerLines.ts):
    // river tiles are bridges; lines over river or lake are crossings.
    // Falls back to the land price when the renderer isn't mounted yet.
    const showPathCost = (tiles: number[], line: boolean): void => {
      const renderer = rendererRef.current;
      const cost = tiles.reduce((sum, index) => {
        const terrain = renderer?.terrainAt(index);
        if (line) {
          const water = terrain !== undefined && terrain !== Terrain.Land;
          return (
            sum + (water ? BALANCE.costs.powerLineWaterPerTile : BALANCE.costs.powerLinePerTile)
          );
        }
        return (
          sum +
          (terrain === Terrain.River ? BALANCE.costs.bridgePerTile : BALANCE.costs.roadPerTile)
        );
      }, 0);
      setCostPreview({ tiles: tiles.length, cost });
    };

    const callbacks: RendererCallbacks = {};
    if (tool === 'select') {
      // Clicking with the select tool inspects the tile.
      callbacks.onBuildStart = (tile) => setSelectedTile(tile.index);
    } else if (tool === 'road' || tool === 'power-line') {
      const line = tool === 'power-line';
      callbacks.onBuildStart = (tile) => {
        anchor = tile;
        path = [tile.index];
        rendererRef.current?.setPreviewTiles(path);
        showPathCost(path, line);
      };
      callbacks.onBuildDrag = (tile) => {
        if (!anchor) return;
        path = lShapedPath(anchor.x, anchor.y, tile.x, tile.y, gridSize);
        rendererRef.current?.setPreviewTiles(path);
        showPathCost(path, line);
      };
      callbacks.onBuildEnd = (tile) => {
        if (anchor && tile) {
          path = lShapedPath(anchor.x, anchor.y, tile.x, tile.y, gridSize);
        }
        if (path.length > 0) {
          send({ type: line ? 'buildPowerLine' : 'buildRoad', tiles: path });
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
      // Show the relevant radius while placing: the connection radius for
      // supply plants, the happiness radius for parks, the service radius
      // for hubs.
      if (plant === PlantType.Park) {
        renderer?.setHoverRadius(BALANCE.happiness.parkRadius);
      } else if (plant === PlantType.ChargingHub) {
        renderer?.setHoverRadius(BALANCE.vehicles.hubRadius);
      } else {
        renderer?.setHoverRadius(BALANCE.energy.lineSupplyRadius);
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
      // Escape backs out of whatever is in hand: the build tool and the
      // inspected tile (which closes the inspector).
      if (e.key === 'Escape') {
        setTool('select');
        setSelectedTile(null);
        return;
      }
      const mapped = TOOL_HOTKEYS[e.key.toLowerCase()];
      if (mapped) setTool(mapped);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Keep the worker's inspected tile and the world highlight in sync
  // with the click.
  useEffect(() => {
    send({ type: 'inspectTile', tile: selectedTile });
    rendererRef.current?.setSelectedTile(selectedTile);
  }, [selectedTile, send, rendererRef]);

  const clearSelectedTile = useCallback(() => setSelectedTile(null), []);

  return { tool, setTool, costPreview, selectedTile, clearSelectedTile };
}
