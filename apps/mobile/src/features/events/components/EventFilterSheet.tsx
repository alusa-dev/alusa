import { FilterOptionSheet } from '@/components/overlays/FilterOptionSheet';

export type EventStatusFilter = 'ALL' | 'PLANNING' | 'ACTIVE' | 'FINISHED' | 'CANCELLED';

const options = [
  { value: 'ALL', label: 'Todos os eventos', description: 'Exibir eventos em qualquer situação' },
  { value: 'PLANNING', label: 'Em planejamento' },
  { value: 'ACTIVE', label: 'Ativos' },
  { value: 'FINISHED', label: 'Finalizados' },
  { value: 'CANCELLED', label: 'Cancelados' },
];

export function EventFilterSheet({ visible, value, onChange, onClose }: { visible: boolean; value: EventStatusFilter; onChange: (_value: EventStatusFilter) => void; onClose: () => void }) {
  return (
    <FilterOptionSheet
      visible={visible}
      title="Filtrar eventos"
      value={value}
      clearValue="ALL"
      options={options}
      onChange={(nextValue) => onChange(nextValue as EventStatusFilter)}
      onClose={onClose}
      accessibilityLabel="Filtros de eventos"
    />
  );
}
