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
import { RematriculaFamiliarDialog } from '@/components/matriculas/RematriculaFamiliarDialog';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import EntityFiltersBar, {
  type SortOrder as SortOrderEF,
  type StatusValue,
} from '@/components/layout/EntityFiltersBar';

type QuickFilter = 'TODOS' | 'PRONTO' | 'AGUARDANDO';

type SortOrder = 'ASC' | 'DESC';

type RematriculaTitularGroup = {
  id: string;
  tipo: 'RESPONSAVEL' | 'ALUNO';
  titular: {
    id: string;
    nome: string;
    cpf?: string | null;
    foto?: string | null;
  };
  itens: RematriculaElegivelItem[];
};

function getDiasBadgeVariant(diasRestantes: number): BadgeVariant {
  if (diasRestantes < 0) return 'destructive';
  if (diasRestantes <= 15) return 'warning';
  if (diasRestantes <= 45) return 'info';
  return 'default';
}

function getInitials(name: string) {
  return name
    .split(' ')
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
}

const NAME_PARTICLES = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/** Primeiro nome(s) + sobrenome essencial para exibição compacta (ex.: Lara Bianca de Alencar → Lara Bianca). */
function shortStudentDisplayName(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0];

  const lower = parts.map((w) => w.toLowerCase());
  const particleIdx = lower.findIndex((w) => NAME_PARTICLES.has(w));

  if (particleIdx === -1) {
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }

  const given = parts.slice(0, particleIdx).join(' ');
  const afterParticle = parts[particleIdx + 1];

  if (particleIdx === 1) {
    return afterParticle ? `${parts[0]} ${afterParticle}` : parts[0];
  }

  return given || parts[0];
}

/** Lista legível em PT: "A e B" ou "A, B e C". */
function joinNamesPortuguese(names: string[]): string {
  const n = names.filter(Boolean);
  if (n.length === 0) return '';
  if (n.length === 1) return n[0];
  if (n.length === 2) return `${n[0]} e ${n[1]}`;
  return `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]}`;
}

function getGroupActionStatus(group: RematriculaTitularGroup) {
  const statuses = group.itens.map((item) => item.financeiro.rematriculaActionStatus);
  if (statuses.includes('BLOQUEADA')) return 'BLOQUEADA';
  if (statuses.includes('REQUER_OVERRIDE')) return 'REQUER_OVERRIDE';
  if (statuses.includes('LIBERADA_COM_AVISO')) return 'LIBERADA_COM_AVISO';
  return 'LIBERADA';
}

function getGroupDiasRestantes(group: RematriculaTitularGroup) {
  return Math.min(...group.itens.map((item) => item.diasRestantes));
}

function getGroupCanRenew(group: RematriculaTitularGroup) {
  return group.itens.some(
    (item) => item.podeRenovar && item.financeiro.rematriculaActionStatus !== 'BLOQUEADA',
  );
}

function buildTitularGroups(items: RematriculaElegivelItem[]): RematriculaTitularGroup[] {
  const groups = new Map<string, RematriculaTitularGroup>();

  for (const item of items) {
    const responsavel = item.responsavelFinanceiro;
    const tipo = responsavel ? 'RESPONSAVEL' : 'ALUNO';
    const titular = responsavel
      ? {
          id: responsavel.id,
          nome: responsavel.nome ?? 'Responsável sem nome',
          cpf: responsavel.cpf,
          foto: responsavel.foto,
        }
      : {
          id: item.aluno.id,
          nome: item.aluno.nome ?? 'Aluno sem nome',
          cpf: item.aluno.cpf,
          foto: item.aluno.foto,
        };
    const key = `${tipo}:${titular.id}`;
    const current = groups.get(key);

    if (current) {
      current.itens.push(item);
    } else {
      groups.set(key, {
        id: key,
        tipo,
        titular,
        itens: [item],
      });
    }
  }

  return Array.from(groups.values()).sort((a, b) =>
    a.titular.nome.localeCompare(b.titular.nome, 'pt-BR'),
  );
}

export default function RematriculasFeature() {
  const { user } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const [search, setSearch] = useState('');
  const [diasAntecedencia, setDiasAntecedencia] = useState(60);
  const [statusContrato, setStatusContrato] = useState<StatusContrato | undefined>(undefined);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('TODOS');
  const [selectedMatricula, setSelectedMatricula] = useState<RematriculaElegivelItem | null>(null);
  const [selectedTitular, setSelectedTitular] = useState<RematriculaTitularGroup | null>(null);
  const [sortOrder, setSortOrder] = useState<SortOrder>('ASC');

  const { items, loading, reload } = useRematriculas({
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

  const groupedItems = useMemo(() => buildTitularGroups(items), [items]);

  const filteredGroups = useMemo(() => {
    if (quickFilter === 'TODOS') return groupedItems;
    if (quickFilter === 'PRONTO') {
      return groupedItems.filter(
        (group) =>
          getGroupCanRenew(group) &&
          ['LIBERADA', 'LIBERADA_COM_AVISO'].includes(getGroupActionStatus(group)),
      );
    }
    return groupedItems.filter(
      (group) => !getGroupCanRenew(group) || ['REQUER_OVERRIDE', 'BLOQUEADA'].includes(getGroupActionStatus(group)),
    );
  }, [groupedItems, quickFilter]);

  const getFinanceiroBadge = (group: RematriculaTitularGroup) => {
    const status = getGroupActionStatus(group);
    if (status === 'BLOQUEADA') {
      return <Badge variant="destructive">Bloqueada</Badge>;
    }
    if (status === 'REQUER_OVERRIDE') {
      return <Badge variant="warning">Override</Badge>;
    }
    if (status === 'LIBERADA_COM_AVISO') {
      return <Badge variant="info">Aviso</Badge>;
    }
    return <Badge variant="default">Liberada</Badge>;
  };

  const columns: DataTableColumn<RematriculaTitularGroup>[] = [
    {
      id: 'titular',
      header: 'Titular',
      width: 'w-1/4',
      align: 'left',
      render: (row) => {
        const initials = getInitials(row.titular.nome);
        return (
          <div className="flex items-center gap-3 min-w-0">
            <Avatar className="h-10 w-10">
              {row.titular.foto ? (
                <AvatarImage src={row.titular.foto} alt={row.titular.nome} />
              ) : null}
              <AvatarFallback className="bg-purple-100 text-purple-700 font-medium">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="font-normal text-gray-900 text-[13px] truncate">
                {row.titular.nome}
              </div>
              <div className="text-xs text-gray-500">
                {row.tipo === 'RESPONSAVEL' ? 'Responsável financeiro' : 'Aluno titular'}
              </div>
            </div>
          </div>
        );
      },
    },
    {
      id: 'alunos',
      header: 'Alunos',
      width: 'w-1/4',
      align: 'left',
      render: (row) => {
        const compactNames = row.itens.map((item) =>
          shortStudentDisplayName(item.aluno.nome ?? ''),
        );
        const fullNames = row.itens.map((item) => item.aluno.nome ?? '').filter(Boolean);
        return (
          <div className="truncate text-sm text-gray-900" title={fullNames.join(' · ')}>
            {joinNamesPortuguese(compactNames)}
          </div>
        );
      },
    },
    {
      id: 'contrato',
      header: 'Contrato',
      width: 'w-1/6',
      align: 'center',
      render: (row) => {
        const dias = getGroupDiasRestantes(row);
        return (
          <Badge variant={getDiasBadgeVariant(dias)}>
            {dias < 0 ? 'Expirado' : `${dias} dia${dias === 1 ? '' : 's'}`}
          </Badge>
        );
      },
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
            variant={getGroupCanRenew(row) ? 'default' : 'outline'}
            size="sm"
            className={getGroupCanRenew(row) ? 'bg-brand-accent text-white' : 'text-xs'}
            disabled={!getGroupCanRenew(row)}
            onClick={() => {
              if (!getGroupCanRenew(row)) {
                toast.custom((t) => (
                  <CustomToast
                    variant="warning"
                    title="Rematrícula indisponível"
                    description="Nenhum aluno elegível para rematrícula neste titular."
                    onClose={() => toast.dismiss(t)}
                  />
                ));
                return;
              }
              if (row.tipo === 'RESPONSAVEL') {
                setSelectedTitular(row);
              } else {
                setSelectedMatricula(row.itens[0] ?? null);
              }
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
            searchPlaceholder="Buscar por responsável ou aluno"
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
            data={filteredGroups}
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

      <RematriculaFamiliarDialog
        open={Boolean(selectedTitular)}
        contaId={contaId ?? undefined}
        titular={selectedTitular?.titular ? {
          id: selectedTitular.titular.id,
          tipo: selectedTitular.tipo,
          nome: selectedTitular.titular.nome,
          cpf: selectedTitular.titular.cpf,
          foto: selectedTitular.titular.foto,
        } : null}
        itens={selectedTitular?.itens ?? []}
        onOpenChange={(open) => {
          if (!open) setSelectedTitular(null);
        }}
        onCreated={() => {
          setSelectedTitular(null);
          void reload();
        }}
      />
    </>
  );
}
