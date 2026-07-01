'use client';

import type React from 'react';
import { Button } from '@/components/ui/button';
import { Badge, type BadgeVariant } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
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
const modalSectionClass =
  'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4';
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

function getProcessBadgeVariant(status: RematriculaProcessSummary['status']): BadgeVariant {
  if (status === 'CONFIRMED' || status === 'EFFECTIVE') return 'success';
  if (status === 'WAITING_FOR_START' || status === 'PREVIEWED') return 'info';
  if (status === 'PARTIALLY_CONFIRMED' || status === 'REQUIRES_ATTENTION') return 'warning';
  if (status === 'CANCELLED') return 'destructive';
  return 'neutral';
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

function getDecisionBadgeVariant(decision: string | null | undefined): BadgeVariant {
  if (decision === 'RENEW') return 'success';
  if (decision === 'PENDING' || decision === 'DECIDE_LATER' || !decision) return 'warning';
  if (decision === 'DO_NOT_CONTINUE') return 'destructive';
  return 'neutral';
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

function getReservaBadgeVariant(status: string | null | undefined): BadgeVariant {
  if (status === 'RESERVED' || status === 'CONVERTED') return 'success';
  if (status === 'WAITLISTED') return 'warning';
  if (status === 'FAILED' || status === 'CANCELLED') return 'destructive';
  return 'neutral';
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

function getContratoFuturoBadgeVariant(status: string | null | undefined): BadgeVariant {
  if (status === 'ACTIVE' || status === 'SIGNED' || status === 'SIGNED_SCHEDULED') return 'success';
  if (status === 'PREVIEWED' || status === 'WAITING_SIGNATURE') return 'info';
  if (status === 'CANCELLED') return 'destructive';
  return 'neutral';
}

function getFinanceiroFuturoLabel(status: string | null | undefined) {
  const labels: Record<string, string> = {
    NOT_PREPARED: 'Não preparado',
    PENDING: 'Pendente',
    PREPARED: 'Preparado',
    SCHEDULED: 'Agendado',
    READY_TO_PROVISION: 'Pronto para gerar',
    PROVISIONED: 'Gerado',
    FAILED: 'Falhou',
    CANCELLED: 'Cancelado',
  };
  return status ? labels[status] ?? status : 'Não preparado';
}

function getFinanceiroFuturoBadgeVariant(status: string | null | undefined): BadgeVariant {
  if (status === 'PREPARED' || status === 'PROVISIONED') return 'success';
  if (status === 'SCHEDULED' || status === 'READY_TO_PROVISION') return 'info';
  if (status === 'PENDING') return 'warning';
  if (status === 'FAILED' || status === 'CANCELLED') return 'destructive';
  return 'neutral';
}

type DetailsDialogProps = {
  process: RematriculaProcessSummary | null;
  onOpenChange: (_open: boolean) => void;
  onCreateCommunication: (_process: RematriculaProcessSummary) => void;
  onGrantException: (_process: RematriculaProcessSummary) => void;
  onResolvePending: (_pendingId: string) => void;
};

export function RematriculaProcessDetailsDialog({
  process,
  onOpenChange,
  onCreateCommunication,
  onGrantException,
  onResolvePending,
}: DetailsDialogProps) {
  return (
    <Dialog open={Boolean(process)} onOpenChange={onOpenChange}>
      <DialogContent
        fullScreenMobile
        className="w-full max-w-4xl gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:min-h-0 max-md:flex-col md:rounded-2xl"
      >
        {process ? (
          <div className="flex max-h-[88vh] min-h-0 flex-col max-md:max-h-none max-md:flex-1">
            <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-8 md:py-6">
              <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <DialogTitle className="pr-2 text-xl font-semibold tracking-tight text-slate-900 md:pr-0">
                    Detalhes da rematrícula
                  </DialogTitle>
                  <DialogDescription className="mt-2 text-sm text-slate-600">
                    {process.origin === 'CAMPAIGN' ? process.campanha?.nome ?? 'Campanha' : 'Rematrícula avulsa'} ·{' '}
                    {process.targetPeriodId} · {getProcessLabel(process.status)}
                  </DialogDescription>
                </div>
                <Badge variant={getProcessBadgeVariant(process.status)}>
                  {getProcessLabel(process.status)}
                </Badge>
              </div>
            </div>

            <div className="flex-1 space-y-6 overflow-y-auto scroll-smooth bg-slate-50 px-4 py-6 max-md:min-h-0 md:px-8">
              <div className={modalSectionClass}>
                <span className="text-sm font-semibold text-slate-700">Vínculo atual</span>
                <div className="space-y-3">
                  {process.itens.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-slate-900">
                          {item.aluno?.nome ?? item.matriculaOrigemId}
                        </div>
                        <div className="mt-1 text-xs text-slate-500">
                          {item.turmaAtual?.nome ?? item.comboAtual?.nome ?? 'Sem turma atual'}
                        </div>
                      </div>
                      <Badge variant={getDecisionBadgeVariant(item.decision)}>
                        {getDecisionLabel(item.decision)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </div>

              <div className={modalSectionClass}>
                <span className="text-sm font-semibold text-slate-700">Próximo ciclo</span>
                <div className="grid gap-3 md:grid-cols-2">
                  <SummaryTile label="Início" value={formatDate(process.effectiveAt)} />
                  <SummaryTile
                    label="Reserva"
                    value={getReservaLabel(process.reservas[0]?.status)}
                    badgeVariant={getReservaBadgeVariant(process.reservas[0]?.status)}
                  />
                  <SummaryTile
                    label="Contrato futuro"
                    value={getContratoFuturoLabel(process.contratos[0]?.status)}
                    badgeVariant={getContratoFuturoBadgeVariant(process.contratos[0]?.status)}
                  />
                  <SummaryTile
                    label="Financeiro futuro"
                    value={getFinanceiroFuturoLabel(process.financeiros[0]?.status)}
                    badgeVariant={getFinanceiroFuturoBadgeVariant(process.financeiros[0]?.status)}
                  />
                </div>
              </div>

              <div className={modalSectionClass}>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-slate-700">Pendências</span>
                  {process.pendencias.length > 0 ? <Badge variant="warning">{process.pendencias.length}</Badge> : null}
                </div>
                {process.pendencias.length === 0 ? (
                  <EmptyLine>Nenhuma pendência registrada.</EmptyLine>
                ) : (
                  <div className="space-y-2">
                    {process.pendencias.map((pending) => (
                      <div
                        key={pending.id}
                        className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm"
                      >
                        <div className="min-w-0">
                          <div className="font-medium text-amber-950">{pending.title}</div>
                          <div className="text-amber-900">{pending.message}</div>
                        </div>
                        {['OPEN', 'IN_PROGRESS'].includes(pending.status) ? (
                          <Button type="button" size="sm" variant="outline" onClick={() => onResolvePending(pending.id)}>
                            Resolver
                          </Button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="grid gap-6 md:grid-cols-2">
                <div className={modalSectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Exceções</span>
                  {process.excecoes.length === 0 ? (
                    <EmptyLine>Nenhuma exceção registrada.</EmptyLine>
                  ) : (
                    <div className="space-y-2">
                      {process.excecoes.map((exception) => (
                        <div key={exception.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                          <div className="font-medium text-slate-900">{exception.rule}</div>
                          <div className="mt-1 text-slate-700">{exception.justification}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className={modalSectionClass}>
                  <span className="text-sm font-semibold text-slate-700">Comunicação</span>
                  {process.comunicacoes.length === 0 ? (
                    <EmptyLine>Nenhuma comunicação registrada.</EmptyLine>
                  ) : (
                    <div className="space-y-2">
                      {process.comunicacoes.map((communication) => (
                        <div key={communication.id} className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm">
                          <div className="font-medium text-slate-900">{communication.subject ?? 'Comunicação registrada'}</div>
                          <div className="mt-1 text-xs text-slate-500">{formatDate(communication.createdAt)}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <DialogFooter className="shrink-0 gap-2 border-t border-slate-200 bg-white px-4 py-4 md:px-8">
              <Button type="button" variant="outline" className="h-10 min-w-[112px] border-slate-300 bg-white text-slate-700 hover:bg-slate-50" onClick={() => onCreateCommunication(process)}>
                Comunicação
              </Button>
              <Button type="button" variant="outline" className="h-10 min-w-[112px] border-slate-300 bg-white text-slate-700 hover:bg-slate-50" onClick={() => onGrantException(process)}>
                Exceção
              </Button>
              <Button type="button" variant="outline" className="h-10 min-w-[112px] border-slate-300 bg-white text-slate-700 hover:bg-slate-50" onClick={() => onOpenChange(false)}>
                Fechar
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function SummaryTile({
  label,
  value,
  badgeVariant,
}: {
  label: string;
  value: string;
  badgeVariant?: BadgeVariant;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className="mt-1">
        {badgeVariant ? (
          <Badge variant={badgeVariant}>{value}</Badge>
        ) : (
          <span className="text-sm font-medium text-slate-900">{value}</span>
        )}
      </div>
    </div>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm text-slate-500">{children}</div>;
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
              Cancelar próximo ciclo
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm text-slate-600">
              A matrícula atual será preservada. Apenas o processo futuro será cancelado.
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
            {saving ? 'Cancelando...' : 'Cancelar futuro'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
