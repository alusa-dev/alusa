import { FilterOptionSheet } from '@/components/overlays/FilterOptionSheet';

export type ResponsibleStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

const options = [
  { value: 'ALL', label: 'Todos os responsáveis', description: 'Exibir responsáveis ativos e inativos' },
  { value: 'ACTIVE', label: 'Responsáveis ativos', description: 'Com pelo menos um aluno ativo' },
  { value: 'INACTIVE', label: 'Responsáveis inativos', description: 'Sem alunos ativos no momento' },
];

export function ResponsibleFilterSheet({ visible, currentValue, onChange, onClose }: { visible: boolean; currentValue: ResponsibleStatusFilter; onChange: (_nextValue: ResponsibleStatusFilter) => void; onClose: () => void }) {
  return <FilterOptionSheet visible={visible} title="Filtrar responsáveis" value={currentValue} clearValue="ALL" options={options} onChange={(next) => onChange(next as ResponsibleStatusFilter)} onClose={onClose} accessibilityLabel="Filtrar responsáveis" />;
}
