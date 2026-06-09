'use client';

import { useState, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge, type StatusType } from '@/components/ui/badge';
import {
  InfoCallout,
  InfoCalloutItem,
  type InfoCalloutVariant,
} from '@/components/ui/info-callout';
import { Copy, ExternalLink, QrCode } from '@/components/icons/icons';
import { pushToast } from '@/components/ui/toast';
import { StatusCobranca } from '@prisma/client';

interface TaxaMatriculaSectionProps {
  matriculaId: string;
  taxaMatricula: number;
  taxaIsenta: boolean;
  cobrancas: Array<{
    id: string;
    tipo: string;
    status: StatusCobranca;
    valor: number;
    vencimento: string;
    formaPagamento: string;
    origin?: 'ACADEMIC' | 'STANDALONE';
  }>;
  onRefresh: () => void;
}

type ResendCobrancaData = {
  cobrancaId: string;
  status: StatusCobranca;
  previousStatus: StatusCobranca | null;
  invoiceUrl?: string | null;
  bankSlipUrl?: string | null;
  pixQrCodeUrl?: string | null;
  pixCopyPaste?: string | null;
};

const currency = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const dateFormat = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const labelClass = 'text-xs font-medium text-slate-600';
const controlClass =
  'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed';

const openTaxaStatuses = new Set<StatusCobranca>(['PENDENTE', 'A_VENCER', 'ATRASADO']);
const terminalTaxaStatuses = new Set<StatusCobranca>([
  'PAGO',
  'CANCELADO',
  'ESTORNADO',
  'ESTORNADO_PARCIAL',
]);

type TaxaPaymentNotice = {
  label: string;
  description: string;
  variant: InfoCalloutVariant;
  labelTone?: 'default' | 'warning' | 'caution' | 'danger' | 'muted';
};

function resolveTaxaBadgeStatus(params: {
  taxaIsenta: boolean;
  status?: StatusCobranca | null;
}): StatusType {
  if (params.status) return params.status as StatusType;
  return params.taxaIsenta ? 'ISENTO' : 'PENDENTE';
}

function resolveTaxaPaymentNotice(params: {
  status?: StatusCobranca | null;
  isStandaloneTaxa: boolean;
}): TaxaPaymentNotice {
  if (!params.status) {
    return {
      label: 'Cobrança não encontrada',
      description:
        'Não identificamos uma cobrança vinculada a esta taxa. Verifique a matrícula antes de tentar qualquer ação financeira.',
      variant: 'warning',
      labelTone: 'danger',
    };
  }

  if (params.isStandaloneTaxa && openTaxaStatuses.has(params.status)) {
    return {
      label: 'Cobrança familiar',
      description:
        'Esta taxa faz parte de uma cobrança familiar. Acompanhe os detalhes da cobrança agrupada antes de reenviar links ao responsável.',
      variant: 'info',
    };
  }

  switch (params.status) {
    case 'PAGO':
      return {
        label: 'Pagamento confirmado',
        description:
          'A taxa de matrícula foi confirmada. Use o comprovante ou os detalhes para consultar o histórico financeiro.',
        variant: 'info',
      };
    case 'ESTORNADO':
      return {
        label: 'Pagamento estornado',
        description:
          'O pagamento foi estornado. Não é permitido gerar segunda via desta cobrança; consulte os detalhes para auditoria e reconciliação.',
        variant: 'warning',
        labelTone: 'danger',
      };
    case 'ESTORNADO_PARCIAL':
      return {
        label: 'Estorno parcial',
        description:
          'Parte do pagamento foi estornada. Consulte os detalhes para conferir valores, eventos e conciliação antes de qualquer nova ação.',
        variant: 'warning',
        labelTone: 'caution',
      };
    case 'CANCELADO':
      return {
        label: 'Cobrança cancelada',
        description:
          'Esta cobrança foi cancelada e não deve ser reenviada. Consulte os detalhes para entender o motivo e o histórico.',
        variant: 'info',
        labelTone: 'muted',
      };
    case 'PROCESSANDO':
      return {
        label: 'Pagamento em processamento',
        description:
          'A confirmação ainda depende da atualização financeira. Aguarde o processamento ou consulte os detalhes da cobrança.',
        variant: 'warning',
      };
    case 'CANCELAMENTO_PENDENTE':
      return {
        label: 'Cancelamento pendente',
        description:
          'O cancelamento ainda está aguardando confirmação da integração financeira. Evite reenviar cobrança até a reconciliação.',
        variant: 'warning',
        labelTone: 'caution',
      };
    case 'ATRASADO':
      return {
        label: 'Pagamento atrasado',
        description:
          'A cobrança venceu e segue em aberto. Você pode gerar uma segunda via ou revisar os detalhes antes de falar com o responsável.',
        variant: 'warning',
        labelTone: 'danger',
      };
    case 'A_VENCER':
      return {
        label: 'Cobrança a vencer',
        description:
          'A cobrança está em aberto com vencimento futuro. Gere segunda via apenas se precisar reenviar os links ao responsável.',
        variant: 'info',
      };
    case 'PENDENTE':
    default:
      return {
        label: 'Aguardando pagamento',
        description:
          'A cobrança foi gerada. Você pode gerar uma segunda via ou reenviar os links de pagamento.',
        variant: 'warning',
      };
  }
}

const normalizePixQrCodeUrl = (value?: string | null): string | null => {
  if (!value) return null;
  const url = value.trim();
  if (!url.length) return null;
  if (url.startsWith('data:image/')) return url;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  return `data:image/png;base64,${url}`;
};

export function TaxaMatriculaSection({
  taxaMatricula,
  taxaIsenta,
  cobrancas,
  onRefresh,
}: TaxaMatriculaSectionProps) {
  const [loadingLinks, setLoadingLinks] = useState(false);
  const [taxaLinks, setTaxaLinks] = useState<ResendCobrancaData | null>(null);
  const [copyingPix, setCopyingPix] = useState(false);

  const taxaCobranca = useMemo(() => {
    return cobrancas.find((c) => c.tipo === 'TAXA_MATRICULA') ?? null;
  }, [cobrancas]);

  const isStandaloneTaxa = taxaCobranca?.origin === 'STANDALONE';
  const displayedTaxaValue = taxaCobranca ? taxaCobranca.valor : taxaMatricula;
  const taxaBadgeStatus = resolveTaxaBadgeStatus({
    taxaIsenta,
    status: taxaCobranca?.status,
  });
  const taxaNotice = resolveTaxaPaymentNotice({
    status: taxaCobranca?.status,
    isStandaloneTaxa,
  });
  const canGenerateSecondCopy =
    Boolean(taxaCobranca) &&
    !isStandaloneTaxa &&
    Boolean(taxaCobranca?.status && openTaxaStatuses.has(taxaCobranca.status));
  const canOpenReceipt = taxaCobranca?.status === 'PAGO';
  const detailsOnly =
    Boolean(taxaCobranca) &&
    Boolean(
      taxaCobranca?.status &&
        (terminalTaxaStatuses.has(taxaCobranca.status) ||
          taxaCobranca.status === 'PROCESSANDO' ||
          taxaCobranca.status === 'CANCELAMENTO_PENDENTE' ||
          isStandaloneTaxa),
    ) &&
    !canOpenReceipt;

  const handleCopyPix = useCallback(async (pixValue: string) => {
    if (!pixValue) return;
    try {
      setCopyingPix(true);
      await navigator.clipboard.writeText(pixValue);
      pushToast({
        title: 'PIX copiado',
        description: 'Código copiado para a área de transferência.',
        variant: 'success',
      });
    } catch (error) {
      pushToast({
        title: 'Erro ao copiar PIX',
        description: (error as Error).message || 'Não foi possível copiar o código.',
        variant: 'error',
      });
    } finally {
      setCopyingPix(false);
    }
  }, []);

  const handleGerarSegundaVia = useCallback(async () => {
    if (!taxaCobranca) return;

    try {
      setLoadingLinks(true);
      const res = await fetch(`/api/cobrancas/${taxaCobranca.id}/resend`, {
        method: 'POST',
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error?.message || 'Erro ao gerar segunda via');
      }

      const result = await res.json();
      const normalized: ResendCobrancaData = {
        ...result.data,
        pixQrCodeUrl: normalizePixQrCodeUrl(result.data?.pixQrCodeUrl ?? null),
      };
      setTaxaLinks(normalized);

      pushToast({
        title: 'Segunda via gerada',
        description: result.message || 'Links de pagamento atualizados',
        variant: 'success',
      });

      onRefresh();
    } catch (error) {
      pushToast({
        title: 'Erro ao gerar segunda via',
        description: (error as Error).message || 'Não foi possível gerar a segunda via.',
        variant: 'error',
      });
    } finally {
      setLoadingLinks(false);
    }
  }, [taxaCobranca, onRefresh]);

  const handleAbrirComprovante = useCallback(async () => {
    if (!taxaCobranca) return;
    try {
      const res = await fetch(`/api/cobrancas/${taxaCobranca.id}`);
      const json = (await res.json()) as {
        success?: boolean;
        data?: { asaasData?: { transactionReceiptUrl?: string; invoiceUrl?: string } };
      };
      const url = json?.data?.asaasData?.transactionReceiptUrl || json?.data?.asaasData?.invoiceUrl;
      if (url) {
        window.open(url, '_blank', 'noopener,noreferrer');
        return;
      }
    } catch {
      // ignore
    }
    window.open(`/cobrancas/${taxaCobranca.id}`, '_blank', 'noopener,noreferrer');
  }, [taxaCobranca]);

  return (
    <div className={sectionClass}>
      <div className="flex min-h-6 items-center gap-2">
        <span className="text-sm font-semibold text-slate-700">Taxa de Matrícula</span>
        <Badge status={taxaBadgeStatus} size="sm" />
      </div>
      <p className="text-xs text-slate-600 mb-4">Cobrança única referente à taxa de matrícula</p>

      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1">
            <label className={labelClass}>Valor da Taxa</label>
            <Input
              value={currency.format(displayedTaxaValue)}
              disabled
              className={controlClass}
              readOnly
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Status da Taxa</label>
            {taxaIsenta ? (
              <Input
                value="Isenta"
                disabled
                className={controlClass}
                readOnly
              />
            ) : (
              <Input
                value="Cobrável"
                disabled
                className={controlClass}
                readOnly
              />
            )}
          </div>
        </div>

        {!taxaIsenta && taxaCobranca && (
          <>
            <div className="grid grid-cols-2 gap-4">
              {taxaCobranca.vencimento && (
                <div className="space-y-1">
                  <label className={labelClass}>Vencimento</label>
                  <Input
                    value={dateFormat.format(new Date(taxaCobranca.vencimento))}
                    disabled
                    className={controlClass}
                    readOnly
                  />
                </div>
              )}
              {taxaCobranca.formaPagamento && (
                <div className="space-y-1">
                  <label className={labelClass}>Forma de Pagamento</label>
                  <Input
                    value={taxaCobranca.formaPagamento}
                    disabled
                    className={controlClass}
                    readOnly
                  />
                </div>
              )}
            </div>

            <div className="pt-2">
              <div className="space-y-3">
                <InfoCallout variant={taxaNotice.variant} size="sm">
                  <InfoCalloutItem label={taxaNotice.label} labelTone={taxaNotice.labelTone}>
                    {taxaNotice.description}
                  </InfoCalloutItem>
                </InfoCallout>

                {canOpenReceipt ? (
                  <div className="flex gap-2">
                    <Button
                      onClick={handleAbrirComprovante}
                      size="sm"
                      className="flex-1 bg-green-600 hover:bg-green-700 text-white shadow-none"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Ver Comprovante
                    </Button>
                    <Button
                      onClick={() => window.open(`/cobrancas/${taxaCobranca.id}`, '_blank', 'noopener,noreferrer')}
                      size="sm"
                      variant="outline"
                      className="flex-1 shadow-none border-slate-200 hover:bg-slate-100"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Ver Detalhes
                    </Button>
                  </div>
                ) : detailsOnly ? (
                  <div className="flex">
                    <Button
                      onClick={() => window.open(`/cobrancas/${taxaCobranca.id}`, '_blank', 'noopener,noreferrer')}
                      size="sm"
                      variant="outline"
                      className="w-full shadow-none border-slate-200 hover:bg-slate-100"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Ver Detalhes
                    </Button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    {canGenerateSecondCopy && (
                      <Button
                        onClick={handleGerarSegundaVia}
                        disabled={loadingLinks}
                        size="sm"
                        className="flex-1 bg-[#A94DFF] hover:bg-[#A94DFF]/90 text-white shadow-none"
                      >
                        <QrCode className="h-4 w-4 mr-2" />
                        {loadingLinks ? 'Gerando...' : 'Gerar Segunda Via'}
                      </Button>
                    )}
                    <Button
                      onClick={() => window.open(`/cobrancas/${taxaCobranca.id}`, '_blank', 'noopener,noreferrer')}
                      size="sm"
                      variant="outline"
                      className="flex-1 shadow-none border-slate-200 hover:bg-slate-100"
                    >
                      <ExternalLink className="h-4 w-4 mr-2" />
                      Ver Detalhes
                    </Button>
                  </div>
                )}

                {taxaLinks && canGenerateSecondCopy && (
                  <div className="rounded-lg border-2 border-indigo-200 bg-indigo-50 p-4 space-y-3">
                    <div className="flex items-start gap-2">
                      <svg className="h-5 w-5 text-indigo-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <p className="text-sm font-semibold text-indigo-900">
                        Links atualizados! Envie ao responsável financeiro:
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {taxaLinks.invoiceUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(taxaLinks.invoiceUrl!, '_blank', 'noopener,noreferrer')}
                          className="shadow-none bg-white hover:bg-indigo-50 border-indigo-300"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Checkout
                        </Button>
                      )}
                      {taxaLinks.bankSlipUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(taxaLinks.bankSlipUrl!, '_blank', 'noopener,noreferrer')}
                          className="shadow-none bg-white hover:bg-indigo-50 border-indigo-300"
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          Boleto
                        </Button>
                      )}
                      {taxaLinks.pixQrCodeUrl && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(taxaLinks.pixQrCodeUrl!, '_blank', 'noopener,noreferrer')}
                          className="shadow-none bg-white hover:bg-indigo-50 border-indigo-300"
                        >
                          <QrCode className="h-4 w-4 mr-2" />
                          QR Code PIX
                        </Button>
                      )}
                    </div>
                    {taxaLinks.pixCopyPaste && (
                      <div className="space-y-2">
                        <label className="text-xs font-semibold text-indigo-700 uppercase tracking-wide">
                          PIX copia e cola
                        </label>
                        <div className="flex items-center gap-2">
                          <Input
                            value={taxaLinks.pixCopyPaste}
                            readOnly
                            className="h-10 rounded-lg border border-indigo-300 bg-white px-3 text-xs font-mono text-slate-900 shadow-sm"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => handleCopyPix(taxaLinks.pixCopyPaste!)}
                            disabled={copyingPix}
                            className="shadow-none bg-white hover:bg-indigo-50 border-indigo-300"
                          >
                            <Copy className="h-4 w-4 mr-2" />
                            {copyingPix ? 'Copiando...' : 'Copiar'}
                          </Button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {!taxaIsenta && !taxaCobranca && (
          <InfoCallout variant={taxaNotice.variant} size="sm">
            <InfoCalloutItem label={taxaNotice.label} labelTone={taxaNotice.labelTone}>
              {taxaNotice.description}
            </InfoCalloutItem>
          </InfoCallout>
        )}
      </div>
    </div>
  );
}
