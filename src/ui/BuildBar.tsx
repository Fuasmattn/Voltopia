/**
 * Bottom-centre build menu: category tabs over a row of icon buttons.
 * Icons alone are unreadable, so hovering or focusing a button raises a
 * tooltip with the tool's name, cost, hotkey and a one-line description.
 */
import { useEffect, useState } from 'react';
import { BALANCE } from '../shared/constants.ts';
import { PlantType } from '../shared/types.ts';
import { useI18n, type TranslationKey } from './i18n.tsx';
import { TOOL_HOTKEYS, type ToolId } from './useTools.ts';

const HOTKEY_BY_TOOL: Partial<Record<ToolId, string>> = Object.fromEntries(
  Object.entries(TOOL_HOTKEYS).map(([key, tool]) => [tool, key.toUpperCase()]),
);

/** The undo button is not a tool, but it belongs in the basics group. */
type BuildAction = ToolId | 'undo';

interface BuildButton {
  id: BuildAction;
  icon: string;
  /** Cost display: plain number, or per-tile when perTile is set. */
  cost?: number;
  perTile?: boolean;
}

interface Category {
  id: string;
  label: TranslationKey;
  buttons: BuildButton[];
}

/** Always on screen next to the categories — panning must never be a tab away. */
const SELECT_BUTTON: BuildButton = { id: 'select', icon: '🖐' };

const CATEGORIES: Category[] = [
  {
    id: 'basics',
    label: 'build.category.basics',
    buttons: [
      { id: 'road', icon: '🛣', cost: BALANCE.costs.roadPerTile, perTile: true },
      { id: 'power-line', icon: '⚡', cost: BALANCE.costs.powerLinePerTile, perTile: true },
      { id: 'bulldoze', icon: '🚜' },
      { id: 'undo', icon: '↩' },
    ],
  },
  {
    id: 'zones',
    label: 'build.category.zones',
    buttons: [
      { id: 'zone-residential', icon: '🏠', cost: BALANCE.costs.zonePerTile, perTile: true },
      { id: 'zone-commercial', icon: '🏢', cost: BALANCE.costs.zonePerTile, perTile: true },
      { id: 'zone-retail', icon: '🛍', cost: BALANCE.costs.zonePerTile, perTile: true },
    ],
  },
  {
    id: 'energy',
    label: 'build.category.energy',
    buttons: [
      { id: 'plant-solar', icon: '☀️', cost: BALANCE.costs.plant[PlantType.SolarFarm] },
      { id: 'plant-wind', icon: '🌀', cost: BALANCE.costs.plant[PlantType.WindTurbine] },
      { id: 'plant-battery', icon: '🔋', cost: BALANCE.costs.plant[PlantType.Battery] },
      { id: 'plant-biogas', icon: '♻️', cost: BALANCE.costs.plant[PlantType.BiogasPlant] },
      { id: 'plant-hydro', icon: '💧', cost: BALANCE.costs.plant[PlantType.RunOfRiver] },
      { id: 'plant-pumped', icon: '🏔', cost: BALANCE.costs.plant[PlantType.PumpedStorage] },
    ],
  },
  {
    id: 'services',
    label: 'build.category.services',
    buttons: [
      { id: 'plant-hub', icon: '🔌', cost: BALANCE.costs.plant[PlantType.ChargingHub] },
      { id: 'plant-park', icon: '🌳', cost: BALANCE.costs.plant[PlantType.Park] },
    ],
  },
];

const CATEGORY_BY_TOOL: Partial<Record<ToolId, string>> = Object.fromEntries(
  CATEGORIES.flatMap((category) =>
    category.buttons.filter((b) => b.id !== 'undo').map((b) => [b.id, category.id]),
  ),
);

export function BuildBar({
  tool,
  onSelectTool,
  onUndo,
}: {
  tool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  onUndo: () => void;
}) {
  const { t } = useI18n();
  const [openCategory, setOpenCategory] = useState(CATEGORIES[0].id);

  // Hotkeys can select a tool from a category that is not on screen; follow
  // the selection so the active button is always visible.
  useEffect(() => {
    const category = CATEGORY_BY_TOOL[tool];
    if (category) setOpenCategory(category);
  }, [tool]);

  const active = CATEGORIES.find((category) => category.id === openCategory) ?? CATEGORIES[0];

  const renderButton = (entry: BuildButton) => {
    const label = t(`tool.${entry.id}` as TranslationKey);
    const cost =
      entry.cost === undefined
        ? undefined
        : entry.perTile
          ? t('tool.perTile', { cost: entry.cost })
          : String(entry.cost);
    const toolId = entry.id === 'undo' ? null : entry.id;
    const hotkey = toolId ? HOTKEY_BY_TOOL[toolId] : undefined;
    return (
      <button
        key={entry.id}
        type="button"
        aria-label={label}
        className={`build-button ${tool === entry.id ? 'active' : ''}`}
        data-testid={`tool-${entry.id}`}
        onClick={() => (toolId ? onSelectTool(toolId) : onUndo())}
      >
        <span className="build-icon" aria-hidden="true">
          {entry.icon}
        </span>
        {/* Kept in the DOM (not just as aria-label) so the label is
            readable by tests and screen readers alike. */}
        <span className="sr-only">{label}</span>
        <span className="build-tooltip" role="presentation">
          <span className="build-tooltip-title">
            {label}
            {hotkey && <span className="build-tooltip-key">{hotkey}</span>}
          </span>
          {cost && <span className="build-tooltip-cost">{cost} ⌁</span>}
          <span className="build-tooltip-desc">{t(`tool.${entry.id}.desc` as TranslationKey)}</span>
        </span>
      </button>
    );
  };

  return (
    <div className="build-cluster">
      <div className="hud-card build-select" data-testid="select-tool">
        {renderButton(SELECT_BUTTON)}
      </div>
      <nav className="hud-card build-bar" data-testid="toolbar">
        <div className="build-tabs" role="tablist">
          {CATEGORIES.map((category) => (
            <button
              key={category.id}
              type="button"
              role="tab"
              aria-selected={category.id === active.id}
              className={`build-tab ${category.id === active.id ? 'active' : ''}`}
              data-testid={`build-category-${category.id}`}
              onClick={() => setOpenCategory(category.id)}
            >
              {t(category.label)}
            </button>
          ))}
        </div>

        <div className="build-tools" role="tabpanel">
          {active.buttons.map(renderButton)}
        </div>
      </nav>
    </div>
  );
}
