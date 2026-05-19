'use client';

import type { ComponentType } from 'react';
import { useCallback, useEffect, useState, useMemo } from 'react';
import { useFinanceLiveRefresh } from '@/features/financeiro/hooks/useFinanceLiveRefresh';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  CreditCard,
  AlertCircle,
  CheckCircle,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
} from '@/components/icons/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge, type StatusType } from '@/components/ui/badge';
import type { PortalFinanceiroListItemDTO } from '@/features/portal/dtos';

const PAYMENT_NOTICE =
  'Pagamentos e alterações de forma de pagamento são realizados exclusivamente pela secretaria da escola.';

type Cobranca = PortalFinanceiroListItemDTO;

const ITEMS_PER_PAGE = 15;
const getTurmaNome = (cobranca: Cobranca) => cobranca.matricula.turma?.nome ?? 'Turma não informada';
const getModalidadeNome = (cobranca: Cobranca) =>
  cobranca.matricula.turma?.modalidade.nome ?? 'Modalidade não informada';

const formaPagamentoLabel: Record<string, string> = {
  PIX: 'PIX',
  BOLETO: 'Boleto',
  CARTAO_CREDITO: 'Cartão',
  CARTAO_DEBITO: 'Débito',
  DINHEIRO: 'Dinheiro',
};

export function PortalFinanceiroTable() {
  const router = useRouter();
  const { data: session } = useSession();
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'todas' | 'pendentes' | 'pagas'>('todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const loadCobrancas = useCallback(
    async (silent = false) => {
      if (!session?.user) return;
      try {
        if (!silent) setLoading(true);
        const response = await fetch('/api/portal/financeiro', { cache: 'no-store' });
        if (!response.ok) {
          throw new Error('Erro ao carregar cobranças');
        }
        const result = await response.json();
        setCobrancas(result.cobrancas || []);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [session?.user],
  );

  useEffect(() => {
    void loadCobrancas();
  }, [loadCobrancas]);

  useFinanceLiveRefresh(() => loadCobrancas(true), {
    enabled: Boolean(session?.user) && !loading,
    intervalMs: 45_000,
    minIntervalMs: 10_000,
    realtime: { dashboard: false, financeiro: false },
  });

  // Filtrar e buscar
  const cobrancasFiltradas = useMemo(() => {
    let filtered = cobrancas;

    // Filtro por status
    if (filter === 'pendentes') {
      filtered = filtered.filter((c) => c.status === 'PENDENTE' || c.status === 'ATRASADO');
    } else if (filter === 'pagas') {
      filtered = filtered.filter((c) => c.status === 'PAGO');
    }

    // Busca por texto
    if (searchTerm.trim()) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter((c) =>
        c.matricula.aluno.nome.toLowerCase().includes(term) ||
        getTurmaNome(c).toLowerCase().includes(term) ||
        getModalidadeNome(c).toLowerCase().includes(term) ||
        c.valor.toString().includes(term)
      );
    }

    return filtered;
  }, [cobrancas, filter, searchTerm]);

  // Paginação
  const totalPages = Math.ceil(cobrancasFiltradas.length / ITEMS_PER_PAGE);
  const paginatedCobrancas = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const end = start + ITEMS_PER_PAGE;
    return cobrancasFiltradas.slice(start, end);
  }, [cobrancasFiltradas, currentPage]);

  // Reset página ao mudar filtro ou busca
  useEffect(() => {
    setCurrentPage(1);
  }, [filter, searchTerm]);

  const totalPendente = cobrancas
    .filter((c) => c.status === 'PENDENTE' || c.status === 'ATRASADO')
    .reduce((sum, c) => sum + c.valor, 0);

  const totalPago = cobrancas
    .filter((c) => c.status === 'PAGO')
    .reduce((sum, c) => sum + c.valor, 0);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
    }).format(value);
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('pt-BR');
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-96" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
        <AlertCircle className="h-5 w-5" />
        <span>{error}</span>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Financeiro</h1>
        <p className="mt-2 text-gray-600">Acompanhe suas cobranças e pagamentos</p>
      </div>

      <div className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
        <AlertCircle className="h-5 w-5 flex-shrink-0" />
        <div>
          <p className="text-sm font-semibold">Autoatendimento desativado</p>
          <p className="text-sm text-amber-800">{PAYMENT_NOTICE}</p>
        </div>
      </div>
      {/* Resumo Financeiro */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <SummaryCard
          title="Total de Cobranças"
          value={cobrancas.length.toString()}
          icon={CreditCard}
          variant="violet"
        />
        <SummaryCard
          title="Pendentes"
          value={formatCurrency(totalPendente)}
          icon={AlertCircle}
          variant="red"
        />
        <SummaryCard
          title="Pago"
          value={formatCurrency(totalPago)}
          icon={CheckCircle}
          variant="green"
        />
      </div>

      {/* Filtros e Busca */}
      <div className="flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
        <div className="flex gap-3">
          <FilterButton
            label="Todas"
            active={filter === 'todas'}
            count={cobrancas.length}
            onClick={() => setFilter('todas')}
          />
          <FilterButton
            label="Pendentes"
            active={filter === 'pendentes'}
            count={cobrancas.filter((c) => c.status === 'PENDENTE' || c.status === 'ATRASADO').length}
            onClick={() => setFilter('pendentes')}
          />
          <FilterButton
            label="Pagas"
            active={filter === 'pagas'}
            count={cobrancas.filter((c) => c.status === 'PAGO').length}
            onClick={() => setFilter('pagas')}
          />
        </div>
        
        {/* Campo de busca */}
        <div className="relative w-full md:w-80">
          <div className="absolute left-3 top-1/2 -translate-y-1/2">
            <Search className="h-4 w-4 text-gray-400" />
          </div>
          <input
            type="search"
            placeholder="Buscar por aluno, turma ou valor..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full h-10 pl-10 pr-4 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        {/* Cabeçalho da tabela */}
        <div className="bg-gray-50 px-6 py-3 border-b">
          <div className="grid grid-cols-12 gap-4 text-[11px] font-medium text-gray-500 uppercase tracking-wider">
            <div className="col-span-3">Aluno</div>
            <div className="col-span-2 text-center">Valor</div>
            <div className="col-span-2 text-center">Forma</div>
            <div className="col-span-2 text-center">Vencimento</div>
            <div className="col-span-2 text-center">Status</div>
            <div className="col-span-1 text-center">Ações</div>
          </div>
        </div>

        {/* Linhas */}
        <div className="divide-y">
          {cobrancasFiltradas.length === 0 ? (
            <div className="px-6 py-12 text-center text-gray-500">
              {searchTerm
                ? 'Nenhuma cobrança corresponde à sua busca.'
                : filter === 'todas'
                ? 'Você não possui cobranças registradas.'
                : `Você não possui cobranças ${filter}.`}
            </div>
          ) : (
            paginatedCobrancas.map((cobranca) => {
              const vencimento = new Date(cobranca.vencimento);
              const isAtrasado = vencimento < new Date() && cobranca.status === 'PENDENTE';

              return (
                <div
                  key={cobranca.id}
                  className="px-6 py-3 hover:bg-gray-50 transition-colors bg-white cursor-pointer"
                  onClick={() => router.push(`/portal/financeiro/${cobranca.id}`)}
                >
                  <div className="grid grid-cols-12 gap-4 items-center">
                    {/* Nome do Aluno */}
                    <div className="col-span-3">
                      <div className="font-medium text-gray-900 text-[13px] truncate">
                        {cobranca.matricula.aluno.nome}
                      </div>
                      <div className="text-[11px] text-gray-500 truncate">
                        {getModalidadeNome(cobranca)}
                      </div>
                    </div>

                    {/* Valor */}
                    <div className="col-span-2 text-[13px] text-gray-900 text-center font-semibold">
                      {formatCurrency(cobranca.valor)}
                    </div>

                    {/* Forma de Pagamento */}
                    <div className="col-span-2 text-[13px] text-center">
                      <div className="flex flex-col items-center gap-1">
                        <span className="text-gray-700">
                          {cobranca.formaPagamento ? formaPagamentoLabel[cobranca.formaPagamento] || cobranca.formaPagamento : '-'}
                        </span>
                        {/* Badge de débito automático */}
                        {cobranca.formaPagamento === 'CARTAO_CREDITO' && 
                         cobranca.matricula.responsavelFinanceiro?.hasSavedCard && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 text-[10px] font-medium rounded-full">
                            <CheckCircle className="h-3 w-3" />
                            Automático
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Vencimento */}
                    <div className="col-span-2 text-center">
                      <div
                        className={`text-[13px] ${
                          isAtrasado ? 'text-red-600 font-medium' : 'text-gray-700'
                        }`}
                      >
                        {formatDate(cobranca.vencimento)}
                      </div>
                    </div>

                    {/* Status */}
                    <div className="col-span-2 flex justify-center">
                      <Badge status={cobranca.status as StatusType} size="sm" />
                    </div>

                    {/* Ações */}
                    <div className="col-span-1 flex justify-center" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => router.push(`/portal/financeiro/${cobranca.id}`)}
                        className="inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium text-violet-600 hover:bg-violet-50"
                        title="Ver detalhes da cobrança"
                      >
                        <Eye className="h-4 w-4" />
                        Detalhes
                      </button>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Paginação */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-600">
            Mostrando {((currentPage - 1) * ITEMS_PER_PAGE) + 1} a{' '}
            {Math.min(currentPage * ITEMS_PER_PAGE, cobrancasFiltradas.length)} de{' '}
            {cobrancasFiltradas.length} cobranças
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="flex items-center gap-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              <ChevronLeft className="h-4 w-4" />
              Anterior
            </button>
            <div className="flex items-center gap-1">
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                let page;
                if (totalPages <= 5) {
                  page = i + 1;
                } else if (currentPage <= 3) {
                  page = i + 1;
                } else if (currentPage >= totalPages - 2) {
                  page = totalPages - 4 + i;
                } else {
                  page = currentPage - 2 + i;
                }
                
                return (
                  <button
                    key={page}
                    onClick={() => setCurrentPage(page)}
                    className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                      currentPage === page
                        ? 'bg-violet-600 text-white'
                        : 'hover:bg-gray-100 text-gray-700'
                    }`}
                  >
                    {page}
                  </button>
                );
              })}
            </div>
            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="flex items-center gap-1 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed text-sm font-medium"
            >
              Próxima
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

type SummaryIcon = ComponentType<{ className?: string }>;

function SummaryCard({
  title,
  value,
  icon: Icon,
  variant,
}: {
  title: string;
  value: string;
  icon: SummaryIcon;
  variant: 'violet' | 'red' | 'green';
}) {
  const colors = {
    violet: 'from-violet-500 to-violet-600',
    red: 'from-red-500 to-red-600',
    green: 'from-green-500 to-green-600',
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm font-medium text-gray-600">{title}</p>
          <p className="mt-2 text-2xl font-bold text-gray-900">{value}</p>
        </div>
        <div className={`p-3 rounded-lg bg-gradient-to-br ${colors[variant]}`}>
          <Icon className="h-6 w-6 text-white" />
        </div>
      </div>
    </div>
  );
}

function FilterButton({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-lg border text-sm font-medium transition-all ${
        active
          ? 'bg-violet-50 border-violet-300 text-violet-700'
          : 'bg-white border-gray-200 text-gray-700 hover:bg-gray-50'
      }`}
    >
      {label} ({count})
    </button>
  );
}
