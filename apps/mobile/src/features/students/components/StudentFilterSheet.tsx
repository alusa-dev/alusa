import { FilterOptionSheet } from '@/components/overlays/FilterOptionSheet';

export type StudentStatusFilter = 'ALL' | 'ACTIVE' | 'INACTIVE';

const options: Array<{ value: StudentStatusFilter; label: string; description: string }> = [
  { value: 'ALL', label: 'Todos os alunos', description: 'Exibir alunos ativos e inativos' },
  { value: 'ACTIVE', label: 'Alunos ativos', description: 'Alunos que estão atualmente na escola' },
  { value: 'INACTIVE', label: 'Alunos inativos', description: 'Alunos que não estão ativos no momento' },
];

export function StudentFilterSheet({ visible, value, onChange, onClose }: { visible: boolean; value: StudentStatusFilter; onChange: (value: StudentStatusFilter) => void; onClose: () => void }) {
  return <FilterOptionSheet
    visible={visible}
    title="Filtrar alunos"
    value={value}
    clearValue="ALL"
    options={options}
    onChange={(nextValue) => onChange(nextValue as StudentStatusFilter)}
    onClose={onClose}
    accessibilityLabel="Filtrar alunos"
  />;
}
