'use client';

import {
  DetailsDialog,
  DetailsDialogRow,
  DetailsDialogSection,
} from '@/components/shared/DetailsDialog';
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
import type { RematriculaProcessSummary } from '../services/rematriculas-service';

const modalTextAreaClass =
  'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition placeholder:text-slate-400 focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30';
const modalLabelClass = 'text-xs font-medium text-slate-600';

function formatDate(value: string | null | undefined) {
  if (!value) return 'Sem data';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Sem data';
  return new Intl.DateTimeFormat('pt-BR', { timeZone: 'UTC' }).format(date);
}

function getProcessLabel(status: RematriculaProcessSummary['status']) {
  const labels: Record<RematriculaProcessSummary['status'], string> = {
    DRAFT: 'Rascunho',
    PREVIEWED: 'Prévia',
    PARTIALLY_CONFIRMED: 'Parcial',
    CONFIRMED: 'Confirmada',
    WAITING_FOR_START: 'Aguardando início',
    REQUIRES_ATTENTION: 'Requer atenção',
    EFFECTIVE: 'Novo ciclo iniciado',
    CANCELLED: 'Cancelada',
    COMPLETED: 'Encerrada',
  };
  return labels[status] ?? status;
}

function getDecisionLabel(decision: string | null | undefined) {
  const labels: Record<string, string> = {
    PENDING: 'Pendente',
    RENEW: 'Rematricular',
    DECIDE_LATER: 'Decidir depois',
    DO_NOT_CONTINUE: 'Não continuará',
    CANCELLED: 'Cancelada',
  };
  return decision ? labels[decision] ?? decision : 'Pendente';
}

function getReservaLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    NOT_RESERVED: 'Sem reserva',
    RESERVED: 'Reservada',
    WAITLISTED: 'Lista de espera',
    EXPIRED: 'Expirada',
    CONVERTED: 'Convertida',
    FAILED: 'Falhou',
    RELEASED: 'Liberada',
    CANCELLED: 'Cancelada',
  };
  return status ? labels[status] ?? status : 'Sem reserva';
}

function getContratoFuturoLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    DRAFT: 'Rascunho',
    PREVIEWED: 'Prévia',
    WAITING_SIGNATURE: 'Aguardando assinatura',
    SIGNED_SCHEDULED: 'Assinado para iniciar',
    ACTIVE: 'Ativo',
    SIGNED: 'Assinado',
    CANCELLED: 'Cancelado',
  };
  return status ? labels[status] ?? status : 'Rascunho';
}

function getFinanceiroFuturoLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    NOT_PREPARED: 'Não preparado',
    PENDING: 'Pendente',
    PREPARED: 'Preparado',
    SCHEDULED: 'Provisionamento agendado',
    READY_TO_PROVISION: 'Pronto para gerar',
    PROVISIONING: 'Gerando no financeiro',
    PROVISIONED: 'Gerado',
    ACTIVE: 'Provisionado',
    FAILED: 'Falhou',
    CANCELLED: 'Cancelado',
  };
  return status ? labels[status] ?? status : 'Não preparado';
}

function formatCurrency(value: number | null | undefined) {
  if (value == null) return 'Não informado';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value);
}

function formatPaymentMethod(value: string | null | undefined) {
  const labels: Record<string, string> = {
    BOLETO: 'Boleto bancário',
    PIX: 'Pix',
    CARTAO_CREDITO: 'Cartão de crédito',
    INDEFINIDO: 'Não definido',
  };
  return value ? labels[value] ?? value : 'Não informado';
}

function formatChannels(snapshot: Record<string, unknown> | null | undefined) {
  const labels: Record<string, string> = {
    EMAIL: 'E-mail',
    SMS: 'SMS',
    WHATSAPP: 'WhatsApp',
  };
  const channels = Array.isArray(snapshot?.notificationChannels)
    ? snapshot.notificationChannels.filter((channel): channel is string => typeof channel === 'string')
    : [];
  return channels.length ? channels.map((channel) => labels[channel] ?? channel).join(', ') : 'Não configuradas';
}

function getSnapshotText(item: RematriculaProcessSummary['itens'][number] | null, key: string) {
  if (!item) return null;
  const value = item.targetSnapshot?.[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

type DetailsDialogProps = {
  process: RematriculaProcessSummary | null;
  onOpenChange: (_open: boolean) => void;
};

export function RematriculaProcessDetailsDialog({
  process,
  onOpenChange,
}: DetailsDialogProps) {
  const firstItem = process?.itens.find((item) => item.decision === 'RENEW') ?? process?.itens[0] ?? null;
  const futureEnrollment = firstItem?.matriculaFutura ?? null;
  const currentEnrollment = firstItem?.matriculaAtual ?? null;
  const financialSnapshot = process?.financeiros[0]?.snapshot ?? null;

  return (
    <DetailsDialog
      open={Boolean(process)}
      onOpenChange={onOpenChange}
      title="Detalhes da rematrícula"
    >
      {process ? (
        <>
              <section className="space-y-4">
                <div>
                  <p className="text-xs text-slate-500">Mensalidade</p>
                  <p className="mt-1 text-3xl font-medium tracking-tight text-slate-950">
                    {formatCurrency(process.monthlyTotal)}
                  </p>
                </div>
                <div>
                  <DetailsDialogRow label="Customer ID" value={firstItem?.aluno?.customerId ?? 'Não informado'} />
                  <DetailsDialogRow
                    label="Status"
                    value={<span className="text-emerald-700">{getProcessLabel(process.status)}</span>}
                  />
                  <DetailsDialogRow
                    label="Origem"
                    value={process.origin === 'CAMPAIGN' ? process.campanha?.nome ?? 'Campanha' : 'Rematrícula avulsa'}
                  />
                  <DetailsDialogRow label="Período de destino" value={process.targetPeriodId} />
                </div>
              </section>

              <DetailsDialogSection>
                <h3 className="text-sm font-medium text-slate-900">Dados básicos do aluno</h3>
                <div>
                  {process.itens.map((item) => (
                    <div key={item.id} className="py-1.5 first:pt-0 last:pb-0">
                      <DetailsDialogRow label="Nome" value={item.aluno?.nome ?? item.matriculaOrigemId} />
                      <DetailsDialogRow label="Data de nascimento" value={formatDate(item.aluno?.dataNascimento)} />
                      <DetailsDialogRow label="CPF" value={item.aluno?.cpf ?? 'Não informado'} />
                      <DetailsDialogRow
                        label="Vínculo atual"
                        value={item.turmaAtual?.nome ?? item.comboAtual?.nome ?? 'Sem turma atual'}
                      />
                    </div>
                  ))}
                </div>
              </DetailsDialogSection>

              <DetailsDialogSection>
                <h3 className="text-sm font-medium text-slate-900">Próximo ciclo</h3>
                <div>
                  <DetailsDialogRow label="Plano" value={futureEnrollment?.plano?.nome ?? getSnapshotText(firstItem, 'planName') ?? 'Não informado'} />
                  <DetailsDialogRow label="Turma ou combo" value={futureEnrollment?.turma?.nome ?? futureEnrollment?.combo?.nome ?? getSnapshotText(firstItem, 'className') ?? getSnapshotText(firstItem, 'comboName') ?? 'Não informado'} />
                  <DetailsDialogRow label="Data de início" value={formatDate(futureEnrollment?.dataInicio ?? process.effectiveAt)} />
                  <DetailsDialogRow label="Término do contrato" value={formatDate(futureEnrollment?.dataFimContrato)} />
                  <DetailsDialogRow label="Decisão" value={getDecisionLabel(firstItem?.decision)} />
                  <DetailsDialogRow label="Reserva" value={getReservaLabel(process.reservas[0]?.status)} />
                  <DetailsDialogRow label="Contrato futuro" value={getContratoFuturoLabel(process.contratos[0]?.status)} />
                  <DetailsDialogRow label="Financeiro futuro" value={getFinanceiroFuturoLabel(process.financeiros[0]?.status)} />
                </div>
              </DetailsDialogSection>

              <DetailsDialogSection>
                <h3 className="text-sm font-medium text-slate-900">Condições de pagamento</h3>
                <div>
                  <DetailsDialogRow label="Mensalidade" value={formatCurrency(process.monthlyTotal)} />
                  <DetailsDialogRow label="Taxa de matrícula" value={futureEnrollment?.taxaIsenta ? 'Isenta' : formatCurrency(futureEnrollment?.taxaMatricula ?? process.enrollmentFeeTotal)} />
                  <DetailsDialogRow label="Forma de pagamento" value={formatPaymentMethod(futureEnrollment?.formaPagamento ?? currentEnrollment?.formaPagamento)} />
                  <DetailsDialogRow label="Forma de pagamento da taxa" value={formatPaymentMethod(futureEnrollment?.formaPagamentoTaxa ?? currentEnrollment?.formaPagamentoTaxa)} />
                  <DetailsDialogRow label="Dia de vencimento" value={futureEnrollment?.vencimentoDia ? `Dia ${futureEnrollment.vencimentoDia}` : 'Não informado'} />
                  <DetailsDialogRow label="Desconto por antecipação" value={futureEnrollment?.descontoAntecipado ? `${futureEnrollment.descontoAntecipado}%` : 'Não aplicado'} />
                  <DetailsDialogRow label="Prazo do desconto" value={futureEnrollment?.prazoDesconto != null ? `${futureEnrollment.prazoDesconto} dias antes` : 'Não informado'} />
                  <DetailsDialogRow label="Juros mensais" value={`${futureEnrollment?.jurosMensal ?? currentEnrollment?.jurosMensal ?? 0}%`} />
                  <DetailsDialogRow label="Multa por atraso" value={`${futureEnrollment?.multaPercentual ?? currentEnrollment?.multaPercentual ?? 0}%`} />
                </div>
              </DetailsDialogSection>

              <DetailsDialogSection>
                <h3 className="text-sm font-medium text-slate-900">Notificações</h3>
                <div>
                  <DetailsDialogRow label="Canais" value={formatChannels(financialSnapshot)} />
                </div>
              </DetailsDialogSection>
        </>
      ) : null}
    </DetailsDialog>
  );
}

type CancelDialogProps = {
  process: RematriculaProcessSummary | null;
  reason: string;
  saving: boolean;
  onOpenChange: (_open: boolean) => void;
  onReasonChange: (_value: string) => void;
  onConfirm: () => void;
};

export function RematriculaProcessCancelDialog({
  process,
  reason,
  saving,
  onOpenChange,
  onReasonChange,
  onConfirm,
}: CancelDialogProps) {
  return (
    <AlertDialog open={Boolean(process)} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-lg rounded-2xl border border-slate-200 bg-white p-0">
        <div className="border-b border-slate-200 bg-slate-50 px-6 py-5">
          <AlertDialogHeader className="space-y-1 text-left">
            <AlertDialogTitle className="text-lg font-semibold text-slate-900">
              Cancelar rematrícula
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-slate-600">
              A matrícula atual será preservada. A preparação do próximo ciclo, reserva, contrato e financeiro futuro serão cancelados ou marcados para conferência.
            </AlertDialogDescription>
          </AlertDialogHeader>
        </div>
        <div className="px-6 py-5">
          <label className={modalLabelClass}>Motivo do cancelamento</label>
          <textarea value={reason} onChange={(event) => onReasonChange(event.target.value)} rows={4} className={`${modalTextAreaClass} mt-2 resize-none`} placeholder="Informe o motivo para registro interno" />
        </div>
        <AlertDialogFooter className="gap-2 border-t border-slate-200 bg-white px-6 py-4">
          <AlertDialogCancel disabled={saving} className="h-10 min-w-[112px] border-slate-300 bg-white text-slate-700 hover:bg-slate-50">
            Voltar
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={saving || !reason.trim()}
            className="h-10 min-w-[148px] bg-red-600 text-white hover:bg-red-700"
            onClick={(event) => {
              event.preventDefault();
              onConfirm();
            }}
          >
            {saving ? 'Cancelando...' : 'Cancelar rematrícula'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
