'use client';

import type { ComponentType } from 'react';
import { useEffect, useState, useMemo } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import {
  CreditCard,
  AlertCircle,
  CheckCircle,
  Clock,
  DollarSign,
  Search,
  ChevronLeft,
  ChevronRight,
  Eye,
} from '@/components/icons/icons';
import { Skeleton } from '@/components/ui/skeleton';
import type { PortalFinanceiroListItemDTO } from '@/features/portal/dtos';
const PAYMENT_NOTICE =
  'Pagamentos e alterações de forma de pagamento são conduzidos pela secretaria da escola.';
type Cobranca = PortalFinanceiroListItemDTO;

const ITEMS_PER_PAGE = 10;
const getTurmaNome = (cobranca: Cobranca) => cobranca.matricula.turma?.nome ?? 'Turma não informada';
const getModalidadeNome = (cobranca: Cobranca) =>
  cobranca.matricula.turma?.modalidade.nome ?? 'Modalidade não informada';

export function PortalFinanceiroFeature() {
  const router = useRouter();
  const { data: session } = useSession();
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'todas' | 'pendentes' | 'pagas'>('todas');
  const [searchTerm, setSearchTerm] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    async function loadCobrancas() {
      try {
        setLoading(true);
        const response = await fetch('/api/portal/financeiro');
        if (!response.ok) {
          throw new Error('Erro ao carregar cobranças');
        }
        const result = await response.json();
        setCobrancas(result.cobrancas || []);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    if (session?.user) {
      loadCobrancas();
    }
  }, [session]);

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

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-96" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-64" />
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
          value={`R$ ${Number(totalPendente).toFixed(2)}`}
          icon={AlertCircle}
          variant="red"
        />
        <SummaryCard
          title="Pago"
          value={`R$ ${Number(totalPago).toFixed(2)}`}
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

      {/* Lista de Cobranças */}
      <div className="space-y-4">
        {cobrancasFiltradas.length === 0 ? (
          <div className="text-center py-12 bg-gray-50 rounded-xl border border-gray-200">
            <CreditCard className="h-12 w-12 text-gray-400 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-gray-900">Nenhuma cobrança encontrada</h3>
            <p className="mt-2 text-gray-600">
              {searchTerm
                ? 'Nenhuma cobrança corresponde à sua busca.'
                : filter === 'todas'
                ? 'Você não possui cobranças registradas.'
                : `Você não possui cobranças ${filter}.`}
            </p>
          </div>
        ) : (
          <>
            {paginatedCobrancas.map((cobranca) => (
              <CobrancaCard 
                key={cobranca.id} 
                cobranca={cobranca}
                onViewDetails={() => router.push(`/portal/financeiro/${cobranca.id}`)}
              />
            ))}

            {/* Paginação */}
            {totalPages > 1 && (
              <div className="flex items-center justify-between pt-6">
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
                    {Array.from({ length: totalPages }, (_, i) => i + 1).map((page) => (
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
                    ))}
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
          </>
        )}
      </div>
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

function CobrancaCard({ 
  cobranca, 
  onViewDetails,
}: { 
  cobranca: Cobranca;
  onViewDetails: () => void;
}) {
  const statusConfig = {
    PENDENTE: {
      label: 'Pendente',
      color: 'bg-amber-100 text-amber-800 border-amber-200',
      icon: Clock,
    },
    ATRASADO: {
      label: 'Atrasado',
      color: 'bg-red-100 text-red-800 border-red-200',
      icon: AlertCircle,
    },
    PAGO: {
      label: 'Pago',
      color: 'bg-green-100 text-green-800 border-green-200',
      icon: CheckCircle,
    },
    CANCELADO: {
      label: 'Cancelado',
      color: 'bg-gray-100 text-gray-800 border-gray-200',
      icon: AlertCircle,
    },
  };

  const status = statusConfig[cobranca.status as keyof typeof statusConfig] || statusConfig.PENDENTE;
  const StatusIcon = status.icon;
  const vencimento = new Date(cobranca.vencimento);
  const isAtrasado = vencimento < new Date() && cobranca.status === 'PENDENTE';
  const modalidadeNome = getModalidadeNome(cobranca);
  const turmaNome = getTurmaNome(cobranca);
  const pagamentoPrincipal = cobranca.pagamentos[0];
  const dataPagamento = pagamentoPrincipal?.dataPagamento
    ? new Date(pagamentoPrincipal.dataPagamento).toLocaleDateString('pt-BR')
    : 'Pagamento em processamento';

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-lg transition-shadow">
      <div className="flex items-start justify-between mb-4">
        <div className="flex-1">
          <div className="flex items-start gap-3">
            <div className="p-3 bg-violet-50 rounded-lg">
              <DollarSign className="h-6 w-6 text-violet-600" />
            </div>
            <div>
              <h3 className="font-semibold text-gray-900">
                R$ {Number(cobranca.valor).toFixed(2)}
              </h3>
              <p className="text-sm text-gray-600">
                {cobranca.matricula.aluno.nome} • {modalidadeNome}
              </p>
              <p className="text-xs text-gray-500 mt-1">{turmaNome}</p>
            </div>
          </div>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm font-medium border flex items-center gap-2 ${status.color}`}>
          <StatusIcon className="h-4 w-4" />
          {status.label}
        </div>
      </div>

      {/* Informações de Vencimento */}
      <div className="flex items-center gap-6 text-sm text-gray-600 mb-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4" />
          <span>Vencimento: {vencimento.toLocaleDateString('pt-BR')}</span>
        </div>
        {isAtrasado && (
          <span className="text-red-600 font-medium">
            Vencido há {Math.floor((Date.now() - vencimento.getTime()) / (1000 * 60 * 60 * 24))} dia(s)
          </span>
        )}
      </div>

      {/* Informações de Pagamento */}
      {cobranca.pagamentos.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
          <p className="text-sm font-medium text-green-900">Pagamento Confirmado</p>
          <p className="text-sm text-green-800 mt-1">
            {dataPagamento} • R$ {Number(pagamentoPrincipal?.valorPago ?? 0).toFixed(2)}
          </p>
        </div>
      )}

      {/* Ações */}
      <div className="mt-4 border-t border-gray-200 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <button
            onClick={onViewDetails}
            className="flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Eye className="h-4 w-4" />
            Ver Detalhes
          </button>
          {(cobranca.status === 'PENDENTE' || cobranca.status === 'ATRASADO') && (
            <p className="text-sm text-amber-700">
              Entre em contato com a secretaria para quitar esta cobrança.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
