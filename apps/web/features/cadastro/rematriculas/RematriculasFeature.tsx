'use client';

import { useMemo, useState } from 'react';
import TableLayout from '@/components/layout/TableLayout';
import DataTable, { type DataTableColumn } from '@/components/layout/DataTable';
import { Button } from '@/components/ui/button';
import useCurrentUser from '@/hooks/use-current-user';
import { useRematriculas } from './hooks/use-rematriculas';
import type { RematriculaElegivelItem, StatusContrato } from './services/rematriculas-service';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { RematriculaDialog } from '@/components/matriculas/RematriculaDialog';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EntityFiltersBar, {
  type SortOrder as SortOrderEF,
  type StatusValue,
} from '@/components/layout/EntityFiltersBar';

type QuickFilter = 'TODOS' | 'PRONTO' | 'AGUARDANDO';

type SortOrder = 'ASC' | 'DESC';

function getDiasBadgeVariant(diasRestantes: number): BadgeVariant {
  if (diasRestantes < 0) return 'destructive';
  if (diasRestantes <= 15) return 'warning';
  if (diasRestantes <= 45) return 'info';
  return 'default';
}

export default function RematriculasFeature() {
  const { user } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const [search, setSearch] = useState('');
  const [diasAntecedencia, setDiasAntecedencia] = useState(60);
  const [statusContrato, setStatusContrato] = useState<StatusContrato | undefined>(undefined);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('TODOS');
  const [selectedMatricula, setSelectedMatricula] = useState<RematriculaElegivelItem | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');

  const { items, loading, total, referencia, ate, reload } = useRematriculas({
    contaId,
    diasAntecedencia,
    statusContrato,
    search: search || undefined,
  });

  const quickFilterOptions: Array<{ label: string; value: QuickFilter }> = [
    { label: 'Todos', value: 'TODOS' },
    { label: 'Liberadas', value: 'PRONTO' },
    { label: 'Requer atenção', value: 'AGUARDANDO' },
  ];

  const filteredItems = useMemo(() => {
    if (quickFilter === 'TODOS') return items;
    if (quickFilter === 'PRONTO') {
      return items.filter(
        (item) => item.podeRenovar && ['LIBERADA', 'LIBERADA_COM_AVISO'].includes(item.financeiro.rematriculaActionStatus),
      );
    }
    return items.filter(
      (item) => !item.podeRenovar || ['REQUER_OVERRIDE', 'BLOQUEADA'].includes(item.financeiro.rematriculaActionStatus),
    );
  }, [items, quickFilter]);

  const getFinanceiroBadge = (item: RematriculaElegivelItem) => {
    if (item.financeiro.rematriculaActionStatus === 'BLOQUEADA') {
      return <Badge variant="destructive">Bloqueada</Badge>;
    }
    if (item.financeiro.rematriculaActionStatus === 'REQUER_OVERRIDE') {
      return <Badge variant="warning">Override</Badge>;
    }
    if (item.financeiro.rematriculaActionStatus === 'LIBERADA_COM_AVISO') {
      return <Badge variant="info">Aviso</Badge>;
    }
    return <Badge variant="default">Liberada</Badge>;
  };

  // Colunas no mesmo padrão da tabela de alunos
  const columns: DataTableColumn<RematriculaElegivelItem>[] = [
    {
      id: 'aluno',
      header: 'Aluno',
      width: 'w-1/4',
      align: 'left',
      render: (row) => {
        const initials = (row.aluno.nome ?? '')
          .split(' ')
          .map((n) => n[0])
          .join('')
          .slice(0, 2)
          .toUpperCase();
        return (
          <div className="flex items-center gap-3 min-w-0">
            <Avatar className="h-10 w-10">
              {row.aluno.foto ? (
                <AvatarImage src={row.aluno.foto} alt={row.aluno.nome ?? ''} />
              ) : null}
              <AvatarFallback className="bg-purple-100 text-purple-700 font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="font-normal text-gray-900 text-[13px] truncate">{row.aluno.nome}</div>
              <div className="text-xs text-gray-500">{row.aluno.cpf ?? '—'}</div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'plano',
      header: 'Plano',
      width: 'w-1/4',
      align: 'left',
      render: (row) => (
        <div className="flex flex-col text-sm text-gray-700">
          <span className="font-medium text-gray-900">
            {row.plano?.nome ?? (row.combo ? `Combo: ${row.combo.nome}` : '—')}
          </span>
          {row.turma ? (
            <span className="text-xs text-gray-500">{row.turma.nome}</span>
          ) : (
            <span className="text-xs text-gray-400">Sem turma vinculada</span>
          )}
        </div>
      ),
    },
    {
      id: 'contrato',
      header: 'Contrato',
      width: 'w-1/6',
      align: 'center',
      render: (row) => (
        <Badge variant={getDiasBadgeVariant(row.diasRestantes)}>
          {row.contratoExpirado ? 'Expirado' : 'Ativo'}
        </Badge>
      ),
    },
    {
      id: 'status',
      header: 'Operação',
      width: 'w-1/6',
      align: 'center',
      render: (row) => (
        <div className="flex items-center justify-center">{getFinanceiroBadge(row)}</div>
      ),
    },
    {
      id: 'acoes',
      header: 'Ações',
      width: 'w-1/6',
      align: 'right',
      render: (row) => (
        <div className="flex justify-end">
          <Button
            variant={row.podeRenovar && row.financeiro.rematriculaActionStatus !== 'BLOQUEADA' ? 'default' : 'outline'}
            size="sm"
            className={row.podeRenovar && row.financeiro.rematriculaActionStatus !== 'BLOQUEADA' ? 'bg-brand-accent text-white' : 'text-xs'}
            disabled={!row.podeRenovar || row.financeiro.rematriculaActionStatus === 'BLOQUEADA'}
            onClick={() => {
              if (!row.podeRenovar || row.financeiro.rematriculaActionStatus === 'BLOQUEADA') {
                toast.custom((t) => (
                  <CustomToast
                    variant="warning"
                    title="Rematrícula indisponível"
                    description={row.financeiro.actionMessage || 'A rematrícula não pode ser iniciada neste momento.'}
                    onClose={() => toast.dismiss(t)}
                  />
                ));
                return;
              }
              setSelectedMatricula(row);
            }}
          >
            Rematricular
          </Button>
        </div>
      ),
    },
  ];

  return (
    <>
      <TableLayout
        title="Gestão de Rematrículas"
        subtitle="Gerencie contratos próximos do fim e renove em poucos cliques."
        actions={
          <Tabs value={quickFilter} onValueChange={(value) => setQuickFilter(value as QuickFilter)}>
            <TabsList aria-label="Filtros de rematrícula" className="h-10 rounded-xl bg-slate-100/80 p-1">
              {quickFilterOptions.map((option) => (
                <TabsTrigger
                  key={option.value}
                  value={option.value}
                  className="h-8 rounded-lg px-4 py-0 text-sm shadow-none"
                >
                  {option.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
        filtersBar={
          <EntityFiltersBar
            searchValue={search}
            onSearchChange={setSearch}
            statusValue={(statusContrato ?? 'TODOS') as StatusValue}
            onStatusChange={(value) =>
              setStatusContrato(value === 'TODOS' ? undefined : (value as StatusContrato))
            }
            sortOrder={sortOrder as SortOrderEF}
            onSortChange={(order) => setSortOrder(order as SortOrder)}
            searchPlaceholder="Buscar por aluno, plano ou turma"
            extraFilters={
              <div className="flex flex-col gap-1">
                <span className="text-[11px] uppercase tracking-wide text-gray-500">
                  Dias de antecedência
                </span>
                <input
                  type="number"
                  min={15}
                  max={180}
                  value={diasAntecedencia}
                  onChange={(event) => {
                    const parsed = Number(event.target.value);
                    if (!Number.isFinite(parsed)) {
                      setDiasAntecedencia(60);
                      return;
                    }
                    const clamped = Math.min(180, Math.max(15, parsed));
                    setDiasAntecedencia(clamped);
                  }}
                  className="block w-full max-w-[120px] rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:outline-none focus:ring-2 focus:ring-brand-accent focus:border-brand-accent"
                />
              </div>
            }
          />
        }
      >
        <div className="bg-white rounded-xl border overflow-hidden px-0 py-0">
          <DataTable
            aria-label="Tabela de rematrículas elegíveis"
            columns={columns}
            data={filteredItems}
            rowKey={(row) => row.id}
            loading={loading}
            emptyMessage={
              <div className="px-6 py-12 text-center text-sm text-gray-500">
                {loading
                  ? 'Carregando rematrículas...'
                  : 'Nenhuma matrícula elegível encontrada para os filtros atuais'}
              </div>
            }
          />
        </div>
      </TableLayout>

      <RematriculaDialog
        open={Boolean(selectedMatricula)}
        contaId={contaId ?? undefined}
        item={selectedMatricula}
        onOpenChange={(open) => {
          if (!open) setSelectedMatricula(null);
        }}
        onCreated={() => {
          toast.custom((t) => (
            <CustomToast
              variant="success"
              title="Rematrícula criada"
              description="A nova matrícula foi criada com sucesso."
              onClose={() => toast.dismiss(t)}
            />
          ));
          setSelectedMatricula(null);
          void reload();
        }}
      />
    </>
  );
}
