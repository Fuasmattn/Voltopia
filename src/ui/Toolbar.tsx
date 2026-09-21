import { BALANCE } from '../shared/constants.ts';
import { PlantType } from '../shared/types.ts';
import type { ToolId } from './useTools.ts';

interface ToolButton {
  id: ToolId;
  label: string;
  icon: string;
  cost?: string;
}

const TOOLS: ToolButton[] = [
  { id: 'select', label: 'Select / pan', icon: '🖐' },
  {
    id: 'road',
    label: 'Road',
    icon: '🛣',
    cost: `${BALANCE.costs.roadPerTile}/tile`,
  },
  {
    id: 'zone-residential',
    label: 'Residential',
    icon: '🏠',
    cost: `${BALANCE.costs.zonePerTile}/tile`,
  },
  {
    id: 'zone-commercial',
    label: 'Commercial',
    icon: '🏢',
    cost: `${BALANCE.costs.zonePerTile}/tile`,
  },
  {
    id: 'zone-retail',
    label: 'Retail',
    icon: '🛍',
    cost: `${BALANCE.costs.zonePerTile}/tile`,
  },
  {
    id: 'plant-solar',
    label: 'Solar farm',
    icon: '☀️',
    cost: `${BALANCE.costs.plant[PlantType.SolarFarm]}`,
  },
  {
    id: 'plant-wind',
    label: 'Wind turbine',
    icon: '🌀',
    cost: `${BALANCE.costs.plant[PlantType.WindTurbine]}`,
  },
  {
    id: 'plant-battery',
    label: 'Battery',
    icon: '🔋',
    cost: `${BALANCE.costs.plant[PlantType.Battery]}`,
  },
  {
    id: 'plant-biogas',
    label: 'Biogas plant',
    icon: '♻️',
    cost: `${BALANCE.costs.plant[PlantType.BiogasPlant]}`,
  },
  {
    id: 'plant-hub',
    label: 'Charging hub',
    icon: '🔌',
    cost: `${BALANCE.costs.plant[PlantType.ChargingHub]}`,
  },
  { id: 'bulldoze', label: 'Bulldozer', icon: '🚜' },
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
  return (
    <nav className="toolbar" data-testid="toolbar">
      {TOOLS.map((entry) => (
        <button
          key={entry.id}
          type="button"
          title={entry.cost ? `${entry.label} (${entry.cost})` : entry.label}
          className={`toolbar-button ${tool === entry.id ? 'active' : ''}`}
          data-testid={`tool-${entry.id}`}
          onClick={() => onSelectTool(entry.id)}
        >
          <span className="toolbar-icon">{entry.icon}</span>
          <span className="toolbar-label">{entry.label}</span>
          {entry.cost && <span className="toolbar-cost">{entry.cost}</span>}
        </button>
      ))}
      <button
        type="button"
        className="toolbar-button"
        title="Undo last build action"
        data-testid="tool-undo"
        onClick={onUndo}
      >
        <span className="toolbar-icon">↩</span>
        <span className="toolbar-label">Undo</span>
      </button>
    </nav>
  );
}
