'use client';

import { useCallback, useEffect, useState, useRef } from 'react';
import type { ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft as ArrowLeft, Edit } from '@/components/icons/icons';
import { EllipsisVerticalIcon as MoreVertical } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui/button';
import { InfoCallout, InfoCalloutLink } from '@/components/ui/info-callout';
import { Skeleton } from '@/components/ui/skeleton';
import { pushToast } from '@/components/ui/toast';
import { Badge, formatStatusLabel, type StatusType } from '@/components/ui/badge';
import { StatusCobranca } from '@prisma/client';
import { useChargeActions } from '@/hooks/use-charge-actions';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CobrancaCompartilharButton } from '@/components/financeiro/CobrancaCompartilharButton';
import { CobrancaArquivos } from '@/components/financeiro/CobrancaArquivos';
import { AsaasSeal } from '@/components/shared/AsaasSeal';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  FORMA_PAGAMENTO_LABELS,
  TIPO_COBRANCA_LABELS,
  validateDate,
  dateToISO,
  isoToDate,
} from '@/lib/finance/asaas-sync';
import {
  formatDecimalFromNumber,
  maskPercentInput,
  parseDecimal,
} from '@/lib/utils/decimal-format';
import { cn } from '@/lib/utils';
import { useFinanceLiveRefresh } from '@/features/financeiro/hooks/useFinanceLiveRefresh';
import {
  isCobrancaDetailTerminal,
  useCobrancaDetailQuery,
} from '@/hooks/use-cobranca-detail-query';

const DETAIL_SECTION_MAX = 'mx-auto w-full max-w-4xl';

const sectionClass = cn(
  'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4',
  DETAIL_SECTION_MAX,
);
const labelClass = 'text-xs font-medium text-slate-600';

// Funções para formatação de moeda BRL
function formatBRL(value: number): string {
  const valueInCents = Math.round(value * 100);
  const digits = String(valueInCents).padStart(3, '0');
  let intPart = digits.slice(0, -2);
  const decPart = digits.slice(-2);
  // Remove zeros à esquerda da parte inteira, mas mantém "0" se vazio
  intPart = intPart.replace(/^0+(?!$)/, '');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFormatted},${decPart}`;
}

function formatBRLInput(input: string): string {
  const digits = input.replace(/\D/g, '');
  if (!digits) return '';
  const padded = digits.padStart(3, '0');
  let intPart = padded.slice(0, -2);
  const decPart = padded.slice(-2);
  intPart = intPart.replace(/^0+(?!$)/, '');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${intFormatted},${decPart}`;
}

function parseBRL(display: string): number {
  if (!display) return 0;
  const normalized = display.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString('pt-BR');
}

// Mapeamento de StatusCobranca para StatusType
const statusMap: Record<StatusCobranca, StatusType> = {
  PENDENTE: 'PENDENTE',
  A_VENCER: 'A_VENCER',
  PROCESSANDO: 'PROCESSANDO',
  PAGO: 'PAGO',
  ATRASADO: 'ATRASADO',
  CANCELADO: 'CANCELADO',
  CANCELAMENTO_PENDENTE: 'CANCELAMENTO_PENDENTE',
  ESTORNADO: 'ESTORNADO',
  ESTORNADO_PARCIAL: 'ESTORNADO_PARCIAL',
};

type CobrancaDetalhes = {
  id: string;
  tipo: string;
  status: StatusCobranca;
  valor: number;
  installmentPlanId?: string | null;
  subscriptionId?: string | null;
  vencimento: string;
  dataPagamento?: string | null;
  descricao?: string;
  formaPagamento: string;
  atrasado: boolean;
  asaasPaymentId?: string | null;

  // Campos Asaas (snapshot - fonte da verdade via webhook)
  valorBruto?: number;
  valorLiquido?: number | null;
  taxaAsaas?: number | null;
  liquidacaoStatus?: 'NAO_APLICAVEL' | 'PENDENTE' | 'DISPONIVEL' | null;
  displayStatus?: { label: string; hint: string | null };

  // Juros
  jurosPercentual?: number;
  jurosValorFixo?: number;
  juros?: number;

  // Multa
  multaTipo?: string;
  multaPercentual?: number;
  multaValorFixo?: number;
  multa?: number;

  // Desconto
  descontoTipo?: string;
  descontoPercentual?: number;
  descontoValorFixo?: number;
  descontoPrazoMaximo?: string;
  desconto?: number;

  valorFinal?: number;
  matricula: {
    id: string;
    codigo: string;
    aluno: {
      id: string;
      nome: string;
      cpf?: string;
      email?: string;
      telefone?: string;
      responsavelFinanceiro?: {
        id: string;
        nome: string;
        cpf: string;
        email: string;
        telefone: string;
      };
    };
    plano: {
      id: string;
      nome: string;
      periodicidade: string;
    };
    combo?: {
      id: string;
      nome: string;
    };
  };
  pagamentos: Array<{
    id: string;
    dataPagamento?: string;
    formaPagamento: string;
    valorPago: number;
    status: string;
    comprovante?: string | null;
    createdAt: string;
  }>;
  asaasData?: Record<string, unknown>;
};

type OfficialChargeLinks = {
  invoiceUrl: string | null;
  bankSlipUrl: string | null;
  transactionReceiptUrl: string | null;
};

function resolveOfficialLinksFromCharge(cobranca: CobrancaDetalhes | null): OfficialChargeLinks {
  return {
    invoiceUrl:
      typeof cobranca?.asaasData?.invoiceUrl === 'string' && cobranca.asaasData.invoiceUrl
        ? cobranca.asaasData.invoiceUrl
        : null,
    bankSlipUrl:
      typeof cobranca?.asaasData?.bankSlipUrl === 'string' && cobranca.asaasData.bankSlipUrl
        ? cobranca.asaasData.bankSlipUrl
        : null,
    transactionReceiptUrl:
      typeof cobranca?.asaasData?.transactionReceiptUrl === 'string' && cobranca.asaasData.transactionReceiptUrl
        ? cobranca.asaasData.transactionReceiptUrl
        : null,
  };
}

function openOfficialChargeLink(links: OfficialChargeLinks): boolean {
  const url = links.transactionReceiptUrl || links.invoiceUrl || links.bankSlipUrl;
  if (!url) return false;
  window.open(url, '_blank', 'noopener,noreferrer');
  return true;
}

export function CobrancaDetalhesClient({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [cobranca, setCobranca] = useState<CobrancaDetalhes | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Estados de edição separados
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isEditingAjustes, setIsEditingAjustes] = useState(false);
  const [isSavingAjustes, setIsSavingAjustes] = useState(false);
  const [isResendingAsaas, setIsResendingAsaas] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRefunding, setIsRefunding] = useState(false);
  const [showRemoveDialog, setShowRemoveDialog] = useState(false);
  const [showRefundDialog, setShowRefundDialog] = useState(false);
  const [awaitingWebhook, setAwaitingWebhook] = useState(false);

  const detailQuery = useCobrancaDetailQuery(id, { awaitingWebhookBurst: awaitingWebhook });

  // Estados para campos editáveis da cobrança
  const [editValor, setEditValor] = useState(0);
  const [editValorDisplay, setEditValorDisplay] = useState('0,00');
  const valorTypingRef = useRef(false);
  
  const [editVencimento, setEditVencimento] = useState('');
  const [editVencimentoDisplay, setEditVencimentoDisplay] = useState('');
  const [editDescricao, setEditDescricao] = useState('');
  const [editFormaPagamento, setEditFormaPagamento] = useState('');

  // Estados para ajustes financeiros - Juros
  const [editJurosPercentual, setEditJurosPercentual] = useState('0,00');

  // Estados para ajustes financeiros - Multa
  const [editMultaTipo, setEditMultaTipo] = useState('VALOR_FIXO');
  const [editMultaPercentual, setEditMultaPercentual] = useState('0,00');

  // Estados para ajustes financeiros - Desconto
  const [editDescontoTipo, setEditDescontoTipo] = useState('VALOR_FIXO');
  const [editDescontoPercentual, setEditDescontoPercentual] = useState('0,00');
  const [editDescontoValorFixo, setEditDescontoValorFixo] = useState(0);
  const [editDescontoValorFixoDisplay, setEditDescontoValorFixoDisplay] = useState('0,00');
  const descontoTypingRef = useRef(false);
  const [editDescontoDias, setEditDescontoDias] = useState(0);

  const formatAdjustNumber = (value?: number | null) => formatDecimalFromNumber(value ?? 0);
  const formatPercentInputChange = (inputValue: string) => maskPercentInput(inputValue) || '0,00';

  const chargeStatus = cobranca?.status ?? 'PENDENTE';
  const wasReceivedInCash = cobranca?.asaasData?.status === 'RECEIVED_IN_CASH';
  const chargeActions = useChargeActions(chargeStatus, { wasReceivedInCash });

  const applyCobrancaPayload = useCallback((data: CobrancaDetalhes) => {
    setCobranca(data);

    const asaasDataRec = data.asaasData as Record<string, unknown> | null;
    const asaasOriginalValue =
      typeof asaasDataRec?.originalValue === 'number' ? asaasDataRec.originalValue : null;

    const valorBase =
      data.status === 'PAGO' && asaasOriginalValue != null
        ? asaasOriginalValue
        : Number(data.valor ?? 0);

    setEditValor(valorBase);
    setEditValorDisplay(formatBRL(valorBase));

    const isoVencimento = data.vencimento.split('T')[0];
    setEditVencimento(isoVencimento);
    setEditVencimentoDisplay(isoToDate(isoVencimento));
    setEditDescricao(data.descricao || '');
    setEditFormaPagamento(data.formaPagamento || '');

    setEditJurosPercentual(formatAdjustNumber(data.jurosPercentual));
    setEditMultaTipo(data.multaTipo || 'VALOR_FIXO');
    setEditMultaPercentual(formatAdjustNumber(data.multaPercentual));
    setEditDescontoTipo(data.descontoTipo || 'VALOR_FIXO');
    setEditDescontoPercentual(formatAdjustNumber(data.descontoPercentual));

    const descontoValorInicial = Number(data.descontoValorFixo ?? 0);
    setEditDescontoValorFixo(descontoValorInicial);
    setEditDescontoValorFixoDisplay(formatBRL(descontoValorInicial));

    if (data.descontoPrazoMaximo === 'ATE_VENCIMENTO') {
      setEditDescontoDias(0);
    } else if (data.descontoPrazoMaximo) {
      const match = data.descontoPrazoMaximo.match(/(\d+)_DIAS/);
      setEditDescontoDias(match ? parseInt(match[1], 10) : 0);
    } else {
      setEditDescontoDias(0);
    }
  }, []);

  const loadCobranca = useCallback(async () => {
    setError(null);
    const result = await detailQuery.refetch();
    if (result.error) {
      const errorMessage =
        result.error instanceof Error ? result.error.message : 'Erro ao carregar cobrança';
      setError(errorMessage);
      pushToast({
        title: 'Erro',
        description: errorMessage,
        variant: 'error',
      });
    }
  }, [detailQuery]);

  useEffect(() => {
    if (detailQuery.data) {
      applyCobrancaPayload(detailQuery.data as CobrancaDetalhes);
      setError(null);
    }
  }, [detailQuery.data, applyCobrancaPayload]);

  useEffect(() => {
    setLoading(detailQuery.isLoading && !detailQuery.data);
  }, [detailQuery.isLoading, detailQuery.data]);

  useEffect(() => {
    if (!detailQuery.error) return;
    const errorMessage =
      detailQuery.error instanceof Error ? detailQuery.error.message : 'Erro ao carregar cobrança';
    setError(errorMessage);
  }, [detailQuery.error]);

  useFinanceLiveRefresh(() => loadCobranca(), {
    enabled: Boolean(cobranca) && !isEditing && !isEditingAjustes,
    cobrancaId: id,
    realtime: { cobrancaQueries: false },
    intervalMs: awaitingWebhook ? 5_000 : 20_000,
    minIntervalMs: 4_000,
  });

  useEffect(() => {
    if (!awaitingWebhook || !cobranca?.status) return;
    if (isCobrancaDetailTerminal(cobranca.status)) {
      setAwaitingWebhook(false);
    }
  }, [awaitingWebhook, cobranca?.status]);

  const markAwaitingWebhook = useCallback(() => {
    setAwaitingWebhook(true);
  }, []);

  const handleEdit = () => {
    if (isEditing) {
      // Salvar alterações
      handleSaveEdit();
    } else {
      // Entrar em modo de edição
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    if (!cobranca) return;

    // Restaurar valores originais
    const valorOriginal = Number(cobranca.valor ?? 0);
    setEditValor(valorOriginal);
    setEditValorDisplay(formatBRL(valorOriginal));
    
    const isoVenc = cobranca.vencimento.split('T')[0];
    setEditVencimento(isoVenc);
    setEditVencimentoDisplay(isoToDate(isoVenc));
    setEditDescricao(cobranca.descricao || '');
    setEditFormaPagamento(cobranca.formaPagamento || '');

    setIsEditing(false);
  };

  const handleSaveEdit = async () => {
    if (!cobranca) return;

    setIsSaving(true);

    try {
      // Detectar se a forma de pagamento mudou
      const formaPagamentoMudou = editFormaPagamento !== cobranca.formaPagamento;

      // Se a forma de pagamento mudou, chamar rota específica para sincronizar com Asaas
      if (formaPagamentoMudou && cobranca.asaasPaymentId) {
        // Garantir que o valor enviado está no padrão do backend
        let formaPagamentoBackend = editFormaPagamento;
        if (formaPagamentoBackend === 'CREDIT_CARD') formaPagamentoBackend = 'CARTAO_CREDITO';
        if (formaPagamentoBackend === 'BOLETO') formaPagamentoBackend = 'BOLETO';
        if (formaPagamentoBackend === 'PIX') formaPagamentoBackend = 'PIX';
        if (formaPagamentoBackend === 'INDEFINIDO') formaPagamentoBackend = 'INDEFINIDO';

        const resFormaPagamento = await fetch(`/api/cobrancas/${cobranca.id}/forma-pagamento`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            formaPagamento: formaPagamentoBackend,
          }),
        });

        const resultFormaPagamento = await resFormaPagamento.json();

        if (!resultFormaPagamento.success) {
          throw new Error(resultFormaPagamento.error);
        }

        pushToast({
          title: 'Solicitação enviada',
          description:
            resultFormaPagamento.message ||
            'Alteração enviada para processamento financeiro da Alusa. Aguarde alguns instantes para a atualização refletir.',
          variant: 'success',
        });
      }

      // Atualizar outros campos (valor, vencimento, descrição)
      const dadosParaAtualizar: Record<string, unknown> = {};

      if (Math.abs(editValor - cobranca.valor) > 0.0001) {
        dadosParaAtualizar.valor = editValor;
      }

      if (editVencimento !== cobranca.vencimento.split('T')[0]) {
        dadosParaAtualizar.vencimento = editVencimento;
      }

      if (editDescricao !== (cobranca.descricao || '')) {
        dadosParaAtualizar.descricao = editDescricao || undefined;
      }

      // Se houver outros campos para atualizar além da forma de pagamento
      if (Object.keys(dadosParaAtualizar).length > 0) {
        const res = await fetch(`/api/cobrancas/${cobranca.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(dadosParaAtualizar),
        });

        const result = await res.json();

        if (!result.success) {
          throw new Error(result.error);
        }

        if (!formaPagamentoMudou) {
          pushToast({
            title: 'Solicitação enviada',
            description:
              result.message ||
              'Alteração enviada para processamento financeiro da Alusa. Aguarde alguns instantes para a atualização refletir.',
            variant: 'success',
          });
        }
      }

      setIsEditing(false);
      await loadCobranca(); // Recarregar dados
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({
        title: 'Erro ao salvar',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setIsSaving(false);
    }
  };

  // Funções para editar ajustes financeiros
  const handleEditAjustes = () => {
    if (isEditingAjustes) {
      // Salvar alterações de ajustes
      handleSaveAjustes();
    } else {
      // Entrar em modo de edição de ajustes
      setIsEditingAjustes(true);
    }
  };

  const handleCancelAjustes = () => {
    if (!cobranca) return;

    // Restaurar valores originais de juros
    setEditJurosPercentual(formatAdjustNumber(cobranca.jurosPercentual));

    // Restaurar valores originais de multa
    setEditMultaTipo(cobranca.multaTipo || 'VALOR_FIXO');
    setEditMultaPercentual(formatAdjustNumber(cobranca.multaPercentual));

    // Restaurar valores originais de desconto
    setEditDescontoTipo(cobranca.descontoTipo || 'VALOR_FIXO');
    setEditDescontoPercentual(formatAdjustNumber(cobranca.descontoPercentual));
    const descontoOriginal = Number(cobranca.descontoValorFixo ?? 0);
    setEditDescontoValorFixo(descontoOriginal);
    setEditDescontoValorFixoDisplay(formatBRL(descontoOriginal));
    
    // Restaurar prazo do desconto
    if (cobranca.descontoPrazoMaximo === 'ATE_VENCIMENTO') {
      setEditDescontoDias(0);
    } else if (cobranca.descontoPrazoMaximo) {
      const match = cobranca.descontoPrazoMaximo.match(/(\d+)_DIAS/);
      setEditDescontoDias(match ? parseInt(match[1]) : 0);
    } else {
      setEditDescontoDias(0);
    }

    setIsEditingAjustes(false);
  };

  const handleSaveAjustes = async () => {
    if (!cobranca) return;

    setIsSavingAjustes(true);

    try {
      // Parse de valores de juros
      const jurosPercentual = parseDecimal(editJurosPercentual);
      const jurosValorFixo = 0; // Não usado mais

      // Parse de valores de multa
      const multaTipo = editMultaTipo;
      const multaPercentual = parseDecimal(editMultaPercentual);
      const multaValorFixo = 0; // Não usado mais

      // Parse de valores de desconto
      const descontoTipo = editDescontoTipo;
      const descontoPercentual = parseDecimal(editDescontoPercentual);
      const descontoPrazoMaximo = editDescontoDias === 0 ? 'ATE_VENCIMENTO' : `${editDescontoDias}_DIAS`;

      const valorBase = cobranca.valor;

      // Calcular valores finais baseados no tipo
      const juros = jurosPercentual > 0 ? (valorBase * jurosPercentual) / 100 : jurosValorFixo;
      const multa =
        multaTipo === 'PERCENTUAL' ? (valorBase * multaPercentual) / 100 : multaValorFixo;
      const desconto =
        descontoTipo === 'PERCENTUAL' ? (valorBase * descontoPercentual) / 100 : editDescontoValorFixo;

      const valorFinal = valorBase + multa + juros - desconto;

      const res = await fetch(`/api/cobrancas/${cobranca.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // Juros
          jurosPercentual,
          jurosValorFixo,
          juros,
          // Multa
          multaTipo,
          multaPercentual,
          multaValorFixo,
          multa,
          // Desconto
          descontoTipo,
          descontoPercentual,
          descontoValorFixo: editDescontoValorFixo,
          descontoPrazoMaximo,
          desconto,
          // Valor final
          valorFinal,
        }),
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error);
      }

      pushToast({
        title: 'Sucesso',
        description: 'Ajustes financeiros atualizados com sucesso',
        variant: 'success',
      });

      setIsEditingAjustes(false);
      await loadCobranca(); // Recarregar dados
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({
        title: 'Erro ao salvar ajustes',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setIsSavingAjustes(false);
    }
  };

  async function fetchFreshOfficialLinks(): Promise<OfficialChargeLinks> {
    const response = await fetch(`/api/cobrancas/${id}?fresh=1`, { cache: 'no-store' });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(payload?.error || 'Erro ao buscar cobrança no Asaas');
    }

    const nextCobranca = payload.data as CobrancaDetalhes;
    setCobranca(nextCobranca);
    return resolveOfficialLinksFromCharge(nextCobranca);
  }

  async function syncOfficialLinks(): Promise<OfficialChargeLinks> {
    const response = await fetch(`/api/cobrancas/${id}/sync-asaas`, {
      method: 'POST',
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => ({}));

    if (!response.ok || !payload?.success) {
      throw new Error(payload?.error || 'Erro ao sincronizar cobrança com o Asaas');
    }

    await loadCobranca();
    return {
      invoiceUrl: typeof payload.invoiceUrl === 'string' && payload.invoiceUrl ? payload.invoiceUrl : null,
      bankSlipUrl: typeof payload.bankSlipUrl === 'string' && payload.bankSlipUrl ? payload.bankSlipUrl : null,
      transactionReceiptUrl:
        typeof payload.transactionReceiptUrl === 'string' && payload.transactionReceiptUrl
          ? payload.transactionReceiptUrl
          : null,
    };
  }

  const handleVisualizarFatura = async () => {
    if (!cobranca) return;

    // Se a cobrança está paga, verificar se há comprovante
    if (isPago && cobranca.pagamentos && cobranca.pagamentos.length > 0) {
      // Buscar o último pagamento confirmado
      const pagamentoConfirmado = cobranca.pagamentos.find(p => p.status === 'CONFIRMADO' || p.status === 'PAGO');
      
      if (pagamentoConfirmado) {
        // Se houver um comprovante no pagamento, abrir
        if (pagamentoConfirmado.comprovante) {
          window.open(pagamentoConfirmado.comprovante, '_blank');
          return;
        }
        
        // Se não houver comprovante, mas tem invoiceUrl do provedor, mostrar
        if (openOfficialChargeLink(resolveOfficialLinksFromCharge(cobranca))) {
          return;
        }

        try {
          const freshLinks = await fetchFreshOfficialLinks();
          if (openOfficialChargeLink(freshLinks)) return;

          if (cobranca.asaasPaymentId) {
            const syncedLinks = await syncOfficialLinks();
            if (openOfficialChargeLink(syncedLinks)) return;
          }
        } catch (error) {
          pushToast({
            title: 'Erro',
            description: error instanceof Error ? error.message : 'Falha ao buscar o comprovante oficial.',
            variant: 'error',
          });
          return;
        }
        
        // Se não houver nenhum comprovante disponível
        pushToast({
          title: 'Comprovante não disponível',
          description: `Pagamento realizado em ${formatDate(pagamentoConfirmado.dataPagamento || pagamentoConfirmado.createdAt)}. Comprovante não encontrado.`,
          variant: 'warning',
        });
        return;
      }
    }

    // Se não está paga, verificar se tem link de fatura do provedor
    if (!openOfficialChargeLink(resolveOfficialLinksFromCharge(cobranca))) {
      try {
        const freshLinks = await fetchFreshOfficialLinks();
        if (openOfficialChargeLink(freshLinks)) return;

        if (cobranca.asaasPaymentId) {
          const syncedLinks = await syncOfficialLinks();
          if (openOfficialChargeLink(syncedLinks)) return;
        }
      } catch (error) {
        pushToast({
          title: 'Erro',
          description: error instanceof Error ? error.message : 'Falha ao buscar a fatura oficial.',
          variant: 'error',
        });
        return;
      }

      // Cobrança não integrada com provedor de pagamentos
      if (!cobranca.asaasPaymentId) {
        pushToast({
          title: 'Fatura não disponível',
          description: 'Esta cobrança ainda não foi sincronizada com o provedor de pagamentos. Aguarde a sincronização automática ou entre em contato com o suporte.',
          variant: 'warning',
        });
      } else {
        pushToast({
          title: 'Erro',
          description: 'URL da fatura não disponível. Tente sincronizar a cobrança.',
          variant: 'error',
        });
      }
      return;
    }
  };

  const handleConfirmarRecebimento = async () => {
    if (!cobranca) return;

    try {
      const res = await fetch(`/api/cobrancas/${cobranca.id}/confirmar-recebimento`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          // ✅ Não enviar dataPagamento - deixar o backend usar a data correta no timezone de Brasília
          formaPagamentoManual: 'DINHEIRO',
        }),
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error);
      }

      pushToast({
        title: 'Sucesso',
        description: 'Recebimento confirmado com sucesso',
        variant: 'success',
      });

      markAwaitingWebhook();
      await loadCobranca();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({
        title: 'Erro',
        description: errorMessage,
        variant: 'error',
      });
    }
  };

  const handleEstornarPagamento = async () => {
    if (!cobranca) return;
    if (!cobranca.asaasPaymentId) {
      pushToast({
        title: 'Indisponível',
        description: 'Esta cobrança não possui vínculo com a plataforma financeira da Alusa.',
        variant: 'warning',
      });
      return;
    }

    setIsRefunding(true);

    try {
      const res = await fetch(`/api/cobrancas/${cobranca.id}/refund`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const result = await res.json().catch(() => ({}));

      if (!res.ok || !result.success) {
        throw new Error(result.error || result.message || 'Erro ao solicitar estorno');
      }

      pushToast({
        title: 'Solicitação enviada',
        description:
          result.message ||
          'Estorno solicitado. O status será atualizado automaticamente em instantes.',
        variant: 'success',
      });

      markAwaitingWebhook();
      await loadCobranca();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({
        title: 'Erro ao estornar',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setIsRefunding(false);
    }
  };

  const handleDesfazerRecebimento = async () => {
    if (!cobranca) return;
    if (!cobranca.asaasPaymentId) {
      pushToast({
        title: 'Indisponível',
        description: 'Esta cobrança não possui vínculo com a plataforma financeira da Alusa.',
        variant: 'warning',
      });
      return;
    }

    setIsRefunding(true);

    try {
      const res = await fetch(`/api/cobrancas/${cobranca.id}/undo-receive-in-cash`, {
        method: 'POST',
      });

      const result = await res.json().catch(() => ({}));

      if (!res.ok || !result.success) {
        throw new Error(result.error || result.message || 'Erro ao desfazer recebimento');
      }

      pushToast({
        title: 'Solicitação enviada',
        description:
          result.message ||
          'Desfazer recebimento solicitado. O status será atualizado automaticamente em instantes.',
        variant: 'success',
      });

      await loadCobranca();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({
        title: 'Erro ao desfazer recebimento',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setIsRefunding(false);
    }
  };

  // Reenviar cobrança (reobtém links oficiais do Asaas)
  const handleResendCobranca = async () => {
    if (!cobranca) return;

    setIsResendingAsaas(true);

    try {
      const res = await fetch(`/api/cobrancas/${cobranca.id}/asaas-notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tipo: 'EMAIL' }),
      });

      const result = await res.json();

      if (!res.ok || !result.success) {
        throw new Error(result.message || result.error || 'Erro ao reenviar cobrança');
      }

      pushToast({
        title: 'Cobrança reenviada',
        description: result.message || 'Os links oficiais da cobrança foram atualizados com sucesso.',
        variant: 'success',
      });

      const invoiceUrl = result.invoiceUrl || result.bankSlipUrl;
      if (invoiceUrl) {
        window.open(invoiceUrl, '_blank');
      }

      await loadCobranca();
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({
        title: 'Erro ao reenviar',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setIsResendingAsaas(false);
    }
  };

  const handleRemoverCobranca = async () => {
    if (!cobranca) return;

    const statusRemoveveis = ['PENDENTE', 'A_VENCER', 'ATRASADO'];
    if (!statusRemoveveis.includes(cobranca.status)) {
      pushToast({
        title: 'Erro',
        description: 'Apenas cobranças pendentes, a vencer ou atrasadas podem ser removidas',
        variant: 'error',
      });
      setShowRemoveDialog(false);
      return;
    }

    setIsRemoving(true);

    try {
      const res = await fetch(`/api/cobrancas/${cobranca.id}`, {
        method: 'DELETE',
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error);
      }

      pushToast({
        title: 'Sucesso',
        description: cobranca.asaasPaymentId 
          ? 'Cobrança removida com sucesso do sistema e do provedor de pagamentos' 
          : 'Cobrança removida com sucesso',
        variant: 'success',
      });

      router.push('/financeiro/cobrancas'); // Voltar para listagem
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Erro desconhecido';
      pushToast({
        title: 'Erro',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setIsRemoving(false);
      setShowRemoveDialog(false);
    }
  };

  const formatDate = (date: string) => {
    return new Intl.DateTimeFormat('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    }).format(new Date(date));
  };

  const getTipoLabel = (tipo: string) => {
    return TIPO_COBRANCA_LABELS[tipo] || tipo;
  };

  // Nota: validação de data removida (não utilizada) para evitar erro de lint/ts

  // Handler para input de vencimento com máscara DD/MM/AAAA e atualização do ISO quando completo
  const handleVencimentoChange = (e: ChangeEvent<HTMLInputElement>) => {
    const onlyDigits = String(e.target.value || '')
      .replace(/\D/g, '')
      .slice(0, 8);
    let display = onlyDigits;
    if (display.length >= 3 && display.length <= 4) {
      display = `${display.slice(0, 2)}/${display.slice(2)}`;
    } else if (display.length >= 5) {
      display = `${display.slice(0, 2)}/${display.slice(2, 4)}/${display.slice(4)}`;
    }
    setEditVencimentoDisplay(display);

    if (onlyDigits.length === 8) {
      const candidate = `${onlyDigits.slice(0, 2)}/${onlyDigits.slice(2, 4)}/${onlyDigits.slice(4)}`;
      if (validateDate(candidate)) {
        const iso = dateToISO(candidate);
        if (iso) setEditVencimento(iso);
      }
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-full min-w-0 px-4 py-6 pb-8">
          <div className={cn(DETAIL_SECTION_MAX, 'mb-8 space-y-4')}>
            <Skeleton className="h-10 w-32" />
            <Skeleton className="h-9 w-96 max-w-full" />
            <Skeleton className="h-5 w-80" />
          </div>
          <div className="space-y-8">
            {[1, 2].map((i) => (
              <div key={i} className={sectionClass}>
                <Skeleton className="h-5 w-64 mb-4" />
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  {[1, 2, 3, 4].map((j) => (
                    <div key={j}>
                      <Skeleton className="h-4 w-24 mb-2" />
                      <Skeleton className="h-10 w-full" />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !cobranca) {
    return (
      <div className="h-full overflow-y-auto">
        <div className="w-full min-w-0 px-4 py-6 pb-8">
          <div className={DETAIL_SECTION_MAX}>
            <button
              type="button"
              onClick={() => router.back()}
              className="mb-6 flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900"
            >
              <ArrowLeft className="h-4 w-4 shrink-0" />
              Voltar
            </button>
            <div className={sectionClass}>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <div className="flex items-center justify-center w-20 h-20 mb-6 bg-red-100 rounded-full">
                  <span className="text-4xl">⚠️</span>
                </div>
                <h2 className="text-2xl font-bold text-gray-900 mb-2">Erro ao carregar cobrança</h2>
                <p className="text-base text-gray-600 mb-8 max-w-md">
                  {error || 'A cobrança solicitada não foi encontrada ou não está acessível no momento'}
                </p>
                <div className="flex items-center gap-3">
                  <Button variant="outline" onClick={() => router.back()} className="h-10 px-4 border-gray-300 text-gray-700 hover:bg-gray-50">Voltar</Button>
                  <Button onClick={loadCobranca} className="h-10 px-4 bg-brand-accent hover:bg-brand-accent/90 text-white">Tentar novamente</Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const isPago = cobranca.status === 'PAGO';
  const isPendente = cobranca.status === 'PENDENTE' || cobranca.status === 'A_VENCER';
  
  // URL de fatura é usado para compartilhamento
  const invoiceUrl = cobranca.asaasData?.invoiceUrl as string | undefined;

  return (
    <div className="h-full overflow-y-auto">
      <div className="w-full min-w-0 px-4 py-6 pb-8">
        {/* Header com espaçamento consistente */}
        <div className={cn(DETAIL_SECTION_MAX, 'mb-8')}>
        <button
          type="button"
          onClick={() => router.back()}
          className="mb-4 flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 sm:mb-5"
        >
          <ArrowLeft className="h-4 w-4 shrink-0" />
          Voltar
        </button>

        {/* Banner: Faz parte de um parcelamento */}
        {cobranca.tipo === 'PARCELADA' && cobranca.installmentPlanId && (
          <InfoCallout showIcon className="mb-4 sm:mb-5">
            Esta cobrança faz parte de um parcelamento.{' '}
            <InfoCalloutLink href={`/cobrancas/parcelamentos/${cobranca.installmentPlanId}`}>
              Ver parcelamento completo
            </InfoCalloutLink>
          </InfoCallout>
        )}

        {/* Banner: Gerada por uma assinatura */}
        {(cobranca.tipo === 'MENSALIDADE' || cobranca.tipo === 'RECORRENTE') && cobranca.subscriptionId && (
          <InfoCallout variant="brand" showIcon className="mb-4 sm:mb-5">
            Esta cobrança foi gerada por uma assinatura.{' '}
            <InfoCalloutLink
              calloutVariant="brand"
              href={`/cobrancas/assinaturas/${cobranca.subscriptionId}`}
            >
              Ver assinatura
            </InfoCalloutLink>
          </InfoCallout>
        )}

        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
          <div className="min-w-0 flex-1">
            <h1 className="mb-2 text-3xl font-bold leading-tight text-gray-900">
              Detalhes da Cobrança
            </h1>
            <p className="mt-2 break-all font-mono text-xs text-gray-600 sm:text-sm">ID: {cobranca.id}</p>
          </div>

          <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch lg:w-auto lg:flex-initial lg:items-center lg:justify-end">
            {/* Botão Editar/Salvar - Apenas se pendente */}
            {isPendente && (
              <>
                {isEditing ? (
                  <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:flex-wrap sm:gap-3">
                    <Button
                      variant="outline"
                      onClick={handleCancelEdit}
                      disabled={isSaving}
                      className="h-10 w-full justify-center border-gray-300 px-4 text-gray-700 hover:bg-gray-50 sm:w-auto"
                    >
                      Cancelar
                    </Button>
                    <Button
                      onClick={handleEdit}
                      disabled={isSaving}
                      className="h-10 w-full justify-center bg-brand-accent px-4 text-white hover:bg-brand-accent/90 sm:w-auto"
                    >
                      {isSaving ? (
                        <>
                          <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                          Salvando...
                        </>
                      ) : (
                        <>
                          <Edit className="mr-2 h-4 w-4" />
                          Salvar
                        </>
                      )}
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    onClick={handleEdit}
                    className="h-10 w-full justify-center border-gray-300 px-4 text-gray-700 hover:bg-gray-50 sm:w-auto"
                  >
                    <Edit className="mr-2 h-4 w-4" />
                    Editar
                  </Button>
                )}
              </>
            )}

            {/* Botão Visualizar Comprovante (quando pago) */}
            {!isEditing && isPago && (
              <Button
                onClick={handleVisualizarFatura}
                className="h-10 w-full justify-center bg-green-600 px-4 text-white hover:bg-green-700 sm:w-auto"
              >
                <svg className="h-4 w-4 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                  />
                </svg>
                Visualizar Comprovante
              </Button>
            )}

            {/* Botão Compartilhar */}
            {!isEditing && (
              <CobrancaCompartilharButton
                cobranca={cobranca}
                invoiceUrl={invoiceUrl}
                triggerClassName="w-full sm:w-auto"
              />
            )}

            {/* Menu Mais Ações - Controlado por chargeActions hook */}
            {!isEditing && chargeActions.allowedActions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="h-10 w-full justify-center border-gray-300 px-4 text-gray-700 hover:bg-gray-50 sm:w-auto"
                  >
                    <MoreVertical className="h-4 w-4 mr-2" />
                    Mais ações
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {/* Visualizar fatura - sempre que permitido */}
                  {chargeActions.canViewInvoice && (
                    <DropdownMenuItem onClick={handleVisualizarFatura}>
                      Visualizar fatura
                    </DropdownMenuItem>
                  )}

                  {/* Reenviar cobrança - apenas se tem asaasPaymentId e ação permitida */}
                  {chargeActions.canResend && cobranca.asaasPaymentId && (
                    <DropdownMenuItem onClick={handleResendCobranca} disabled={isResendingAsaas}>
                      {isResendingAsaas ? 'Reenviando...' : 'Reenviar cobrança'}
                    </DropdownMenuItem>
                  )}

                  {/* Confirmar recebimento em dinheiro */}
                  {chargeActions.canConfirmPayment && (
                    <DropdownMenuItem onClick={handleConfirmarRecebimento}>
                      Confirmar recebimento em dinheiro
                    </DropdownMenuItem>
                  )}

                  {/* Estornar pagamento */}
                  {chargeActions.canRefund && cobranca.asaasPaymentId && (
                    <DropdownMenuItem 
                      onClick={() => setShowRefundDialog(true)}
                      className="text-orange-600"
                      disabled={isRefunding}
                    >
                      {isRefunding ? 'Estornando...' : 'Estornar pagamento'}
                    </DropdownMenuItem>
                  )}

                  {/* Desfazer recebimento em dinheiro */}
                  {chargeActions.canUndoCashPayment && cobranca.asaasPaymentId && (
                    <DropdownMenuItem
                      onClick={() => setShowRefundDialog(true)}
                      className="text-orange-600"
                      disabled={isRefunding}
                    >
                      {isRefunding ? 'Desfazendo...' : 'Desfazer recebimento em dinheiro'}
                    </DropdownMenuItem>
                  )}

                  {/* Remover cobrança */}
                  {chargeActions.canCancel && (
                    <DropdownMenuItem 
                      onClick={() => setShowRemoveDialog(true)} 
                      className="text-red-600"
                      disabled={isRemoving}
                    >
                      {isRemoving ? 'Removendo...' : 'Remover cobrança'}
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </div>

        <div className="space-y-8">
      <section
        className={cn(
          sectionClass,
          isEditing && 'border-indigo-300 ring-2 ring-indigo-100',
        )}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <span className="text-sm font-semibold text-slate-700">Informações da Cobrança</span>
            <p className="mt-1 text-sm text-slate-600">
              Detalhes financeiros e situação do pagamento
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-2 sm:flex-row sm:items-center">
            {isEditing && (
              <div className="flex items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-indigo-700">
                <Edit className="h-4 w-4 shrink-0" />
                <span className="text-sm font-medium">Modo de edição</span>
              </div>
            )}
            <div className="flex flex-col items-end gap-1">
              <Badge
                status={
                  cobranca.status === 'PAGO' && cobranca.liquidacaoStatus === 'DISPONIVEL'
                    ? 'RECEIVED'
                    : statusMap[cobranca.status]
                }
              />
              {awaitingWebhook && !isCobrancaDetailTerminal(cobranca.status) ? (
                <p className="text-right text-xs text-indigo-600">Atualizando status…</p>
              ) : null}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-1">
            <label htmlFor="valor" className={labelClass}>
              Valor
            </label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                R$
              </span>
              <input
                id="valor"
                type="text"
                inputMode="decimal"
                value={editValorDisplay}
                onChange={(e) => {
                  valorTypingRef.current = true;
                  const nextDisplay = formatBRLInput(e.target.value);
                  setEditValorDisplay(nextDisplay);
                  setEditValor(parseBRL(nextDisplay));
                }}
                onBlur={() => {
                  valorTypingRef.current = false;
                  if (editValorDisplay) {
                    setEditValorDisplay(formatBRL(editValor));
                  }
                }}
                disabled={!isEditing}
                placeholder="0,00"
                className={`w-full pl-10 pr-3 py-2 text-sm border rounded-md text-right ${
                  isEditing
                    ? 'border-indigo-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900'
                    : 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                }`}
              />
            </div>
          </div>

          <div className="space-y-1">
            <label htmlFor="tipo" className={labelClass}>
              Tipo
            </label>
            <input
              id="tipo"
              type="text"
              value={getTipoLabel(cobranca.tipo)}
              disabled
              className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md"
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="vencimento" className={labelClass}>
              Vencimento
            </label>
            <input
              id="vencimento"
              type="text"
              value={editVencimentoDisplay}
              onChange={handleVencimentoChange}
              disabled={!isEditing}
              placeholder="DD/MM/AAAA"
              maxLength={10}
              className={`w-full px-3 py-2 text-sm border rounded-md ${
                isEditing
                  ? 'border-indigo-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900'
                  : 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
              }`}
            />
          </div>

          <div className="space-y-1">
            <label htmlFor="formaPagamento" className={labelClass}>
              Forma de Pagamento
            </label>
            {isEditing ? (
              <Select value={editFormaPagamento} onValueChange={setEditFormaPagamento}>
                <SelectTrigger className="w-full h-[38px] px-3 text-sm border-indigo-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900">
                  <SelectValue placeholder="Selecione a forma de pagamento" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BOLETO">Boleto Bancário / Pix</SelectItem>
                  <SelectItem value="PIX">Pix</SelectItem>
                  <SelectItem value="INDEFINIDO">Pergunte ao cliente</SelectItem>
                  <SelectItem value="CARTAO_CREDITO">Cartão de Crédito</SelectItem>
                </SelectContent>
              </Select>
            ) : (
              <input
                type="text"
                value={FORMA_PAGAMENTO_LABELS[editFormaPagamento] || editFormaPagamento}
                disabled
                className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md"
              />
            )}
          </div>

          {cobranca.dataPagamento && (
            <div className="space-y-1">
              <label className={labelClass}>Data de Pagamento</label>
              <input
                type="text"
                value={formatDate(cobranca.dataPagamento)}
                disabled
                className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md"
              />
            </div>
          )}

          {isPago && cobranca.valorLiquido != null && (
            <>
              <div className="space-y-1">
                <label className={labelClass}>Valor Líquido</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                    R$
                  </span>
                  <input
                    type="text"
                    value={formatBRL(cobranca.valorLiquido)}
                    disabled
                    className="w-full pl-10 pr-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md text-right"
                  />
                </div>
                <p className="text-xs text-slate-500">Após taxas</p>
              </div>

              {cobranca.taxaAsaas != null && cobranca.taxaAsaas > 0 && (
                <div className="space-y-1">
                  <label className={labelClass}>Taxa da plataforma financeira</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                      R$
                    </span>
                    <input
                      type="text"
                      value={`-${formatBRL(cobranca.taxaAsaas)}`}
                      disabled
                      className="w-full pl-10 pr-3 py-2 text-sm border border-red-200 bg-red-50 text-red-600 cursor-not-allowed rounded-md text-right"
                    />
                  </div>
                </div>
              )}
            </>
          )}

          <div className="md:col-span-2 space-y-1">
            <label htmlFor="descricao" className={labelClass}>
              Descrição
            </label>
            <textarea
              id="descricao"
              rows={3}
              value={editDescricao}
              onChange={(e) => setEditDescricao(e.target.value)}
              disabled={!isEditing}
              className={`w-full px-3 py-2 text-sm border rounded-md resize-none ${
                isEditing
                  ? 'border-indigo-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900'
                  : 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
              }`}
              placeholder={
                isEditing
                  ? 'Adicione uma descrição ou observação sobre esta cobrança...'
                  : 'Nenhuma descrição informada'
              }
            />
          </div>
        </div>
      </section>

      {/* Informações do Pagamento (quando pago) */}
      {isPago && cobranca.pagamentos && cobranca.pagamentos.length > 0 && (() => {
        const pagamentoConfirmado = cobranca.pagamentos.find(p => p.status === 'CONFIRMADO' || p.status === 'PAGO');
        if (!pagamentoConfirmado) return null;
        
        return (
          <div className={cn(DETAIL_SECTION_MAX, 'bg-green-50 border border-green-200 rounded-xl shadow-sm overflow-hidden')}>
            <div className="px-6 py-4 bg-green-100 border-b border-green-200">
              <h3 className="text-base font-semibold text-green-900 flex items-center gap-2">
                <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Pagamento Confirmado
              </h3>
              <p className="text-xs text-green-700 mt-0.5">
                Detalhes do pagamento realizado
              </p>
            </div>
            <div className="px-6 py-4">
              <dl className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div>
                  <dt className="text-xs font-medium text-green-700">Data do Pagamento:</dt>
                  <dd className="text-sm text-green-900 font-semibold mt-0.5">
                    {formatDate(pagamentoConfirmado.dataPagamento || pagamentoConfirmado.createdAt)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-green-700">Forma de Pagamento:</dt>
                  <dd className="text-sm text-green-900 font-semibold mt-0.5">
                    {FORMA_PAGAMENTO_LABELS[pagamentoConfirmado.formaPagamento] || pagamentoConfirmado.formaPagamento}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs font-medium text-green-700">Status:</dt>
                  <dd className="text-sm text-green-900 font-semibold mt-0.5">
                    {formatStatusLabel(pagamentoConfirmado.status)}
                  </dd>
                </div>
              </dl>
              {pagamentoConfirmado.comprovante && (
                <div className="mt-4 pt-4 border-t border-green-200">
                  <button
                    onClick={handleVisualizarFatura}
                    className="inline-flex items-center gap-2 text-sm text-green-700 hover:text-green-900 font-medium transition-colors"
                  >
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    Ver comprovante de pagamento
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* Juros, Multa e Desconto */}
      <div
        className={cn(
          DETAIL_SECTION_MAX,
          'bg-white rounded-xl border shadow-sm transition-all duration-200',
          isEditingAjustes
            ? 'border-indigo-400 shadow-indigo-100 ring-2 ring-indigo-100'
            : 'border-gray-200',
        )}
      >
        <div className="px-4 py-4 border-b border-gray-100 sm:px-6 sm:py-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-gray-900 sm:text-xl">Juros, Multa e Desconto</h2>
              <p className="mt-1 text-sm text-gray-600">
                Ajustes financeiros aplicados sobre o valor da cobrança
              </p>
            </div>
            <div className="flex w-full min-w-0 flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end sm:gap-3">
              {isPendente && (
                <>
                  {isEditingAjustes ? (
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-row sm:gap-3">
                      <Button
                        variant="outline"
                        onClick={handleCancelAjustes}
                        disabled={isSavingAjustes}
                        className="h-10 w-full justify-center border-gray-300 px-4 text-gray-700 hover:bg-gray-50 sm:w-auto"
                      >
                        Cancelar
                      </Button>
                      <Button
                        onClick={handleEditAjustes}
                        disabled={isSavingAjustes}
                        className="h-10 w-full justify-center bg-brand-accent px-4 text-white hover:bg-brand-accent/90 sm:w-auto"
                      >
                        {isSavingAjustes ? (
                          <>
                            <div className="mr-2 h-4 w-4 animate-spin rounded-full border-b-2 border-white" />
                            Salvando...
                          </>
                        ) : (
                          <>
                            <Edit className="mr-2 h-4 w-4" />
                            Salvar
                          </>
                        )}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="outline"
                      onClick={handleEditAjustes}
                      className="h-10 w-full justify-center border-gray-300 px-4 text-gray-700 hover:bg-gray-50 sm:w-auto"
                    >
                      <Edit className="mr-2 h-4 w-4" />
                      Editar
                    </Button>
                  )}
                </>
              )}
              {isEditingAjustes && (
                <div className="flex w-full items-center gap-2 rounded-lg bg-indigo-50 px-3 py-1.5 text-indigo-700 sm:ml-0 sm:w-auto">
                  <Edit className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">Modo de edição</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="px-4 py-5 sm:px-6 sm:py-6">
          {/* Juros */}
          <div className="mb-6">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Juros ao mês</h3>
            <div>
              <label htmlFor="jurosPercentual" className="flex items-center gap-2 text-xs text-gray-600 mb-1.5">
                Percentual de juros (%)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                  %
                </span>
                <input
                  id="jurosPercentual"
                  type="text"
                  value={editJurosPercentual}
                  onChange={(e) =>
                    setEditJurosPercentual(formatPercentInputChange(e.target.value))
                  }
                  disabled={!isEditingAjustes}
                  className={`w-full pl-10 pr-3 py-2 text-sm border rounded-md text-right ${
                    isEditingAjustes
                      ? 'border-indigo-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900'
                      : 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                  }`}
                  placeholder="0,00"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                Juros <strong>mensais</strong> aplicados sobre o valor da cobrança após o vencimento.
                <br />
                <strong>Exemplo:</strong> 2% ao mês significa que a cada mês de atraso, o valor aumenta em 2%.
                Uma cobrança de R$ 100,00 com 2% de juros ao mês, após 1 mês = R$ 102,00.
              </p>
            </div>
          </div>

          {/* Multa */}
          <div className="mb-6 pt-4 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Multa por atraso</h3>
            <div>
              <label htmlFor="multaPercentual" className="flex items-center gap-2 text-xs text-gray-600 mb-1.5">
                Percentual de multa (%)
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                  %
                </span>
                <input
                  id="multaPercentual"
                  type="text"
                  value={editMultaPercentual}
                  onChange={(e) =>
                    setEditMultaPercentual(formatPercentInputChange(e.target.value))
                  }
                  disabled={!isEditingAjustes}
                  className={`w-full pl-10 pr-3 py-2 text-sm border rounded-md text-right ${
                    isEditingAjustes
                      ? 'border-indigo-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900'
                      : 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                  }`}
                  placeholder="0,00"
                />
              </div>
              <p className="text-xs text-gray-500 mt-1.5">
                Multa aplicada <strong>uma única vez</strong> quando o pagamento atrasa.
                <br />
                <strong>Exemplo:</strong> 2% de multa sobre R$ 100,00 = R$ 102,00 no primeiro dia de
                atraso (multa não aumenta, mas juros sim).
              </p>
            </div>
          </div>

          {/* Desconto */}
          <div className="pt-4 border-t border-gray-100">
            <h3 className="text-sm font-medium text-gray-700 mb-3">Desconto</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label htmlFor="descontoTipo" className="block text-xs text-gray-600 mb-1.5">
                  Tipo
                </label>
                {isEditingAjustes ? (
                  <Select value={editDescontoTipo} onValueChange={setEditDescontoTipo}>
                    <SelectTrigger className="w-full h-[38px] px-3 text-sm border-indigo-300 focus:ring-2 focus:ring-indigo-500 bg-white text-gray-900">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="VALOR_FIXO">Valor fixo</SelectItem>
                      <SelectItem value="PERCENTUAL">Percentual</SelectItem>
                    </SelectContent>
                  </Select>
                ) : (
                  <input
                    type="text"
                    value={editDescontoTipo === 'VALOR_FIXO' ? 'Valor fixo' : 'Percentual'}
                    disabled
                    className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md"
                  />
                )}
              </div>

              {editDescontoTipo === 'PERCENTUAL' ? (
                <div>
                  <label
                    htmlFor="descontoPercentual"
                    className="block text-xs text-gray-600 mb-1.5"
                  >
                    Percentual (%)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                      %
                    </span>
                    <input
                      id="descontoPercentual"
                      type="text"
                      value={editDescontoPercentual}
                      onChange={(e) =>
                        setEditDescontoPercentual(formatPercentInputChange(e.target.value))
                      }
                      disabled={!isEditingAjustes}
                      className={`w-full pl-10 pr-3 py-2 text-sm border rounded-md text-right ${
                        isEditingAjustes
                          ? 'border-indigo-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900'
                          : 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                      }`}
                      placeholder="0,00"
                    />
                  </div>
                </div>
              ) : (
                <div>
                  <label htmlFor="descontoValorFixo" className="block text-xs text-gray-600 mb-1.5">
                    Valor (R$)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-gray-500">
                      R$
                    </span>
                    <input
                      id="descontoValorFixo"
                      type="text"
                      inputMode="decimal"
                      value={editDescontoValorFixoDisplay}
                      onChange={(e) => {
                        descontoTypingRef.current = true;
                        const nextDisplay = formatBRLInput(e.target.value);
                        setEditDescontoValorFixoDisplay(nextDisplay);
                        setEditDescontoValorFixo(parseBRL(nextDisplay));
                      }}
                      onBlur={() => {
                        descontoTypingRef.current = false;
                        if (editDescontoValorFixoDisplay) {
                          setEditDescontoValorFixoDisplay(formatBRL(editDescontoValorFixo));
                        }
                      }}
                      disabled={!isEditingAjustes}
                      placeholder="0,00"
                      className={`w-full pl-10 pr-3 py-2 text-sm border rounded-md text-right ${
                        isEditingAjustes
                          ? 'border-indigo-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900'
                          : 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                      }`}
                    />
                  </div>
                </div>
              )}

              <div>
                <label htmlFor="descontoPrazoMaximo" className="flex items-center gap-2 text-xs text-gray-600 mb-1.5">
                  Prazo máximo do desconto (dias)
                  <span
                    className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-medium text-blue-600 bg-blue-100 rounded-full cursor-help"
                    title="Número de dias antes do vencimento que o desconto é válido. 0 = até o dia do vencimento"
                  >
                    ?
                  </span>
                </label>
                <input
                  id="descontoPrazoMaximo"
                  type="number"
                  min={0}
                  value={editDescontoDias}
                  onChange={(e) => setEditDescontoDias(Math.max(0, parseInt(e.target.value) || 0))}
                  disabled={!isEditingAjustes}
                  placeholder="0"
                  className={`w-full px-3 py-2 text-sm border rounded-md ${
                    isEditingAjustes
                      ? 'border-indigo-300 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 bg-white text-gray-900'
                      : 'border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed'
                  }`}
                />
                <p className="text-xs text-gray-500 mt-1.5">
                  Número de dias <strong>antes do vencimento</strong> que o desconto é válido.
                  <br />
                  <strong>0 = até o dia do vencimento</strong> | <strong>5 = até 5 dias antes</strong>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Dados do Aluno */}
      <div className={cn(DETAIL_SECTION_MAX, 'bg-white rounded-xl border border-gray-200 shadow-sm')}>
        <div className="px-4 py-4 border-b border-gray-100 sm:px-6 sm:py-5">
          <h2 className="text-lg font-semibold text-gray-900 sm:text-xl">Dados do Aluno</h2>
          <p className="mt-1 text-sm text-gray-600">Informações de contato e matrícula</p>
        </div>

        <div className="px-4 py-5 sm:px-6 sm:py-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="alunoNome" className="block text-xs text-gray-600 mb-1.5">
                Nome Completo
              </label>
              <input
                id="alunoNome"
                type="text"
                value={cobranca.matricula.aluno.nome}
                disabled
                className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md"
              />
            </div>

            {cobranca.matricula.aluno.cpf && (
              <div>
                <label htmlFor="alunoCpf" className="block text-xs text-gray-600 mb-1.5">
                  CPF
                </label>
                <input
                  id="alunoCpf"
                  type="text"
                  value={cobranca.matricula.aluno.cpf}
                  disabled
                  className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md font-mono"
                />
              </div>
            )}

            {cobranca.matricula.aluno.email && (
              <div>
                <label htmlFor="alunoEmail" className="block text-xs text-gray-600 mb-1.5">
                  E-mail
                </label>
                <input
                  id="alunoEmail"
                  type="email"
                  value={cobranca.matricula.aluno.email}
                  disabled
                  className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md"
                />
              </div>
            )}

            {cobranca.matricula.aluno.telefone && (
              <div>
                <label htmlFor="alunoTelefone" className="block text-xs text-gray-600 mb-1.5">
                  Telefone
                </label>
                <input
                  id="alunoTelefone"
                  type="tel"
                  value={cobranca.matricula.aluno.telefone}
                  disabled
                  className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md font-mono"
                />
              </div>
            )}

            <div>
              <label htmlFor="planoContratado" className="block text-xs text-gray-600 mb-1.5">
                Plano Contratado
              </label>
              <input
                id="planoContratado"
                type="text"
                value={cobranca.matricula.plano?.nome ?? (cobranca.matricula.combo?.nome ? `Combo: ${cobranca.matricula.combo.nome}` : '—')}
                disabled
                className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md"
              />
            </div>

            <div>
              <label htmlFor="codigoMatricula" className="block text-xs text-gray-600 mb-1.5">
                Código de Matrícula
              </label>
              <input
                id="codigoMatricula"
                type="text"
                value={cobranca.matricula.codigo}
                disabled
                className="w-full px-3 py-2 text-sm border border-gray-200 bg-gray-50 text-gray-500 cursor-not-allowed rounded-md font-mono"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Arquivos e Documentos */}
      <CobrancaArquivos cobrancaId={cobranca.id} sectionClassName={sectionClass} />

      <div className={cn('flex justify-center pt-2', DETAIL_SECTION_MAX)}>
        <AsaasSeal variant="negativo-preto" />
      </div>
        </div>
      </div>

      <ConfirmDialog
        open={showRefundDialog}
        onOpenChange={setShowRefundDialog}
        title={wasReceivedInCash ? 'Desfazer recebimento em dinheiro?' : 'Estornar pagamento?'}
        description={
          wasReceivedInCash
            ? 'Esta ação solicita o desfazimento do recebimento em dinheiro no processamento financeiro da Alusa e a atualização será confirmada automaticamente.'
            : 'Esta ação solicita o estorno no processamento financeiro da Alusa e a atualização será confirmada automaticamente.'
        }
        confirmText={wasReceivedInCash ? 'Desfazer recebimento' : 'Solicitar estorno'}
        cancelText="Cancelar"
        variant="destructive"
        loading={isRefunding}
        onConfirm={() => {
          const action = wasReceivedInCash
            ? handleDesfazerRecebimento()
            : handleEstornarPagamento();
          void action.finally(() => setShowRefundDialog(false));
        }}
      />

      {/* Modal de Confirmação de Remoção */}
      <AlertDialog open={showRemoveDialog} onOpenChange={setShowRemoveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remover cobrança?</AlertDialogTitle>
            <AlertDialogDescription>
              {cobranca.asaasPaymentId ? (
                <>
                  Esta ação irá remover a cobrança <strong>permanentemente</strong> do sistema 
                  e também será <strong>removida da plataforma financeira</strong>. Esta ação não pode ser desfeita.
                </>
              ) : (
                <>
                  Esta ação irá remover a cobrança <strong>permanentemente</strong> do sistema.
                  Esta ação não pode ser desfeita.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRemoving}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemoverCobranca}
              disabled={isRemoving}
              className="bg-red-600 hover:bg-red-700 focus:ring-red-600"
            >
              {isRemoving ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                  Removendo...
                </>
              ) : (
                'Sim, remover cobrança'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
