import type {
  PaidReceiptAluno,
  PaidReceiptItem,
} from '@/features/financeiro/pagamentos/paid-receipts-pdf';

type EventFeeReceiptParticipant = {
  id: string;
  displayName: string;
  registrationFeeCharged: number;
  feePaymentMethod?: string | null;
  aluno?: {
    id: string;
    nome: string;
    cpf?: string | null;
  } | null;
  event?: {
    name?: string | null;
  } | null;
};

type EventFeeReceiptEntry = {
  id: string;
  category?: string | null;
  description?: string | null;
  expectedAmount?: number | null;
  actualAmount?: number | null;
  dueDate?: string | null;
  realizedAt?: string | null;
  paymentMethod?: string | null;
  asaasPaymentId?: string | null;
  createdAt?: string | null;
  status?: string | null;
};

export function buildEventFeeReceiptInput(
  participant: EventFeeReceiptParticipant,
  entry: EventFeeReceiptEntry,
): { aluno: PaidReceiptAluno; item: PaidReceiptItem } {
  const participantName = participant.aluno?.nome ?? participant.displayName;
  const description =
    entry.description ||
    `Taxa de inscrição${participant.event?.name ? ` - ${participant.event.name}` : ''}`;
  const paidAt = entry.realizedAt ?? entry.createdAt ?? new Date().toISOString();

  return {
    aluno: {
      id: participant.aluno?.id ?? participant.id,
      nome: participantName,
      cpf: participant.aluno?.cpf ?? null,
    },
    item: {
      id: entry.id,
      sourceKind: 'event_fee',
      sourceId: entry.id,
      chargeType: 'EVENT_REGISTRATION_FEE',
      origin: 'EVENT',
      tipo: 'EVENT_REGISTRATION_FEE',
      category: 'EVENT_REGISTRATION_FEE',
      description,
      payerName: participant.displayName,
      valor: entry.expectedAmount ?? participant.registrationFeeCharged,
      vencimento: entry.dueDate ?? null,
      billingType: entry.paymentMethod ?? participant.feePaymentMethod ?? null,
      asaasPaymentId: entry.asaasPaymentId ?? null,
      matriculaId: null,
      createdAt: entry.createdAt ?? paidAt,
      pagamento: {
        id: entry.id,
        status: entry.status ?? 'RECEIVED',
        valorPago: entry.actualAmount ?? participant.registrationFeeCharged,
        dataPagamento: paidAt,
        formaPagamento: entry.paymentMethod ?? participant.feePaymentMethod ?? 'MANUAL',
        comprovante: null,
        asaasPaymentId: entry.asaasPaymentId ?? null,
        createdAt: entry.createdAt ?? paidAt,
      },
    },
  };
}
