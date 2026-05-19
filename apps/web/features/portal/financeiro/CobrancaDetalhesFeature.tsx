'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFinanceLiveRefresh } from '@/features/financeiro/hooks/useFinanceLiveRefresh';
import { useRouter } from 'next/navigation';
import { ChevronLeft, AlertCircle } from '@/components/icons/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge, type StatusType } from '@/components/ui/badge';
import { pushToast } from '@/components/ui/toast';
import { CobrancaCompartilharButton } from '@/components/financeiro/CobrancaCompartilharButton';
import type { PortalFinanceiroDetailDTO } from '@/features/portal/dtos';

const PAYMENT_NOTICE =
  'Pagamentos e mudanças na forma de cobrança são realizados pela secretaria. Entre em contato para receber sua fatura.';

const statusBadgeMap: Record<string, StatusType> = {
  PENDENTE: 'PENDENTE',
  A_VENCER: 'A_VENCER',
  ATRASADO: 'ATRASADO',
  PROCESSANDO: 'PROCESSANDO',
  PAGO: 'PAGO',
  CANCELADO: 'CANCELADO',
  CANCELAMENTO_PENDENTE: 'CANCELAMENTO_PENDENTE',
  ESTORNADO: 'ESTORNADO',
  ESTORNADO_PARCIAL: 'ESTORNADO_PARCIAL',
};

const formaPagamentoLabel: Record<string, string> = {
  PIX: 'PIX',
  BOLETO: 'Boleto bancário',
  CARTAO_CREDITO: 'Cartão de crédito',
  CARTAO_DEBITO: 'Cartão de débito',
  DEBITO_AUTOMATICO: 'Débito automático',
  DINHEIRO: 'Dinheiro',
  TRANSFERENCIA: 'Transferência bancária',
  INDEFINIDO: 'Definir com a secretaria',
};

const tipoCobrancaLabel: Record<string, string> = {
  TAXA_MATRICULA: 'Taxa de matrícula',
  MENSALIDADE: 'Mensalidade',
  EXTRA: 'Cobrança extra',
  AVULSA: 'Avulsa',
  PARCELADA: 'Parcelada',
  RECORRENTE: 'Recorrente',
};

const formatCurrency = (value: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
  }).format(Number(value ?? 0));

const formatCurrencyInput = (value: number | null | undefined) =>
  new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value ?? 0));

const formatDate = (value: string | null | undefined) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
};

const getPaymentLabel = (value: string | null) => {
  if (!value) return 'Definir com a secretaria';
  return formaPagamentoLabel[value] ?? value;
};

const getDiasAtraso = (vencimento: string) => {
  const dueDate = new Date(vencimento);
  if (Number.isNaN(dueDate.getTime())) return null;
  const diff = Date.now() - dueDate.getTime();
  if (diff <= 0) return null;
  const dias = Math.floor(diff / (1000 * 60 * 60 * 24));
  return dias > 0 ? dias : null;
};

const formatCpf = (value?: string | null) => {
  if (!value) return 'Não informado';
  const digits = value.replace(/\D/g, '').padStart(11, '0');
  if (digits.length !== 11) return value;
  return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
};

const formatPhone = (value?: string | null) => {
  if (!value) return 'Não informado';
  const digits = value.replace(/\D/g, '');
  if (digits.length < 10) return value;
  return digits.replace(/(\d{2})(\d{4,5})(\d{4})/, '($1) $2-$3');
};

const buildInvoiceUrl = (cobranca: CobrancaDetalhes) => {
  return (
    cobranca.invoiceUrl ||
    cobranca.asaasData?.invoiceUrl ||
    (cobranca.asaasPaymentId ? `https://www.asaas.com/i/${cobranca.asaasPaymentId}` : null) ||
    (cobranca.asaasId ? `https://www.asaas.com/i/${cobranca.asaasId}` : null)
  );
};

const buildReceiptUrl = (cobranca: CobrancaDetalhes) => {
  return (
    cobranca.transactionReceiptUrl ||
    cobranca.asaasData?.transactionReceiptUrl ||
    null
  );
};

type CobrancaDetalhes = PortalFinanceiroDetailDTO;

export function CobrancaDetalhesFeature({ cobrancaId }: { cobrancaId: string }) {
  const router = useRouter();
  const [cobranca, setCobranca] = useState<CobrancaDetalhes | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadCobranca = useCallback(
    async (silent = false) => {
      try {
        if (!silent) setLoading(true);
        const response = await fetch(`/api/portal/financeiro/${cobrancaId}`, {
          cache: 'no-store',
        });
        if (!response.ok) {
          if (response.status === 404) {
            throw new Error('Cobrança não encontrada');
          }
          throw new Error('Erro ao carregar cobrança');
        }
        const data = await response.json();
        setCobranca(data);
        setError(null);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [cobrancaId],
  );

  useEffect(() => {
    void loadCobranca();
  }, [loadCobranca]);

  useFinanceLiveRefresh(() => loadCobranca(true), {
    cobrancaId,
    enabled: Boolean(cobranca) && !loading,
    intervalMs: 20_000,
    minIntervalMs: 5_000,
    realtime: { dashboard: false, financeiro: false, cobrancaQueries: false },
  });

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error || !cobranca) {
    return (
      <div className="space-y-6">
        <button
          onClick={() => router.push('/portal/financeiro')}
          className="flex items-center gap-2 text-violet-600 hover:text-violet-700 font-medium"
        >
          <ChevronLeft className="h-5 w-5" />
          Voltar
        </button>
        <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
          <AlertCircle className="h-5 w-5" />
          <span>{error || 'Cobrança não encontrada'}</span>
        </div>
      </div>
    );
  }

  const badgeStatus = statusBadgeMap[cobranca.status] ?? 'PENDING';
  const vencimentoFormatado = formatDate(cobranca.vencimento);
  const diasAtraso = getDiasAtraso(cobranca.vencimento);
  const invoiceLink = buildInvoiceUrl(cobranca);
  const receiptLink = buildReceiptUrl(cobranca);
  const valorDisplay = formatCurrencyInput(cobranca.valor);
  const formaPagamento = getPaymentLabel(cobranca.formaPagamento);
  const descricaoDisplay = cobranca.descricao?.trim() || 'Nenhuma descrição informada';
  const cpfDisplay = formatCpf(cobranca.matricula.aluno.cpf);
  const telefoneDisplay = formatPhone(cobranca.matricula.aluno.telefone);
  const tipoDisplay = tipoCobrancaLabel[cobranca.tipo] ?? cobranca.tipo;
  const modalidadeDisplay = cobranca.matricula.turma?.modalidade.nome ?? 'Não informada';
  const turmaDisplay = cobranca.matricula.turma?.nome ?? 'Não informada';
  const isPago = cobranca.status === 'PAGO';
  const isPendente = ['PENDENTE', 'ATRASADO', 'A_VENCER'].includes(cobranca.status);
  const hasAutomaticPayment =
    cobranca.formaPagamento === 'CARTAO_CREDITO' &&
    Boolean(cobranca.matricula.responsavelFinanceiro?.hasSavedCard);
  const ajustes = [
    { label: 'Desconto', value: cobranca.valorDesconto, prefix: '-' },
    { label: 'Juros', value: cobranca.valorJuros, prefix: '+' },
    { label: 'Multa', value: cobranca.valorMulta, prefix: '+' },
  ].filter((item) => item.value && item.value !== 0);
  const cardBrand = cobranca.matricula.responsavelFinanceiro?.creditCardBrand ?? 'Cartão';
  const cardLast4 = cobranca.matricula.responsavelFinanceiro?.creditCardLast4 ?? '••••';
  const canShare = Boolean(invoiceLink);

  const shareableCobranca = {
    id: cobranca.id,
    asaasPaymentId: cobranca.asaasPaymentId ?? cobranca.asaasId ?? undefined,
    matricula: {
      aluno: {
        nome: cobranca.matricula.aluno.nome,
        telefone: cobranca.matricula.aluno.telefone ?? undefined,
        email: cobranca.matricula.aluno.email ?? undefined,
      },
    },
  } as const;

  const handleVisualizarComprovante = () => {
    if (!receiptLink || !isPago) {
      pushToast({
        title: 'Comprovante ainda indisponível',
        description: 'O comprovante só aparece após o pagamento ser confirmado.',
        variant: 'warning',
      });
      return;
    }

    window.open(receiptLink, '_blank', 'noopener,noreferrer');
    pushToast({
      title: 'Comprovante aberto',
      description: 'Você pode baixar o PDF da cobrança.',
      variant: 'success',
    });
  };

  const handleVerCobranca = () => {
    if (!invoiceLink) {
      pushToast({
        title: 'Cobrança indisponível',
        description: 'Não encontramos um link de pagamento ativo. Entre em contato com a secretaria.',
        variant: 'error',
      });
      return;
    }

    window.open(invoiceLink, '_blank', 'noopener,noreferrer');
    pushToast({
      title: 'Abrimos o checkout seguro',
      description: 'O pagamento será finalizado diretamente no ambiente seguro.',
      variant: 'info',
    });
  };

  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 pb-12 space-y-6">
      <button
        onClick={() => router.push('/portal/financeiro')}
        className="flex items-center gap-2 text-sm font-medium text-violet-600 transition-colors hover:text-violet-700"
      >
        <ChevronLeft className="h-4 w-4" />
        Voltar
      </button>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-gray-900">Detalhes da Cobrança</h1>
          <p className="text-sm text-gray-600 mt-1">Visualize informações financeiras e status da cobrança</p>
          <p className="text-xs font-mono text-gray-500 mt-3">ID: {cobranca.id}</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!isPago && invoiceLink ? (
            <Button
              onClick={handleVerCobranca}
              className="h-11 bg-violet-600 text-white hover:bg-violet-700"
            >
              Ver cobrança
            </Button>
          ) : null}

          {isPago && receiptLink ? (
            <Button
              onClick={handleVisualizarComprovante}
              className="h-11 bg-emerald-600 text-white hover:bg-emerald-700"
            >
              Visualizar comprovante
            </Button>
          ) : null}

          {canShare ? (
            <CobrancaCompartilharButton
              cobranca={shareableCobranca}
              invoiceUrl={invoiceLink ?? undefined}
            />
          ) : (
            <Button
              variant="outline"
              disabled
              className="h-11 border-gray-200 text-gray-400"
            >
              Compartilhar
            </Button>
          )}
        </div>
      </div>
      <section className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="px-6 py-5 border-b border-gray-100">
          <h2 className="text-xl font-semibold text-gray-900">Informações da Cobrança</h2>
          <p className="text-sm text-gray-600 mt-1">Detalhes financeiros e situação do pagamento</p>
        </div>

        <div className="px-6 py-6 space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <p className="text-sm font-medium text-gray-500 mb-2">Situação</p>
              <Badge status={badgeStatus} />
              {diasAtraso ? (
                <p className="mt-2 text-sm font-medium text-rose-600">
                  Atrasada há {diasAtraso} {diasAtraso > 1 ? 'dias' : 'dia'}
                </p>
              ) : null}
            </div>
            <ReadonlyField label="Valor" value={valorDisplay} prefix="R$" />
            <ReadonlyField label="Vencimento" value={vencimentoFormatado} />
            <ReadonlyField label="Tipo da Cobrança" value={tipoDisplay} />
            <ReadonlyField label="Forma de Pagamento" value={formaPagamento} />
            <ReadonlyField label="Modalidade" value={modalidadeDisplay} />
            <ReadonlyField label="Turma" value={turmaDisplay} />
          </div>

          <ReadonlyTextarea label="Descrição" value={descricaoDisplay} />

          {ajustes.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-3">
              {ajustes.map((ajuste) => (
                <div key={ajuste.label} className="rounded-lg border border-gray-100 bg-gray-50 p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                    {ajuste.label}
                  </p>
                  <p className="mt-1 text-base font-semibold text-gray-900">
                    {ajuste.prefix} {formatCurrency(Math.abs(ajuste.value || 0))}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-5 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900">Aluno</h3>
            <p className="text-sm text-gray-600 mt-1">Dados básicos do aluno responsável por esta cobrança</p>
          </div>
          <div className="px-6 py-6 space-y-5">
            <ReadonlyField label="Nome" value={cobranca.matricula.aluno.nome} />
            <ReadonlyField label="CPF" value={cpfDisplay} />
            <ReadonlyField label="Telefone" value={telefoneDisplay} />
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
          <div className="px-6 py-5 border-b border-gray-100">
            <h3 className="text-lg font-semibold text-gray-900">Status do Pagamento</h3>
            <p className="text-sm text-gray-600 mt-1">Acompanhe orientações sobre o próximo passo</p>
          </div>
          <div className="px-6 py-6">
            {isPago ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5">
                <p className="text-sm font-semibold text-emerald-900 flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> Pagamento Confirmado
                </p>
                <p className="mt-2 text-sm text-emerald-800">
                  Obrigado! O pagamento foi registrado e não há nenhuma ação pendente.
                </p>
              </div>
            ) : hasAutomaticPayment ? (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-5 space-y-3">
                <p className="text-sm font-semibold text-indigo-900">Débito automático ativo</p>
                <p className="text-sm text-indigo-800">
                  O pagamento será processado automaticamente no cartão cadastrado.
                </p>
                <div className="rounded-lg bg-white p-4 text-sm text-indigo-900 border border-indigo-100">
                  <p>
                    {cardBrand} ••••{cardLast4}
                  </p>
                  <p className="mt-1">Vencimento: {vencimentoFormatado}</p>
                  <p className="mt-1">Valor: {formatCurrency(cobranca.valor)}</p>
                </div>
                <p className="text-xs text-indigo-800">
                  Alterações na forma de pagamento devem ser solicitadas à secretaria.
                </p>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 space-y-3">
                <p className="text-sm font-semibold text-amber-900">Autoatendimento indisponível</p>
                <p className="text-sm text-amber-800">{PAYMENT_NOTICE}</p>
                {isPendente && (
                  <p className="text-xs text-amber-900">
                    Informe o código{' '}
                    <span className="font-mono font-semibold">{cobranca.id}</span> ao falar com a secretaria para agilizar o atendimento.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function ReadonlyField({ label, value, prefix }: { label: string; value: string; prefix?: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
        {label}
      </label>
      <div className="relative">
        {prefix ? (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-500">{prefix}</span>
        ) : null}
        <input
          type="text"
          value={value}
          disabled
          className={`w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium text-gray-900 ${
            prefix ? 'pl-9' : ''
          }`}
        />
      </div>
    </div>
  );
}

function ReadonlyTextarea({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <label className="block text-xs font-semibold uppercase tracking-wide text-gray-500 mb-1.5">
        {label}
      </label>
      <textarea
        value={value}
        disabled
        rows={3}
        className="w-full rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-900"
      />
    </div>
  );
}
