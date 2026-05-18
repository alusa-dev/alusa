'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import type { StatusType } from '@/components/ui/badge';
import {
  ChevronLeft as ArrowLeft,
  ChevronRight,
  Download,
  Filter,
  Receipt,
  Search,
  X,
} from '@/components/icons/icons';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { DatePicker } from '@/components/ui/date-picker';
import { cn } from '@/lib/cn';
import { ExportPaidReceiptsDialog } from '@/features/financeiro/pagamentos/ExportPaidReceiptsDialog';

// ─── Tipos ───────────────────────────────────────────────────────────────────

type Pagamento = {
  id: string;
  status: string;
  valorPago: number;
  dataPagamento: string | null;
  formaPagamento: string;
  comprovante: string | null;
  asaasPaymentId: string | null;
  createdAt: string;
};

type Cobranca = {
  id: string;
  sourceKind: string;
  sourceId: string;
  chargeType: string;
  origin: string;
  tipo: string | null;
  description: string | null;
  payerName: string;
  valor: number;
  vencimento: string | null;
  billingType: string | null;
  status: string;
  asaasPaymentId: string | null;
  matriculaId: string | null;
  groupId: string | null;
  isGroup: boolean;
  installmentCount: number | null;
  installmentsPaid: number | null;
  createdAt: string;
  pagamento: Pagamento | null;
};

type AlunoData = {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  cpf: string | null;
  foto: string | null;
};

type Resumo = {
  total: number;
  totalPago: number;
  totalValor: number;
};

// ─── Utilitários ─────────────────────────────────────────────────────────────

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);

const formatDate = (dateStr: string | null) => {
  if (!dateStr) return '—';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(dateStr));
  } catch {
    return '—';
  }
};

const getInitials = (nome: string) => {
  const parts = nome.split(' ').filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

const FORMA_LABELS: Record<string, string> = {
  BOLETO: 'Boleto',
  PIX: 'Pix',
  CARTAO_CREDITO: 'Cartão de Crédito',
  CREDIT_CARD: 'Cartão de Crédito',
  CARTAO_DEBITO: 'Cartão de Débito',
  DEBIT_CARD: 'Cartão de Débito',
  INDEFINIDO: 'Não definido',
  UNDEFINED: 'Não definido',
  DINHEIRO: 'Dinheiro',
  TRANSFERENCIA: 'Transferência',
};

const TIPO_LABELS: Record<string, string> = {
  TAXA_MATRICULA: 'Taxa de Matrícula',
  MENSALIDADE: 'Mensalidade',
  EXTRA: 'Extra',
  AVULSA: 'Avulsa',
  PARCELADA: 'Parcelamento',
  RECORRENTE: 'Recorrente',
  ONE_TIME: 'Avulsa',
  INSTALLMENT: 'Parcelamento',
  SUBSCRIPTION: 'Recorrente',
  LOJA: 'Loja',
};

const GRUPO_LABELS: Record<string, string> = {
  TAXA_MATRICULA: 'Taxa de Matrícula',
  MENSALIDADE: 'Mensalidades',
  PARCELADA: 'Parcelamentos',
  INSTALLMENT: 'Parcelamentos',
  RECORRENTE: 'Recorrentes',
  SUBSCRIPTION: 'Recorrentes',
  AVULSA: 'Avulsas',
  ONE_TIME: 'Avulsas',
  EXTRA: 'Avulsas',
  LOJA: 'Loja',
};

// Ordem de exibição dos grupos
const GRUPO_ORDER = [
  'TAXA_MATRICULA',
  'MENSALIDADE',
  'PARCELADA',
  'INSTALLMENT',
  'RECORRENTE',
  'SUBSCRIPTION',
  'AVULSA',
  'ONE_TIME',
  'EXTRA',
  'LOJA',
];

const STATUS_OPTIONS = [
  { value: 'TODOS', label: 'Todos status' },
  { value: 'PAGO', label: 'Pago' },
  { value: 'CONFIRMADO', label: 'Confirmado' },
  { value: 'CONFIRMED', label: 'Confirmado Asaas' },
  { value: 'RECEIVED', label: 'Recebido' },
  { value: 'RECEIVED_IN_CASH', label: 'Recebido em dinheiro' },
  { value: 'DUNNING_RECEIVED', label: 'Recebido por régua' },
  { value: 'ESTORNADO', label: 'Estornado' },
];

const TIPO_OPTIONS = [
  { value: 'TODOS', label: 'Todos tipos' },
  { value: 'TAXA_MATRICULA', label: 'Taxa de matrícula' },
  { value: 'MENSALIDADE', label: 'Mensalidade' },
  { value: 'PARCELADA', label: 'Parcelamento' },
  { value: 'INSTALLMENT', label: 'Parcelamento avulso' },
  { value: 'RECORRENTE', label: 'Recorrente' },
  { value: 'SUBSCRIPTION', label: 'Assinatura avulsa' },
  { value: 'AVULSA', label: 'Avulsa' },
  { value: 'ONE_TIME', label: 'Avulsa standalone' },
  { value: 'LOJA', label: 'Loja' },
];

const FORMA_OPTIONS = [
  { value: 'TODOS', label: 'Todas formas' },
  { value: 'PIX', label: 'Pix' },
  { value: 'BOLETO', label: 'Boleto' },
  { value: 'CARTAO_CREDITO', label: 'Cartão de crédito' },
  { value: 'CREDIT_CARD', label: 'Cartão de crédito' },
  { value: 'CARTAO_DEBITO', label: 'Cartão de débito' },
  { value: 'DEBIT_CARD', label: 'Cartão de débito' },
  { value: 'DINHEIRO', label: 'Dinheiro' },
  { value: 'PIX_PRESENCIAL', label: 'Pix presencial' },
  { value: 'INDEFINIDO', label: 'Não definido' },
];

function resolveGrupo(c: Cobranca): string {
  return c.tipo ?? c.chargeType ?? 'AVULSA';
}

function resolveStatus(c: Cobranca): StatusType {
  const raw = c.pagamento ? c.pagamento.status : c.status;
  const map: Record<string, StatusType> = {
    CONFIRMADO: 'CONFIRMED',
    PAGO: 'PAGO',
    PENDENTE: 'PENDENTE',
    A_VENCER: 'PENDING',
    ATRASADO: 'ATRASADO',
    ESTORNADO: 'ESTORNADO',
    CANCELADO: 'CANCELADO',
    CANCELAMENTO_PENDENTE: 'PROCESSANDO',
    PROCESSANDO: 'PROCESSANDO',
    CONFIRMED: 'CONFIRMED',
    RECEIVED: 'RECEIVED',
    OVERDUE: 'ATRASADO',
    REFUNDED: 'ESTORNADO',
    CANCELED: 'CANCELADO',
    PENDING: 'PENDING',
  };
  return map[raw] ?? 'PENDING';
}

function resolveValorExibido(c: Cobranca): number {
  if (c.pagamento) return c.pagamento.valorPago;
  return c.valor;
}

function resolveDataExibida(c: Cobranca): string | null {
  if (c.pagamento?.dataPagamento) return c.pagamento.dataPagamento;
  return c.vencimento;
}

function resolveForma(c: Cobranca): string {
  const raw = c.pagamento?.formaPagamento ?? c.billingType ?? '';
  return FORMA_LABELS[raw] || raw || '—';
}

function formatDateInput(value: string): string {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('pt-BR');
}

function toDateValue(value: string): Date | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toIsoDate(value: Date | undefined): string {
  if (!value) return '';
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// ─── Componente principal ─────────────────────────────────────────────────────

export default function PagamentoAlunoDetalhesPage({
  params,
}: {
  params: { alunoId: string };
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [aluno, setAluno] = useState<AlunoData | null>(null);
  const [cobrancas, setCobrancas] = useState<Cobranca[]>([]);
  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Filtros
  const [statusFilter, setStatusFilter] = useState('TODOS');
  const [tipoFilter, setTipoFilter] = useState('TODOS');
  const [formaFilter, setFormaFilter] = useState('TODOS');
  const [searchTerm, setSearchTerm] = useState('');
  const [dataInicio, setDataInicio] = useState('');
  const [dataFim, setDataFim] = useState('');
  const [exportReceiptsOpen, setExportReceiptsOpen] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/financeiro/pagamentos/aluno/${params.alunoId}`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data?.error?.message || 'Erro ao carregar dados');
        }
        const payload = await res.json();
        setAluno(payload.data.aluno);
        setCobrancas(payload.data.cobrancas || []);
        setResumo(payload.data.resumo);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro desconhecido');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [params.alunoId]);

  // ─── Loading ─────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="max-w-6xl mx-auto py-8 px-4 space-y-8">
        <Skeleton className="h-5 w-24" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Skeleton className="h-14 w-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-52" />
              <Skeleton className="h-4 w-36" />
            </div>
          </div>
          <div className="flex gap-3">
            <Skeleton className="h-20 w-44 rounded-2xl" />
            <Skeleton className="h-20 w-36 rounded-2xl" />
          </div>
        </div>
        <Skeleton className="h-14 w-full rounded-xl" />
        {[1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-48 w-full rounded-xl" />
          </div>
        ))}
      </div>
    );
  }

  // ─── Error ───────────────────────────────────────────────────────────────

  if (error || !aluno) {
    return (
      <div className="max-w-6xl mx-auto py-8 px-4">
        <button
          onClick={() => router.back()}
          className="mb-6 flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Voltar
        </button>
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-lg font-medium text-gray-900 mb-1">Erro ao carregar dados</p>
          <p className="text-sm text-gray-500">{error || 'Aluno não encontrado'}</p>
        </div>
      </div>
    );
  }

  // ─── Filtros ─────────────────────────────────────────────────────────────

  const filtradas = cobrancas.filter((c) => {
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      const tipo = TIPO_LABELS[c.tipo ?? ''] ?? c.tipo ?? '';
      const desc = c.description ?? '';
      const forma = resolveForma(c);
      if (
        !tipo.toLowerCase().includes(q) &&
        !desc.toLowerCase().includes(q) &&
        !forma.toLowerCase().includes(q)
      )
        return false;
    }

    const dataRef = resolveDataExibida(c);
    if (dataInicio && dataRef) {
      if (new Date(dataRef) < new Date(dataInicio + 'T00:00:00')) return false;
    }
    if (dataFim && dataRef) {
      if (new Date(dataRef) > new Date(dataFim + 'T23:59:59')) return false;
    }

    if (statusFilter !== 'TODOS') {
      const s = c.pagamento ? c.pagamento.status : c.status;
      if (s !== statusFilter) return false;
    }

    if (tipoFilter !== 'TODOS') {
      if ((c.tipo ?? c.chargeType) !== tipoFilter) return false;
    }

    if (formaFilter !== 'TODOS') {
      const f = c.pagamento?.formaPagamento ?? c.billingType ?? '';
      if (f !== formaFilter) return false;
    }

    return true;
  });

  const totalPagoFiltrado = filtradas.reduce(
    (sum, c) => sum + (c.pagamento ? c.pagamento.valorPago : 0),
    0,
  );
  const totalFiltrado = filtradas.length;
  const filtrosAtivos = [
    Boolean(searchTerm.trim()),
    Boolean(dataInicio),
    Boolean(dataFim),
    statusFilter !== 'TODOS',
    tipoFilter !== 'TODOS',
    formaFilter !== 'TODOS',
  ].filter(Boolean).length;

  const chipsFiltros = [
    searchTerm.trim() ? `Busca: ${searchTerm.trim()}` : null,
    dataInicio ? `De: ${formatDateInput(dataInicio)}` : null,
    dataFim ? `Até: ${formatDateInput(dataFim)}` : null,
    statusFilter !== 'TODOS'
      ? STATUS_OPTIONS.find((option) => option.value === statusFilter)?.label ?? statusFilter
      : null,
    tipoFilter !== 'TODOS'
      ? TIPO_OPTIONS.find((option) => option.value === tipoFilter)?.label ?? tipoFilter
      : null,
    formaFilter !== 'TODOS'
      ? FORMA_OPTIONS.find((option) => option.value === formaFilter)?.label ?? formaFilter
      : null,
  ].filter(Boolean) as string[];

  // Agrupar por tipo
  const grupos = new Map<string, Cobranca[]>();
  for (const c of filtradas) {
    const grupo = resolveGrupo(c);
    if (!grupos.has(grupo)) grupos.set(grupo, []);
    grupos.get(grupo)!.push(c);
  }

  // Ordenar grupos
  const gruposOrdenados = Array.from(grupos.entries()).sort(([a], [b]) => {
    const ia = GRUPO_ORDER.indexOf(a);
    const ib = GRUPO_ORDER.indexOf(b);
    return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
  });

  // ─── Exportação ──────────────────────────────────────────────────────────

  const exportarCSV = () => {
    const headers = ['Tipo', 'Descrição', 'Valor', 'Vencimento', 'Data Pagamento', 'Forma', 'Status'];
    const rows = filtradas.map((c) => [
      TIPO_LABELS[c.tipo ?? ''] ?? c.tipo ?? '',
      c.description ?? '',
      formatCurrency(resolveValorExibido(c)),
      formatDate(c.vencimento),
      formatDate(c.pagamento?.dataPagamento ?? null),
      resolveForma(c),
      c.pagamento ? c.pagamento.status : c.status,
    ]);
    const csv = [headers, ...rows].map((r) => r.map((v) => `"${v}"`).join(',')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pagamentos-${aluno.nome.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto py-8 px-4 pb-16 space-y-8">
      {/* Voltar + Cabeçalho */}
      <div className="space-y-6">
        <button
          onClick={() => router.back()}
          className="group flex items-center gap-2 text-[13px] font-medium text-slate-500 transition-colors hover:text-slate-900"
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-white transition-colors group-hover:border-slate-300">
            <ArrowLeft className="h-3.5 w-3.5" />
          </div>
          Voltar para listagem
        </button>

        <div className="flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-5">
            <div>
              <Avatar className="h-16 w-16 border-2 border-white">
                <AvatarImage src={aluno.foto || undefined} alt={aluno.nome} className="object-cover" />
                <AvatarFallback className="bg-[linear-gradient(135deg,#9333ea_0%,#7c3aed_100%)] text-white text-xl font-bold">
                  {getInitials(aluno.nome)}
                </AvatarFallback>
              </Avatar>
            </div>
            <div className="space-y-1">
              <h1 className="text-[24px] font-bold tracking-tight text-slate-900">Histórico de Pagamento</h1>
              <div className="flex items-center gap-2 text-[14px] text-slate-500">
                <span className="font-semibold text-slate-700">{aluno.nome}</span>
                {aluno.cpf && (
                  <>
                    <span className="h-1 w-1 rounded-full bg-slate-300" />
                    <span>{aluno.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4')}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex min-w-[120px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8a7ab0]">Total Pago</span>
              <span className="text-[18px] font-semibold tracking-tight text-[#2b2634]">{formatCurrency(totalPagoFiltrado)}</span>
            </div>
            
            <div className="flex min-w-[120px] flex-col justify-between rounded-2xl bg-[#f4ecfd] px-5 py-4">
              <span className="text-[10px] font-bold uppercase tracking-wider text-[#8a7ab0]">Lançamentos</span>
              <div className="flex items-baseline gap-1.5 text-[#2b2634]">
                <span className="text-[18px] font-semibold tracking-tight">{totalFiltrado}</span>
                {resumo && resumo.total !== totalFiltrado && (
                  <span className="text-[12px] font-medium text-[#8a7ab0]">/ {resumo.total}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Filtros */}
      <div className="rounded-2xl border border-gray-200 bg-white p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="relative">
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Buscar por tipo, descrição ou forma de pagamento..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="h-10 border border-gray-300 bg-white pl-10 pr-10 text-[13px] shadow-none"
              />
              {searchTerm ? (
                <button
                  type="button"
                  onClick={() => setSearchTerm('')}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 transition-colors hover:text-slate-700"
                  aria-label="Limpar busca"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : null}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap lg:shrink-0">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-[13px] text-gray-700 shadow-none lg:min-w-[170px]">
                  <SelectValue placeholder="Todos status" />
                </SelectTrigger>
                <SelectContent align="end">
                  {STATUS_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-10 rounded-md border border-gray-300 bg-white px-4 text-[13px] text-gray-700 shadow-none hover:bg-gray-50"
                  >
                    <Filter className="mr-2 h-4 w-4" />
                    Filtros
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-[360px] rounded-2xl border-slate-200 p-4 shadow-[0_20px_60px_rgba(15,23,42,0.12)]">
                  <div className="flex flex-col gap-4">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">Refinar histórico</p>
                      <p className="text-xs text-slate-500">Filtre por período, status, tipo e forma.</p>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-slate-500">Data inicial</label>
                        <DatePicker
                          variant="input"
                          value={toDateValue(dataInicio)}
                          onChange={(date) => setDataInicio(toIsoDate(date))}
                          placeholder="dd/mm/aaaa"
                          className="h-10 border-slate-200 text-[13px]"
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-slate-500">Data final</label>
                        <DatePicker
                          variant="input"
                          value={toDateValue(dataFim)}
                          onChange={(date) => setDataFim(toIsoDate(date))}
                          placeholder="dd/mm/aaaa"
                          className="h-10 border-slate-200 text-[13px]"
                        />
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-slate-500">Tipo de cobrança</label>
                        <Select value={tipoFilter} onValueChange={setTipoFilter}>
                          <SelectTrigger className="h-10 border-slate-200 text-[13px]">
                            <SelectValue placeholder="Todos tipos" />
                          </SelectTrigger>
                          <SelectContent>
                            {TIPO_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <label className="text-xs font-medium text-slate-500">Forma de pagamento</label>
                        <Select value={formaFilter} onValueChange={setFormaFilter}>
                          <SelectTrigger className="h-10 border-slate-200 text-[13px]">
                            <SelectValue placeholder="Todas formas" />
                          </SelectTrigger>
                          <SelectContent>
                            {FORMA_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    {filtrosAtivos > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-10 w-full rounded-xl text-[13px] text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                        onClick={() => {
                          setSearchTerm('');
                          setDataInicio('');
                          setDataFim('');
                          setStatusFilter('TODOS');
                          setTipoFilter('TODOS');
                          setFormaFilter('TODOS');
                        }}
                      >
                        Limpar filtros
                      </Button>
                    ) : null}
                  </div>
                </PopoverContent>
              </Popover>

              <Button
                type="button"
                variant="outline"
                title="Exportar CSV"
                className="h-10 rounded-md border border-gray-300 bg-white px-4 text-[13px] text-gray-700 shadow-none hover:bg-gray-50"
                onClick={exportarCSV}
              >
                <Download className="mr-2 h-4 w-4" />
                Exportar CSV
              </Button>

              <Button
                type="button"
                title="Exportar comprovantes pagos"
                className="h-10 rounded-md bg-[#5c2f91] px-4 text-[13px] text-white shadow-none hover:bg-[#4b2478]"
                onClick={() => setExportReceiptsOpen(true)}
              >
                <Receipt className="mr-2 h-4 w-4" />
                Comprovantes
              </Button>
          </div>
        </div>

        <div className="mt-4 flex min-h-6 flex-wrap items-center gap-2">
          {chipsFiltros.length > 0 ? (
            chipsFiltros.map((chip) => (
              <span
                key={chip}
                className="inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-xs font-medium text-violet-700"
              >
                {chip}
              </span>
            ))
          ) : (
            <p className="text-xs text-slate-500">
              Use os filtros para refinar o histórico por período, tipo, forma ou status.
            </p>
          )}
        </div>
      </div>

      {/* Conteúdo */}
      {filtradas.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <p className="text-sm text-gray-500">
            {cobrancas.length === 0
              ? 'Nenhum pagamento encontrado para este aluno.'
              : 'Nenhum resultado com os filtros selecionados.'}
          </p>
        </div>
      ) : (
        <div className="space-y-8">
          {gruposOrdenados.map(([grupo, items]) => (
            <GrupoCobrancas
              key={grupo}
              label={GRUPO_LABELS[grupo] ?? TIPO_LABELS[grupo] ?? grupo}
              items={items}
              onVerDetalhe={(cobranca) => router.push(`/cobrancas/${cobranca.sourceId}`)}
            />
          ))}
        </div>
      )}

      <ExportPaidReceiptsDialog
        open={exportReceiptsOpen}
        onOpenChange={setExportReceiptsOpen}
        aluno={aluno}
        items={cobrancas}
      />
    </div>
  );
}

// ─── Sub-componentes ─────────────────────────────────────────────────────────

function GrupoCobrancas({
  label,
  items,
  onVerDetalhe,
}: {
  label: string;
  items: Cobranca[];
  onVerDetalhe: (_cobranca: Cobranca) => void;
}) {
  const totalGrupo = items.reduce((sum, c) => sum + (c.pagamento ? c.pagamento.valorPago : 0), 0);
  const pagas = items.filter(
    (c) => ['PAGO', 'CONFIRMADO', 'CONFIRMED', 'RECEIVED'].includes(c.pagamento?.status ?? c.status),
  ).length;

  return (
    <section>
      {/* Cabeçalho do grupo */}
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-3">
          <h2 className="text-[13px] font-semibold text-gray-800 uppercase tracking-wider">
            {label}
          </h2>
          <span className="text-[11px] bg-gray-100 text-gray-500 rounded-full px-2 py-0.5">
            {items.length} {items.length === 1 ? 'cobrança' : 'cobranças'}
          </span>
          {pagas > 0 && (
            <span className="text-[11px] bg-emerald-50 text-emerald-700 rounded-full px-2 py-0.5">
              {pagas} paga{pagas > 1 ? 's' : ''}
            </span>
          )}
        </div>
        {totalGrupo > 0 && (
          <span className="text-[13px] font-semibold text-gray-700">
            {formatCurrency(totalGrupo)}
          </span>
        )}
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        {/* Header fixo */}
        <div className="grid grid-cols-[minmax(0,1fr)_120px_120px_130px_120px_44px] gap-0 border-b border-gray-100 bg-gray-50 px-5 py-2.5">
          {['Descrição', 'Valor', 'Vencimento', 'Data pag.', 'Status', ''].map((h) => (
            <span key={h} className="text-[11px] font-medium text-gray-400 uppercase tracking-wide">
              {h}
            </span>
          ))}
        </div>

        {/* Linhas */}
        <div className="divide-y divide-gray-100">
          {items.map((c) => (
            <CobrancaRow key={c.id} cobranca={c} onVerDetalhe={onVerDetalhe} />
          ))}
        </div>
      </div>
    </section>
  );
}

function CobrancaRow({
  cobranca: c,
  onVerDetalhe,
}: {
  cobranca: Cobranca;
  onVerDetalhe: (_cobranca: Cobranca) => void;
}) {
  const status = resolveStatus(c);
  const valor = resolveValorExibido(c);

  const paga = ['PAGO', 'CONFIRMADO', 'CONFIRMED', 'RECEIVED', 'PAGO'].includes(
    c.pagamento?.status ?? '',
  );

  return (
    <div
      className="group grid grid-cols-[minmax(0,1fr)_120px_120px_130px_120px_44px] items-center gap-0 px-5 py-3 transition-colors hover:bg-gray-50/60"
    >
      {/* Descrição */}
      <div className="min-w-0 pr-4">
        <p className="text-[13px] text-gray-900 truncate leading-snug">
          {c.description || TIPO_LABELS[c.tipo ?? ''] || c.tipo || '—'}
        </p>
        {c.installmentCount && (
          <p className="text-[11px] text-gray-400 mt-0.5">
            {c.installmentsPaid ?? 0}/{c.installmentCount} parcelas pagas
          </p>
        )}
        {c.isGroup && !c.installmentCount && (
          <p className="text-[11px] text-gray-400 mt-0.5">Agrupado</p>
        )}
      </div>

      {/* Valor */}
      <div className={cn('text-[13px] font-semibold', paga ? 'text-emerald-700' : 'text-gray-900')}>
        {formatCurrency(valor)}
      </div>

      {/* Vencimento */}
      <div className="text-[13px] text-gray-500">{formatDate(c.vencimento)}</div>

      {/* Data de pagamento */}
      <div className="text-[13px] text-gray-700">
        {c.pagamento?.dataPagamento ? (
          <span>{formatDate(c.pagamento.dataPagamento)}</span>
        ) : (
          <span className="text-gray-400">—</span>
        )}
      </div>

      {/* Status */}
      <div>
        <Badge status={status} size="sm" />
      </div>

      {/* Ação */}
      <div className="flex justify-end">
        {c.sourceKind === 'cobranca' ? (
          <button
            onClick={() => onVerDetalhe(c)}
            className="p-1.5 rounded-lg text-gray-300 hover:text-purple-600 hover:bg-purple-50 transition-colors opacity-0 group-hover:opacity-100"
            title="Ver detalhes"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        ) : null}
      </div>
    </div>
  );
}
