import { BALANCE } from '../shared/constants.ts';
import { PlantType } from '../shared/types.ts';
import { useI18n, type TranslationKey } from './i18n.tsx';
import type { ToolId } from './useTools.ts';

interface ToolButton {
  id: ToolId;
  icon: string;
  /** Cost display: plain number, or per-tile when perTile is set. */
  cost?: number;
  perTile?: boolean;
}

const TOOLS: ToolButton[] = [
  { id: 'select', icon: '🖐' },
  { id: 'road', icon: '🛣', cost: BALANCE.costs.roadPerTile, perTile: true },
  {
    id: 'zone-residential',
    icon: '🏠',
    cost: BALANCE.costs.zonePerTile,
    perTile: true,
  },
  {
    id: 'zone-commercial',
    icon: '🏢',
    cost: BALANCE.costs.zonePerTile,
    perTile: true,
  },
  {
    id: 'zone-retail',
    icon: '🛍',
    cost: BALANCE.costs.zonePerTile,
    perTile: true,
  },
  { id: 'plant-solar', icon: '☀️', cost: BALANCE.costs.plant[PlantType.SolarFarm] },
  { id: 'plant-wind', icon: '🌀', cost: BALANCE.costs.plant[PlantType.WindTurbine] },
  { id: 'plant-battery', icon: '🔋', cost: BALANCE.costs.plant[PlantType.Battery] },
  {
    id: 'plant-biogas',
    icon: '♻️',
    cost: BALANCE.costs.plant[PlantType.BiogasPlant],
  },
  { id: 'plant-hub', icon: '🔌', cost: BALANCE.costs.plant[PlantType.ChargingHub] },
  { id: 'bulldoze', icon: '🚜' },
];

export function Toolbar({
  tool,
  onSelectTool,
  onUndo,
}: {
  tool: ToolId;
  onSelectTool: (tool: ToolId) => void;
  onUndo: () => void;
}) {
  const { t } = useI18n();
  return (
    <nav className="toolbar" data-testid="toolbar">
      {TOOLS.map((entry) => {
        const label = t(`tool.${entry.id}` as TranslationKey);
        const cost =
          entry.cost === undefined
            ? undefined
            : entry.perTile
              ? t('tool.perTile', { cost: entry.cost })
              : String(entry.cost);
        return (
          <button
            key={entry.id}
            type="button"
            title={cost ? `${label} (${cost})` : label}
            className={`toolbar-button ${tool === entry.id ? 'active' : ''}`}
            data-testid={`tool-${entry.id}`}
            onClick={() => onSelectTool(entry.id)}
          >
            <span className="toolbar-icon">{entry.icon}</span>
            <span className="toolbar-label">{label}</span>
            {cost && <span className="toolbar-cost">{cost}</span>}
          </button>
        );
      })}
      <button
        type="button"
        className="toolbar-button"
        title={t('tool.undo.title')}
        data-testid="tool-undo"
        onClick={onUndo}
      >
        <span className="toolbar-icon">↩</span>
        <span className="toolbar-label">{t('tool.undo')}</span>
      </button>
    </nav>
  );
}
