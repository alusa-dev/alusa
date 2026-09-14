import { FilterOptionSheet } from '@/components/overlays/FilterOptionSheet';

export type EventParticipantStatusFilter = 'ALL' | 'ACTIVE' | 'CANCELLED';

const options = [
  { value: 'ALL', label: 'Todos os alunos', description: 'Exibir inscrições ativas e canceladas' },
  { value: 'ACTIVE', label: 'Inscritos ativos' },
  { value: 'CANCELLED', label: 'Inscrições canceladas' },
];

export function EventParticipantFilterSheet({
  visible,
  value,
  onChange,
  onClose,
}: {
  visible: boolean;
  value: EventParticipantStatusFilter;
  onChange: (_value: EventParticipantStatusFilter) => void;
  onClose: () => void;
}) {
  return (
    <FilterOptionSheet
      visible={visible}
      title="Filtrar alunos inscritos"
      value={value}
      clearValue="ALL"
      options={options}
      onChange={(nextValue) => onChange(nextValue as EventParticipantStatusFilter)}
      onClose={onClose}
      accessibilityLabel="Filtros de alunos inscritos"
    />
  );
}
