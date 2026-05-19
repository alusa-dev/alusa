'use client';

import { useState, useEffect } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { pushToast } from '@/components/ui/toast';
import { ArrowPathIcon } from '@heroicons/react/24/outline';
import { ChevronDown, ChevronUp } from '@/components/icons/icons';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';
import {
  formatDecimalFromNumber,
  maskDecimalInput,
  maskPercentInput,
  parseDecimal,
} from '@/lib/utils/decimal-format';

const mapDescontoTipo = (tipo?: string | null): 'percentual' | 'fixo' => {
  if (!tipo) return 'percentual';
  const normalized = tipo.toLowerCase();
  if (normalized === 'fixo' || normalized === 'valor_fixo') {
    return 'fixo';
  }
  return 'percentual';
};

const toInputValue = (value?: number | null) => {
  if (value === undefined || value === null) {
    return '0,00';
  }

  return formatDecimalFromNumber(value ?? 0);
};

type CobrancaEditarDialogProps = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  cobranca: {
    id: string;
    valor: number;
    vencimento: string;
    descricao?: string;
    asaasPaymentId?: string | null;
    jurosPercentual?: number | null;
    multaPercentual?: number | null;
    descontoTipo?: string | null;
    descontoValorFixo?: number | null;
    descontoPercentual?: number | null;
  };
  onSuccess?: () => void;
};

export function CobrancaEditarDialog({
  open,
  onOpenChange,
  cobranca,
  onSuccess,
}: CobrancaEditarDialogProps) {
  const [loading, setLoading] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [formData, setFormData] = useState<{
    valor: string;
    vencimento: string;
    descricao: string;
    juros: string;
    multa: string;
    desconto: string;
    descontoTipo: 'percentual' | 'fixo';
  }>({
    valor: '0,00',
    vencimento: '',
    descricao: '',
    juros: '0,00',
    multa: '0,00',
    desconto: '0,00',
    descontoTipo: 'percentual',
  });

  // Preencher formulário quando o modal abrir
  useEffect(() => {
    if (open && cobranca) {
      const descontoTipo = mapDescontoTipo(cobranca.descontoTipo);
      const descontoValue =
        descontoTipo === 'fixo'
          ? toInputValue(cobranca.descontoValorFixo)
          : toInputValue(cobranca.descontoPercentual);

      setFormData({
        valor: formatDecimalFromNumber(cobranca.valor),
        vencimento: cobranca.vencimento.split('T')[0], // YYYY-MM-DD
        descricao: cobranca.descricao || '',
        juros: toInputValue(cobranca.jurosPercentual),
        multa: toInputValue(cobranca.multaPercentual),
        desconto: descontoValue,
        descontoTipo,
      });
    }
  }, [open, cobranca]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      // Validações
      const valor = parseDecimal(formData.valor);
      if (isNaN(valor) || valor <= 0) {
        throw new Error('Valor deve ser maior que zero');
      }

      if (!formData.vencimento) {
        throw new Error('Data de vencimento é obrigatória');
      }

      // Preparar payload
      const payload: {
        valor: number;
        vencimento: string;
        descricao?: string;
        juros?: number;
        multa?: number;
        desconto?: number;
        descontoTipo?: 'percentual' | 'fixo';
        descontoPrazoMaximo?: string;
      } = {
        valor,
        vencimento: formData.vencimento,
        descricao: formData.descricao || undefined,
      };

      // Adicionar juros, multa e desconto se preenchidos e se houver integração Asaas
      if (cobranca.asaasPaymentId) {
        const juros = parseDecimal(formData.juros);
        if (juros > 0) {
          payload.juros = juros;
        }

        const multa = parseDecimal(formData.multa);
        if (multa > 0) {
          payload.multa = multa;
        }

        const desconto = parseDecimal(formData.desconto);
        if (desconto > 0) {
          payload.desconto = desconto;
          payload.descontoTipo = formData.descontoTipo;
          payload.descontoPrazoMaximo = 'ATE_VENCIMENTO';
        }
      }

      // Atualizar cobrança
      const res = await fetch(`/api/cobrancas/${cobranca.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error || 'Erro ao atualizar cobrança');
      }

      pushToast({
        title: 'Solicitação enviada',
        description:
          result.message ||
          'Alteração enviada para processamento financeiro da Alusa. Aguarde alguns instantes para a atualização refletir.',
        variant: 'success',
      });

      onOpenChange(false);
      onSuccess?.();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Erro desconhecido';
      pushToast({
        title: 'Erro',
        description: errorMessage,
        variant: 'error',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDecimalFieldChange = (
    field: 'valor' | 'juros' | 'multa' | 'desconto',
    value: string,
  ) => {
    const usePercentMask = field === 'juros' || field === 'multa' || (field === 'desconto' && formData.descontoTipo === 'percentual');
    const formatted = usePercentMask ? maskPercentInput(value) : maskDecimalInput(value);
    setFormData((prev) => ({
      ...prev,
      [field]: formatted || '0,00',
    }));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        fullScreenMobile
        className="max-w-lg gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl"
      >
        <DialogHeader className="relative shrink-0 space-y-0 border-b border-slate-200 bg-slate-50 px-4 py-4 text-left max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
          <DialogTitle className="pr-2 text-lg font-semibold text-slate-900 md:pr-0">Editar Cobrança</DialogTitle>
          <DialogDescription className="mt-1.5 text-sm text-slate-600">
            Ajuste valor, vencimento e descrição. Opções avançadas dependem da integração financeira.
          </DialogDescription>
        </DialogHeader>

        <form
          onSubmit={handleSubmit}
          className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0"
        >
          <div className="flex-1 space-y-6 overflow-y-auto px-4 py-5 max-md:min-h-0 md:px-6">
          {/* Valor */}
          <div className="space-y-2">
            <Label htmlFor="valor">
              Valor <span className="text-red-500">*</span>
            </Label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500">R$</span>
              <Input
                id="valor"
                type="text"
                inputMode="decimal"
                value={formData.valor}
                onChange={(e) => handleDecimalFieldChange('valor', e.target.value)}
                className="pl-12"
                placeholder="0,00"
                required
                disabled={loading}
              />
            </div>
            <p className="text-xs text-gray-500">
              Valor da cobrança. Use vírgula ou ponto para separar os decimais.
            </p>
          </div>

          {/* Vencimento */}
          <div className="space-y-2">
            <Label htmlFor="vencimento">
              Data de Vencimento <span className="text-red-500">*</span>
            </Label>
            <Input
              id="vencimento"
              type="date"
              value={formData.vencimento}
              onChange={(e) => setFormData({ ...formData, vencimento: e.target.value })}
              required
              disabled={loading}
            />
            <p className="text-xs text-gray-500">
              Data em que a cobrança vence. Pode ser alterada se a cobrança ainda não foi paga.
            </p>
          </div>

          {/* Descrição */}
          <div className="space-y-2">
            <Label htmlFor="descricao">Descrição (opcional)</Label>
            <Textarea
              id="descricao"
              value={formData.descricao}
              onChange={(e) => setFormData({ ...formData, descricao: e.target.value })}
              placeholder="Ex: Mensalidade de Janeiro/2025"
              rows={3}
              disabled={loading}
            />
            <p className="text-xs text-gray-500">
              Descrição adicional da cobrança que será exibida na fatura.
            </p>
          </div>

          {/* Seção Avançada - Juros, Multa e Desconto */}
          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="flex items-center gap-2 text-sm font-medium text-gray-700 hover:text-gray-900 transition-colors"
            >
              {showAdvanced ? (
                <>
                  <ChevronUp className="h-4 w-4" />
                  Ocultar configurações avançadas
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4" />
                  Configurações avançadas (juros, multa, desconto)
                </>
              )}
            </button>

            {showAdvanced && (
              <div className="mt-4 space-y-4 p-4 bg-gray-50 rounded-lg">
                {/* Juros */}
                <div className="space-y-2">
                  <Label htmlFor="juros">Juros (% ao mês)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                      %
                    </span>
                    <Input
                      id="juros"
                      type="text"
                      inputMode="decimal"
                      value={formData.juros}
                      onChange={(e) => handleDecimalFieldChange('juros', e.target.value)}
                      placeholder="0,00"
                      disabled={loading}
                      className="pl-10 text-right"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Juros mensal para pagamentos em atraso. Ex: 1% ao mês
                  </p>
                </div>

                {/* Multa */}
                <div className="space-y-2">
                  <Label htmlFor="multa">Multa (%)</Label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                      %
                    </span>
                    <Input
                      id="multa"
                      type="text"
                      inputMode="decimal"
                      value={formData.multa}
                      onChange={(e) => handleDecimalFieldChange('multa', e.target.value)}
                      placeholder="0,00"
                      disabled={loading}
                      className="pl-10 text-right"
                    />
                  </div>
                  <p className="text-xs text-gray-500">
                    Multa por atraso no pagamento. Ex: 2% de multa
                  </p>
                </div>

                {/* Desconto */}
                <div className="space-y-2">
                  <Label htmlFor="desconto">Desconto</Label>
                  <div className="flex gap-2">
                    <select
                      id="descontoTipo"
                      value={formData.descontoTipo}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          descontoTipo: e.target.value as 'percentual' | 'fixo',
                        })
                      }
                      className="border rounded px-2 py-1 text-sm"
                      disabled={loading}
                    >
                      <option value="percentual">Percentual (%)</option>
                      <option value="fixo">Valor fixo (R$)</option>
                    </select>
                    <div className="relative w-32">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 text-sm">
                        {formData.descontoTipo === 'percentual' ? '%' : 'R$'}
                      </span>
                      <Input
                        id="desconto"
                        type="text"
                        inputMode="decimal"
                        value={formData.desconto}
                        onChange={(e) => handleDecimalFieldChange('desconto', e.target.value)}
                        placeholder="0,00"
                        disabled={loading}
                        className="pl-10 text-right"
                      />
                    </div>
                  </div>
                  <div className="flex gap-2 items-center mt-2">
                    <Label htmlFor="prazoMaximo" className="text-xs">
                      Prazo máximo do desconto
                    </Label>
                    <select
                      id="prazoMaximo"
                      value="0"
                      disabled
                      className="border rounded px-2 py-1 text-xs bg-gray-100"
                    >
                      <option value="0">Até o dia do vencimento</option>
                    </select>
                  </div>
                  <p className="text-xs text-gray-500">
                    O desconto só será aplicado até o dia do vencimento, conforme regra da plataforma financeira.
                  </p>
                </div>

                <InfoCallout size="sm" className="rounded-lg">
                  <InfoCalloutItem label="Nota" labelTone="default">
                    Juros, multa e desconto são aplicados apenas se a cobrança estiver integrada com a
                    plataforma financeira da Alusa.
                  </InfoCalloutItem>
                </InfoCallout>
              </div>
            )}
          </div>

          </div>

          <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={loading}
              className="h-11 min-h-11 w-full min-w-0 md:h-10 md:min-h-0 md:w-auto"
            >
              Cancelar
            </Button>
            <Button
              type="submit"
              disabled={loading}
              className="h-11 min-h-11 w-full min-w-0 bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:w-auto"
            >
              {loading && <ArrowPathIcon className="mr-2 h-4 w-4 animate-spin" />}
              {loading ? 'Salvando...' : 'Salvar alterações'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
