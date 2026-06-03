'use client';

import { EVENT_PAYMENT_METHOD_LABELS } from '@alusa/shared';

import type { EventParticipantDTO } from '../events-service';

export function ParticipantPaymentMethod({ participant }: { participant: EventParticipantDTO }) {
  if (participant.registrationFeeCharged === 0) {
    return <span className="text-slate-400">—</span>;
  }

  const method = participant.feePaymentMethod;
  const labels: Record<string, string> = {
    BOLETO: 'Boleto',
    PIX: 'Pix',
    CREDIT_CARD: 'Cartão de Crédito',
    ...EVENT_PAYMENT_METHOD_LABELS,
  };
  const label = method ? (labels[method] || method) : '—';
  return <span className="text-slate-700 text-sm font-medium">{label}</span>;
}

export function ParticipantPaymentStatusBadge({ participant }: { participant: EventParticipantDTO }) {
  const status = participant.financialStatus || (participant.registrationFeeCharged === 0 ? 'ISENTO' : participant.isFeePaid ? 'QUITADO' : 'PENDENTE');
  const badges = {
    ISENTO: <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Isento</span>,
    QUITADO: <span className="inline-flex rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-800">Quitado</span>,
    EM_DIA: <span className="inline-flex rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-800">Em dia</span>,
    ATRASADO: <span className="inline-flex rounded-full bg-rose-100 px-2.5 py-0.5 text-xs font-semibold text-rose-800">Atrasado</span>,
    PENDENTE: <span className="inline-flex rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-800">Pendente</span>,
    ESTORNADO: <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Estornado</span>,
    CANCELADO: <span className="inline-flex rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-600">Cancelado</span>,
  };

  return badges[status as keyof typeof badges] || badges.PENDENTE;
}
