'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ChatBubbleLeftRightIcon,
  DevicePhoneMobileIcon,
  EnvelopeIcon,
  InformationCircleIcon,
} from '@heroicons/react/24/outline';
import { pushToast } from '@/components/ui/toast';
import useCurrentUser from '@/hooks/use-current-user';

interface ConfiguracoesPagamentoProps {
  matriculaId: string;
  asaasSubscriptionId?: string | null;
  assinaturaSnapshot?: {
    billingType?: 'BOLETO' | 'PIX' | 'CREDIT_CARD' | 'UNDEFINED' | null;
    nextDueDate?: string | null;
    value?: number | null;
    status?: 'ACTIVE' | 'INACTIVE' | 'EXPIRED';
    syncError?: string | null;
  } | null;
  jurosAtual?: number;
  jurosTipoAtual?: 'FIXED' | 'PERCENTAGE';
  multaAtual?: number;
  multaTipoAtual?: 'FIXED' | 'PERCENTAGE';
  descontoAtual?: number;
  descontoTipoAtual?: 'FIXED' | 'PERCENTAGE';
  prazoDescontoAtual?: number;
  onRefresh: () => void;
}

// Função para formatar valores percentuais
function formatPercentInput(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (!digits) return '0,00';
  
  const num = parseInt(digits, 10);
  const intPart = Math.floor(num / 100);
  const decPart = (num % 100).toString().padStart(2, '0');
  
  return `${intPart},${decPart}`;
}

// Função para converter string formatada para número
function parsePercent(formatted: string): number {
  const normalized = formatted.replace(/\./g, '').replace(',', '.');
  const num = parseFloat(normalized);
  return isNaN(num) ? 0 : num;
}

// Função para formatar número para display
function numberToPercent(value?: number): string {
  if (!value) return '0,00';
  const intPart = Math.floor(value);
  const decPart = Math.round((value - intPart) * 100).toString().padStart(2, '0');
  return `${intPart},${decPart}`;
}

const FORMA_PAGAMENTO_LABELS: Record<string, string> = {
  BOLETO: 'Boleto Bancário',
  PIX: 'PIX',
  CREDIT_CARD: 'Cartão de Crédito',
  CARTAO_CREDITO: 'Cartão de Crédito',
  UNDEFINED: 'Pergunte ao cliente',
  INDEFINIDO: 'Pergunte ao cliente',
};

const sectionClass = 'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
const labelClass = 'text-xs font-medium text-slate-600';
const controlClass =
  'flex h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed';

export function ConfiguracoesPagamento({
  matriculaId,
  asaasSubscriptionId,
  assinaturaSnapshot,
  jurosAtual,
  jurosTipoAtual,
  multaAtual,
  multaTipoAtual,
  descontoAtual,
  descontoTipoAtual,
  prazoDescontoAtual,
  onRefresh,
}: ConfiguracoesPagamentoProps) {
  const { user } = useCurrentUser();
  const contaId = user?.contaId ?? null;

  const [editandoFormaPagamento, setEditandoFormaPagamento] = useState(false);
  const [editandoJurosMulta, setEditandoJurosMulta] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [salvandoNotificacoes, setSalvandoNotificacoes] = useState(false);
  const [carregandoNotificacoes, setCarregandoNotificacoes] = useState(false);
  const notificacaoRequestRef = useRef(0);

  // Estados para forma de pagamento
  const [novaFormaPagamento, setNovaFormaPagamento] = useState<string>('BOLETO');
  const [formaPagamentoDisplay, setFormaPagamentoDisplay] = useState<string>('Boleto Bancário');

  // Estados para juros, multa e desconto (padrão Asaas API)
  const [jurosPercentual, setJurosPercentual] = useState('2,00');
  const [jurosTipo, setJurosTipo] = useState<'FIXED' | 'PERCENTAGE'>('PERCENTAGE');
  const [multaPercentual, setMultaPercentual] = useState('2,00');
  const [multaTipo, setMultaTipo] = useState<'FIXED' | 'PERCENTAGE'>('PERCENTAGE');
  const [descontoPercentual, setDescontoPercentual] = useState('0,00');
  const [descontoTipo, setDescontoTipo] = useState<'FIXED' | 'PERCENTAGE'>('PERCENTAGE');
  const [prazoDesconto, setPrazoDesconto] = useState(0);
  const [canaisNotificacao, setCanaisNotificacao] = useState({
    email: false,
    sms: false,
    whatsapp: false,
  });
  const [canaisNotificacaoIndisponiveis, setCanaisNotificacaoIndisponiveis] = useState({
    email: false,
    sms: false,
    whatsapp: false,
  });
  const [resumoNotificacoes, setResumoNotificacoes] = useState<{
    customerId: string;
    notificationCount: number;
    warnings: Array<{
      channel: 'email' | 'sms' | 'whatsapp';
      code: string;
      message: string;
    }>;
  } | null>(null);
  const [erroNotificacoes, setErroNotificacoes] = useState<string | null>(null);
  
  // Limites segundo documentação Asaas
  const LIMITE_JUROS_MAX = 10; // 10% ao mês (máximo Asaas)
  const LIMITE_MULTA_RECOMENDADO = 2; // 2% (recomendação legal)
  const LIMITE_MULTA_MAX = 10; // 10% (máximo técnico)
  const editButtonClass = 'h-10 rounded-md border border-slate-300 bg-white px-4 text-sm font-medium text-slate-700 hover:bg-slate-50';
  const subscriptionStatusLabel =
    assinaturaSnapshot?.status === 'ACTIVE'
      ? 'Ativa'
      : assinaturaSnapshot?.status === 'INACTIVE'
        ? 'Inativa'
        : assinaturaSnapshot?.status === 'EXPIRED'
          ? 'Expirada'
          : 'Sem leitura atual';
  
  // Validações
  const jurosValor = parsePercent(jurosPercentual);
  const multaValor = parsePercent(multaPercentual);
  const jurosExcedeLimite = jurosValor > LIMITE_JUROS_MAX;
  const multaExcedeRecomendado = multaValor > LIMITE_MULTA_RECOMENDADO;
  const multaExcedeMaximo = multaValor > LIMITE_MULTA_MAX;

  // Inicializar valores ao carregar (apenas quando não está editando)
  useEffect(() => {
    if (assinaturaSnapshot?.billingType) {
      setNovaFormaPagamento(assinaturaSnapshot.billingType);
      setFormaPagamentoDisplay(
        FORMA_PAGAMENTO_LABELS[assinaturaSnapshot.billingType] || assinaturaSnapshot.billingType,
      );
    }
    
    // Só atualiza os valores de juros/multa/desconto se não estiver editando
    if (!editandoJurosMulta) {
      if (jurosAtual !== undefined) {
        setJurosPercentual(numberToPercent(jurosAtual));
      }
      if (jurosTipoAtual) {
        setJurosTipo(jurosTipoAtual);
      }
      if (multaAtual !== undefined) {
        setMultaPercentual(numberToPercent(multaAtual));
      }
      if (multaTipoAtual) {
        setMultaTipo(multaTipoAtual);
      }
      if (descontoAtual !== undefined) {
        setDescontoPercentual(numberToPercent(descontoAtual));
      }
      if (descontoTipoAtual) {
        setDescontoTipo(descontoTipoAtual);
      }
      if (prazoDescontoAtual !== undefined) {
        setPrazoDesconto(prazoDescontoAtual);
      }
    }
  }, [assinaturaSnapshot?.billingType, jurosAtual, jurosTipoAtual, multaAtual, multaTipoAtual, descontoAtual, descontoTipoAtual, prazoDescontoAtual, editandoJurosMulta]);

  useEffect(() => {
    if (!asaasSubscriptionId) {
      setErroNotificacoes('Os canais automáticos ficam disponíveis quando a matrícula possui vínculo financeiro ativo.');
      return;
    }

    let active = true;
    const loadNotifications = async () => {
      try {
        setCarregandoNotificacoes(true);
        setErroNotificacoes(null);
        const response = await fetch(`/api/matriculas/${matriculaId}/notificacoes`, {
          cache: 'no-store',
        });
        const json = await response.json().catch(() => null);
        if (!response.ok) {
          throw new Error(json?.error?.message || 'Não foi possível carregar os canais automáticos.');
        }
        if (!active) return;
        setCanaisNotificacao(json.channels);
        setCanaisNotificacaoIndisponiveis({ email: false, sms: false, whatsapp: false });
        setResumoNotificacoes({
          customerId: json.customerId,
          notificationCount: json.notificationCount,
          warnings: (json.warnings ?? []).map((warning: { channel: 'email' | 'sms' | 'whatsapp'; code: string; message: string }) => ({
            channel: warning.channel,
            code: warning.code,
            message: warning.message,
          })),
        });
      } catch (error) {
        if (!active) return;
        setErroNotificacoes((error as Error).message);
      } finally {
        if (active) {
          setCarregandoNotificacoes(false);
        }
      }
    };

    void loadNotifications();
    return () => {
      active = false;
    };
  }, [asaasSubscriptionId, matriculaId]);

  const handleCancelarFormaPagamento = useCallback(() => {
    if (assinaturaSnapshot?.billingType) {
      setNovaFormaPagamento(assinaturaSnapshot.billingType);
    }
    setEditandoFormaPagamento(false);
  }, [assinaturaSnapshot?.billingType]);

  const handleCancelarJurosMulta = useCallback(() => {
    if (jurosAtual !== undefined) {
      setJurosPercentual(numberToPercent(jurosAtual));
    }
    if (jurosTipoAtual) {
      setJurosTipo(jurosTipoAtual);
    } else {
      setJurosTipo('PERCENTAGE');
    }
    if (multaAtual !== undefined) {
      setMultaPercentual(numberToPercent(multaAtual));
    }
    if (multaTipoAtual) {
      setMultaTipo(multaTipoAtual);
    } else {
      setMultaTipo('PERCENTAGE');
    }
    if (descontoAtual !== undefined) {
      setDescontoPercentual(numberToPercent(descontoAtual));
    } else {
      setDescontoPercentual('0,00');
    }
    if (descontoTipoAtual) {
      setDescontoTipo(descontoTipoAtual);
    } else {
      setDescontoTipo('PERCENTAGE');
    }
    if (prazoDescontoAtual !== undefined) {
      setPrazoDesconto(prazoDescontoAtual);
    } else {
      setPrazoDesconto(0);
    }
    setEditandoJurosMulta(false);
  }, [jurosAtual, jurosTipoAtual, multaAtual, multaTipoAtual, descontoAtual, descontoTipoAtual, prazoDescontoAtual]);

  const handleSalvarFormaPagamento = useCallback(async () => {
    if (!asaasSubscriptionId) {
      pushToast({
        title: 'Erro',
        description: 'Esta matrícula não possui assinatura financeira ativa.',
        variant: 'error',
      });
      return;
    }

    if (!contaId) {
      pushToast({
        title: 'Erro',
        description: 'Usuário não autenticado.',
        variant: 'error',
      });
      return;
    }

    try {
      setSalvando(true);

      const res = await fetch(`/api/matriculas/${matriculaId}/forma-pagamento`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          billingType: novaFormaPagamento,
          contaId,
        }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error?.message || 'Erro ao atualizar forma de pagamento');
      }

      pushToast({
        title: 'Forma de pagamento atualizada',
        description: 'Os próximos ciclos usarão essa forma de pagamento.',
        variant: 'success',
      });

      setFormaPagamentoDisplay(FORMA_PAGAMENTO_LABELS[novaFormaPagamento] || novaFormaPagamento);
      setEditandoFormaPagamento(false);
      onRefresh();
    } catch (error) {
      pushToast({
        title: 'Erro ao atualizar',
        description: (error as Error).message || 'Não foi possível atualizar a forma de pagamento.',
        variant: 'error',
      });
    } finally {
      setSalvando(false);
    }
  }, [asaasSubscriptionId, matriculaId, novaFormaPagamento, contaId, onRefresh]);

  const handleSalvarJurosMulta = useCallback(async () => {
    if (!asaasSubscriptionId) {
      pushToast({
        title: 'Erro',
        description: 'Esta matrícula não possui assinatura financeira ativa.',
        variant: 'error',
      });
      return;
    }

    if (!contaId) {
      pushToast({
        title: 'Erro',
        description: 'Usuário não autenticado.',
        variant: 'error',
      });
      return;
    }

    const juros = parsePercent(jurosPercentual);
    const multa = parsePercent(multaPercentual);
    const desconto = parsePercent(descontoPercentual);
    
    // Validar limites (apenas para PERCENTAGE)
    if (jurosTipo === 'PERCENTAGE' && juros > LIMITE_JUROS_MAX) {
      pushToast({
        title: 'Juros acima do limite',
        description: `O sistema permite juros de até ${LIMITE_JUROS_MAX}% ao mês. Por favor, ajuste o valor.`,
        variant: 'error',
      });
      return;
    }
    
    if (multaTipo === 'PERCENTAGE' && multa > LIMITE_MULTA_MAX) {
      pushToast({
        title: 'Multa acima do limite',
        description: `O sistema permite multa de até ${LIMITE_MULTA_MAX}%. Por favor, ajuste o valor.`,
        variant: 'error',
      });
      return;
    }

    try {
      setSalvando(true);

      const payload: {
        interest: { value: number; type: 'FIXED' | 'PERCENTAGE' };
        fine: { value: number; type: 'FIXED' | 'PERCENTAGE' };
        discount?: { value: number; type: 'FIXED' | 'PERCENTAGE'; dueDateLimitDays: number };
        contaId: string;
      } = {
        interest: {
          value: juros,
          type: jurosTipo,
        },
        fine: {
          value: multa,
          type: multaTipo,
        },
        contaId,
      };

      payload.discount = {
        value: desconto,
        type: descontoTipo,
        dueDateLimitDays: desconto > 0 ? prazoDesconto : 0,
      };

      console.log('🔵 [FRONTEND] Payload a ser enviado:', JSON.stringify(payload, null, 2));
      console.log('🔵 [FRONTEND] URL:', `/api/matriculas/${matriculaId}/juros-multa`);

      const res = await fetch(`/api/matriculas/${matriculaId}/juros-multa`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error?.message || 'Erro ao atualizar juros e multa');
      }

      await res.json();

      pushToast({
        title: 'Sucesso',
        description: desconto > 0 
          ? 'Juros, multa e desconto atualizados. Próximas cobranças usarão estes valores.'
          : 'Juros e multa atualizados. Próximas cobranças usarão estes valores.',
        variant: 'success',
      });

      await onRefresh();
      setEditandoJurosMulta(false);
    } catch (error) {
      pushToast({
        title: 'Erro ao atualizar',
        description: (error as Error).message || 'Não foi possível atualizar juros e multa.',
        variant: 'error',
      });
    } finally {
      setSalvando(false);
    }
  }, [asaasSubscriptionId, matriculaId, jurosPercentual, multaPercentual, contaId, onRefresh, LIMITE_JUROS_MAX, LIMITE_MULTA_MAX]);

  const handleSalvarNotificacoes = useCallback(async (nextChannels: typeof canaisNotificacao) => {
    const requestId = notificacaoRequestRef.current + 1;
    notificacaoRequestRef.current = requestId;
    setSalvandoNotificacoes(true);
    try {
      const response = await fetch(`/api/matriculas/${matriculaId}/notificacoes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channels: nextChannels }),
      });

      const json = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(json?.error?.message || 'Não foi possível atualizar os canais automáticos.');
      }

      if (requestId !== notificacaoRequestRef.current) {
        return;
      }

      const unavailableChannels = {
        email: Boolean(
          (json.warnings ?? []).some(
            (warning: { channel: 'email' | 'sms' | 'whatsapp' }) =>
              warning.channel === 'email' && !json.channels.email,
          ),
        ),
        sms: Boolean(
          (json.warnings ?? []).some(
            (warning: { channel: 'email' | 'sms' | 'whatsapp' }) =>
              warning.channel === 'sms' && !json.channels.sms,
          ),
        ),
        whatsapp: Boolean(
          (json.warnings ?? []).some(
            (warning: { channel: 'email' | 'sms' | 'whatsapp' }) =>
              warning.channel === 'whatsapp' && !json.channels.whatsapp,
          ),
        ),
      };

      setCanaisNotificacao(json.channels);
      setCanaisNotificacaoIndisponiveis(unavailableChannels);
      setResumoNotificacoes({
        customerId: json.customerId,
        notificationCount: json.notificationCount,
        warnings: (json.warnings ?? []).map((warning: { channel: 'email' | 'sms' | 'whatsapp'; code: string; message: string }) => ({
          channel: warning.channel,
          code: warning.code,
          message: warning.message,
        })),
      });

      const whatsappIndisponivel = unavailableChannels.whatsapp && nextChannels.whatsapp;

      pushToast({
        title: whatsappIndisponivel ? 'Canal com limitação' : 'Canais de aviso atualizados',
        description: whatsappIndisponivel
          ? 'O WhatsApp não está disponível para esta configuração. E-mail e SMS continuam sincronizados normalmente.'
          : json.message || 'A comunicação automática da Alusa foi atualizada.',
        variant: whatsappIndisponivel ? 'error' : 'success',
      });
    } finally {
      if (requestId === notificacaoRequestRef.current) {
        setSalvandoNotificacoes(false);
      }
    }
  }, [matriculaId]);

  const toggleNotificationChannel = useCallback(
    async (channel: 'email' | 'sms' | 'whatsapp') => {
      if (
        !asaasSubscriptionId ||
        carregandoNotificacoes ||
        salvandoNotificacoes ||
        Boolean(erroNotificacoes) ||
        canaisNotificacaoIndisponiveis[channel]
      ) {
        return;
      }

      const previousChannels = canaisNotificacao;
      const nextChannels = {
        ...previousChannels,
        [channel]: !previousChannels[channel],
      };

      setCanaisNotificacao(nextChannels);

      try {
        await handleSalvarNotificacoes(nextChannels);
      } catch (error) {
        setCanaisNotificacao(previousChannels);
        pushToast({
          title: 'Erro ao atualizar canais',
          description: (error as Error).message,
          variant: 'error',
        });
      }
    },
    [asaasSubscriptionId, canaisNotificacao, carregandoNotificacoes, erroNotificacoes, handleSalvarNotificacoes],
  );

  const notificationButtons = [
    {
      key: 'whatsapp' as const,
      label: 'WhatsApp',
      icon: ChatBubbleLeftRightIcon,
    },
    {
      key: 'email' as const,
      label: 'E-mail',
      icon: EnvelopeIcon,
    },
    {
      key: 'sms' as const,
      label: 'SMS',
      icon: DevicePhoneMobileIcon,
    },
  ];

  const notificationHint = resumoNotificacoes?.warnings.find(
    (warning) => canaisNotificacaoIndisponiveis[warning.channel],
  );

  return (
    <div className={sectionClass}>
      <span className="text-sm font-semibold text-slate-700">Configurações de Pagamento</span>
      <p className="text-xs text-slate-600 mb-4">
        Configure os campos editáveis do vínculo recorrente. As alterações passam pela integração financeira da Alusa e valem para os próximos ciclos e para pendências que ainda possam ser ajustadas.
      </p>

      <div className="space-y-6">
        {/* Informações Gerais */}
        <div className="space-y-3">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className={labelClass}>Forma de Pagamento Atual</label>
              <Input
                value={formaPagamentoDisplay}
                disabled
                className={controlClass}
                readOnly
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <label className={labelClass}>Próximo vencimento</label>
              <Input
                value={assinaturaSnapshot?.nextDueDate ? new Date(`${assinaturaSnapshot.nextDueDate}T12:00:00Z`).toLocaleDateString('pt-BR') : 'Não informado'}
                disabled
                className={controlClass}
                readOnly
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Status da assinatura</label>
              <Input
                value={subscriptionStatusLabel}
                disabled
                className={controlClass}
                readOnly
              />
            </div>
          </div>
          {assinaturaSnapshot?.syncError ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              <strong>Leitura parcial:</strong> não foi possível consultar o estado financeiro atual. Você ainda pode tentar salvar, mas a confirmação final depende da sincronização da Alusa.
            </div>
          ) : null}
        </div>

        {/* Forma de Pagamento */}
        <div className="space-y-3 pt-4 border-t border-slate-200">
          <div className="flex items-start justify-between">
            <div>
              <label className="text-sm font-semibold text-slate-700">
                Alterar Forma de Pagamento
              </label>
              <p className="text-xs text-slate-600 mt-1">
                Altera a forma de pagamento do vínculo recorrente. O reflexo financeiro é assíncrono e pode alcançar cobranças pendentes editáveis.
              </p>
            </div>
            {!editandoFormaPagamento ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditandoFormaPagamento(true)}
                disabled={!asaasSubscriptionId}
                className={editButtonClass}
              >
                Editar
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelarFormaPagamento}
                  disabled={salvando}
                  className="border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleSalvarFormaPagamento}
                  disabled={salvando}
                  className="bg-[#A94DFF] text-white shadow-none hover:bg-[#A94DFF]/90"
                >
                  {salvando ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            )}
          </div>

          <div className="space-y-1">
            <label htmlFor="formaPagamento" className={labelClass}>
              Selecione a forma de pagamento
            </label>
            <Select
              value={novaFormaPagamento}
              onValueChange={setNovaFormaPagamento}
              disabled={!editandoFormaPagamento}
            >
              <SelectTrigger className="h-10 w-full rounded-lg border border-slate-200 bg-white text-sm text-slate-900 shadow-sm focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="BOLETO">Boleto Bancário</SelectItem>
                <SelectItem value="PIX">PIX</SelectItem>
                <SelectItem value="CREDIT_CARD">Cartão de Crédito</SelectItem>
                <SelectItem value="UNDEFINED">Pergunte ao cliente</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {editandoFormaPagamento && (
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
              <p className="text-xs text-blue-800">
                <strong>Importante:</strong> esta alteração afeta apenas os próximos ciclos. Cobranças já geradas podem exigir uma nova sincronização para refletir a mudança.
              </p>
            </div>
          )}
        </div>

        <div className="space-y-3 pt-4 border-t border-slate-200">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <label className="text-sm font-semibold text-slate-700">Canais de aviso</label>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        className="inline-flex h-5 w-5 items-center justify-center rounded-full text-slate-400 transition hover:text-slate-600"
                      >
                        <InformationCircleIcon className="h-4 w-4" />
                      </button>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs">
                      A Alusa usa esses canais para avisos automáticos de cobrança do responsável financeiro. Se algum canal não estiver disponível na conta, o sistema ajusta a entrega sem perder a trilha de auditoria.
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <p className="text-xs text-slate-600 mt-1">
                Escolha os canais de aviso da Alusa para o responsável financeiro. A atualização é aplicada imediatamente.
              </p>
            </div>
          </div>

          {erroNotificacoes ? (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
              <strong>Comunicação automática:</strong> {erroNotificacoes}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-3">
            {notificationButtons.map((item) => {
              const Icon = item.icon;
              const enabled = canaisNotificacao[item.key];
              const unavailable = canaisNotificacaoIndisponiveis[item.key];
              const disabled =
                !asaasSubscriptionId ||
                carregandoNotificacoes ||
                salvandoNotificacoes ||
                Boolean(erroNotificacoes) ||
                unavailable;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => void toggleNotificationChannel(item.key)}
                  disabled={disabled}
                  aria-pressed={enabled}
                  className={`inline-flex min-w-[132px] items-center justify-center gap-2 rounded-full border px-5 py-3 text-sm font-semibold transition ${
                    unavailable
                      ? 'border-slate-200 bg-slate-100 text-slate-400'
                      : enabled
                        ? 'border-[#1D4ED8] bg-[#1D4ED8] text-white shadow-sm'
                        : 'border-[#1D4ED8] bg-white text-[#1D4ED8] hover:bg-[#EFF6FF]'
                  } ${disabled ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <Icon className="h-5 w-5 shrink-0" />
                  {item.label}
                </button>
              );
            })}
          </div>

          {salvandoNotificacoes ? <p className="text-xs text-slate-500">Atualizando canais...</p> : null}
        </div>

        {/* Juros, Multa e Desconto */}
        <div className="space-y-3 pt-4 border-t border-slate-200">
          <div className="flex items-start justify-between">
            <div>
              <label className="text-sm font-semibold text-slate-700">
                Juros, Multa e Desconto
              </label>
              <p className="text-xs text-slate-600 mt-1">
                Configure juros, multa e desconto do vínculo recorrente da Alusa.
              </p>
            </div>
            {!editandoJurosMulta ? (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setEditandoJurosMulta(true)}
                disabled={!asaasSubscriptionId}
                className={editButtonClass}
              >
                Editar
              </Button>
            ) : (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCancelarJurosMulta}
                  disabled={salvando}
                  className="border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={handleSalvarJurosMulta}
                  disabled={salvando}
                  className="bg-[#A94DFF] text-white shadow-none hover:bg-[#A94DFF]/90"
                >
                  {salvando ? 'Salvando...' : 'Salvar'}
                </Button>
              </div>
            )}
          </div>

          {/* Juros - Valor e Tipo */}
          <div className="space-y-3 p-4 bg-slate-50/50 rounded-lg border border-slate-100">
            <label className="text-xs font-semibold text-slate-700">Juros ao Mês</label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="jurosPercentual" className={labelClass}>
                  Valor
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                    {jurosTipo === 'PERCENTAGE' ? '%' : 'R$'}
                  </span>
                  <Input
                    id="jurosPercentual"
                    type="text"
                    value={jurosPercentual}
                    onChange={(e) => {
                      if (!editandoJurosMulta) return;
                      const rawValue = e.target.value;
                      if (rawValue === '' && jurosPercentual !== '0,00') return;
                      setJurosPercentual(formatPercentInput(rawValue));
                    }}
                    disabled={!editandoJurosMulta}
                    className={`pl-8 text-right h-10 rounded-lg border px-3 text-sm shadow-sm transition focus:outline-none focus:ring-2 ${
                      jurosTipo === 'PERCENTAGE' && jurosExcedeLimite && editandoJurosMulta
                        ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-400 focus:ring-red-400/30'
                        : 'border-slate-200 bg-white text-slate-900 focus:border-[#A94DFF] focus:ring-[#A94DFF]/30'
                    } disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed`}
                    placeholder="2,00"
                  />
                </div>
                {editandoJurosMulta && jurosTipo === 'PERCENTAGE' && jurosExcedeLimite && (
                  <p className="text-xs text-red-600 mt-1">
                    Limite máximo: {LIMITE_JUROS_MAX}% ao mês
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label htmlFor="jurosTipo" className={labelClass}>
                  Tipo
                </label>
                <Select
                  value={jurosTipo}
                  onValueChange={(v) => setJurosTipo(v as 'FIXED' | 'PERCENTAGE')}
                  disabled={!editandoJurosMulta}
                >
                  <SelectTrigger className={controlClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">Percentual (%)</SelectItem>
                    <SelectItem value="FIXED">Valor Fixo (R$)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Multa - Valor e Tipo */}
          <div className="space-y-3 p-4 bg-slate-50/50 rounded-lg border border-slate-100">
            <label className="text-xs font-semibold text-slate-700">Multa por Atraso</label>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label htmlFor="multaPercentual" className={labelClass}>
                  Valor
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                    {multaTipo === 'PERCENTAGE' ? '%' : 'R$'}
                  </span>
                  <Input
                    id="multaPercentual"
                    type="text"
                    value={multaPercentual}
                    onChange={(e) => {
                      if (!editandoJurosMulta) return;
                      const rawValue = e.target.value;
                      if (rawValue === '' && multaPercentual !== '0,00') return;
                      setMultaPercentual(formatPercentInput(rawValue));
                    }}
                    disabled={!editandoJurosMulta}
                    className={`pl-8 text-right h-10 rounded-lg border px-3 text-sm shadow-sm transition focus:outline-none focus:ring-2 ${
                      multaTipo === 'PERCENTAGE' && multaExcedeMaximo && editandoJurosMulta
                        ? 'border-red-300 bg-red-50 text-red-900 focus:border-red-400 focus:ring-red-400/30'
                        : multaTipo === 'PERCENTAGE' && multaExcedeRecomendado && editandoJurosMulta
                        ? 'border-amber-300 bg-amber-50 text-amber-900 focus:border-amber-400 focus:ring-amber-400/30'
                        : 'border-slate-200 bg-white text-slate-900 focus:border-[#A94DFF] focus:ring-[#A94DFF]/30'
                    } disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed`}
                    placeholder="2,00"
                  />
                </div>
                {editandoJurosMulta && multaTipo === 'PERCENTAGE' && multaExcedeMaximo && (
                  <p className="text-xs text-red-600 mt-1">
                    Limite máximo: {LIMITE_MULTA_MAX}%
                  </p>
                )}
                {editandoJurosMulta && multaTipo === 'PERCENTAGE' && !multaExcedeMaximo && multaExcedeRecomendado && (
                  <p className="text-xs text-amber-600 mt-1">
                    Atenção: Recomendado até {LIMITE_MULTA_RECOMENDADO}%
                  </p>
                )}
              </div>
              <div className="space-y-1">
                <label htmlFor="multaTipo" className={labelClass}>
                  Tipo
                </label>
                <Select
                  value={multaTipo}
                  onValueChange={(v) => setMultaTipo(v as 'FIXED' | 'PERCENTAGE')}
                  disabled={!editandoJurosMulta}
                >
                  <SelectTrigger className={controlClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">Percentual (%)</SelectItem>
                    <SelectItem value="FIXED">Valor Fixo (R$)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Desconto - Valor, Tipo e Prazo */}
          <div className="space-y-3 p-4 bg-slate-50/50 rounded-lg border border-slate-100">
            <label className="text-xs font-semibold text-slate-700">Desconto Antecipado</label>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <label htmlFor="descontoPercentual" className={labelClass}>
                  Valor
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-slate-500">
                    {descontoTipo === 'PERCENTAGE' ? '%' : 'R$'}
                  </span>
                  <Input
                    id="descontoPercentual"
                    type="text"
                    value={descontoPercentual}
                    onChange={(e) => {
                      if (!editandoJurosMulta) return;
                      setDescontoPercentual(formatPercentInput(e.target.value));
                    }}
                    disabled={!editandoJurosMulta}
                    className="pl-8 text-right h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 disabled:bg-slate-50 disabled:text-slate-700 disabled:cursor-not-allowed"
                    placeholder="0,00"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <label htmlFor="descontoTipo" className={labelClass}>
                  Tipo
                </label>
                <Select
                  value={descontoTipo}
                  onValueChange={(v) => setDescontoTipo(v as 'FIXED' | 'PERCENTAGE')}
                  disabled={!editandoJurosMulta}
                >
                  <SelectTrigger className={controlClass}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="PERCENTAGE">Percentual (%)</SelectItem>
                    <SelectItem value="FIXED">Valor Fixo (R$)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label htmlFor="prazoDesconto" className={labelClass}>
                  Prazo (dias)
                </label>
                <Input
                  id="prazoDesconto"
                  type="number"
                  min={0}
                  max={30}
                  value={prazoDesconto}
                  onChange={(e) => setPrazoDesconto(parseInt(e.target.value) || 0)}
                  disabled={!editandoJurosMulta}
                  className={controlClass}
                  placeholder="0"
                />
              </div>
            </div>
            <p className="text-xs text-slate-500">
              {prazoDesconto === 0 
                ? 'Desconto válido até o vencimento' 
                : `Desconto válido até ${prazoDesconto} dias antes do vencimento`}
            </p>
          </div>

          {editandoJurosMulta && (
            <>
              {/* Preview de Cálculo */}
              <div className="p-4 bg-gradient-to-br from-purple-50 to-blue-50 border border-purple-200 rounded-lg">
                <h4 className="text-xs font-semibold text-slate-700 mb-3">
                  Exemplo de Cálculo (cobrança de R$ 150,00)
                </h4>
                <div className="grid grid-cols-3 gap-4 text-xs">
                  {/* Juros */}
                  <div className="space-y-1">
                    <p className="font-medium text-slate-600">Juros (10 dias)</p>
                    <p className="text-slate-700">
                      R$ {(jurosTipo === 'PERCENTAGE' ? 150 * (jurosValor / 100 / 30) * 10 : jurosValor).toFixed(2)}
                    </p>
                    <p className="text-slate-500 text-[10px]">
                      {jurosTipo === 'PERCENTAGE' ? `${jurosValor}% ÷ 30 × 10 dias` : `R$ ${jurosValor.toFixed(2)} fixos`}
                    </p>
                  </div>
                  
                  {/* Multa */}
                  <div className="space-y-1">
                    <p className="font-medium text-slate-600">Multa (única)</p>
                    <p className="text-slate-700">
                      R$ {(multaTipo === 'PERCENTAGE' ? 150 * (multaValor / 100) : multaValor).toFixed(2)}
                    </p>
                    <p className="text-slate-500 text-[10px]">
                      {multaTipo === 'PERCENTAGE' ? `${multaValor}% do valor` : `R$ ${multaValor.toFixed(2)} fixos`}
                    </p>
                  </div>
                  
                  {/* Desconto */}
                  <div className="space-y-1">
                    <p className="font-medium text-slate-600">Desconto (antecipado)</p>
                    <p className="text-green-700">
                      - R$ {(descontoTipo === 'PERCENTAGE' ? 150 * (parsePercent(descontoPercentual) / 100) : parsePercent(descontoPercentual)).toFixed(2)}
                    </p>
                    <p className="text-slate-500 text-[10px]">
                      {descontoTipo === 'PERCENTAGE'
                        ? `${parsePercent(descontoPercentual)}% desconto`
                        : `R$ ${parsePercent(descontoPercentual).toFixed(2)} fixos`}
                    </p>
                  </div>
                </div>
                
                <div className="mt-3 pt-3 border-t border-purple-200">
                  <div className="flex justify-between items-center">
                    <span className="text-xs font-medium text-slate-600">Total com 10 dias de atraso:</span>
                    <span className="text-sm font-bold text-slate-800">
                      R$ {(
                        150 +
                        (jurosTipo === 'PERCENTAGE' ? 150 * (jurosValor / 100 / 30) * 10 : jurosValor) +
                        (multaTipo === 'PERCENTAGE' ? 150 * (multaValor / 100) : multaValor)
                      ).toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center mt-1">
                    <span className="text-xs font-medium text-slate-600">Total com desconto (antecipado):</span>
                    <span className="text-sm font-bold text-green-700">
                      R$ {(
                        150 -
                        (descontoTipo === 'PERCENTAGE'
                          ? 150 * (parsePercent(descontoPercentual) / 100)
                          : parsePercent(descontoPercentual))
                      ).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {!asaasSubscriptionId && (
          <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs text-amber-800">
              <strong>Atenção:</strong> Esta matrícula não possui vínculo financeiro ativo. As configurações de pagamento e comunicação automática não podem ser editadas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
