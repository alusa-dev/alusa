import { jsPDF } from 'jspdf';

import { getTenantInstallmentPaymentBook } from '@alusa/finance';
import { eventParticipantScalarSelect, type EventsContext } from '@alusa/lib/events/events.service';

import { eventParticipantRepository } from './event-participant.repository';

type PaymentBookResult =
  | { kind: 'error'; status: 400 | 404; message: string }
  | { kind: 'redirect'; url: string }
  | { kind: 'pdf'; body: Buffer; filename: string };

type PaymentBookLinkResult =
  | { kind: 'error'; status: 400 | 404; message: string }
  | { kind: 'redirect'; url: string };

type PaymentBookParticipant = { displayName?: string | null; event: { name: string } };
type PaymentBookCharge = {
  dueDate: unknown;
  value: unknown;
  status?: string | null;
  billingType?: string | null;
  payerName?: string | null;
  invoiceUrl?: string | null;
};

function formatCurrency(value: unknown) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
}

function formatDateOnly(value: unknown) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value as string | number | Date));
}

function translateMethod(billingType: string | null | undefined) {
  if (!billingType) return 'Outro';
  return ({
    CREDIT_CARD: 'Cartão de Crédito',
    BOLETO: 'Boleto Bancário',
    PIX: 'Pix',
  } as Record<string, string>)[billingType] || billingType;
}

function translateStatus(status: string | null | undefined) {
  if (!status) return 'PENDENTE';
  if (['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'PAID'].includes(status)) return 'PAGO';
  if (status === 'CANCELED') return 'CANCELADO';
  if (status === 'OVERDUE') return 'ATRASADO';
  return 'PENDENTE';
}

function getStatusColor(status: string | null | undefined): [number, number, number] {
  const translated = translateStatus(status);
  if (translated === 'PAGO') return [16, 185, 129];
  if (translated === 'CANCELADO') return [100, 116, 139];
  if (translated === 'ATRASADO') return [239, 68, 68];
  return [245, 158, 11];
}

function drawSlip(doc: jsPDF, y: number, index: number, total: number, charge: PaymentBookCharge, participant: PaymentBookParticipant) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 36;
  const width = pageWidth - margin * 2;
  const height = 230;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, y, width, height, 4, 4, 'FD');
  doc.setFillColor(248, 250, 252);
  doc.rect(margin + 1, y + 1, width - 2, 35, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text('ALUSA ERP EDUCACIONAL', margin + 12, y + 22);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105);
  doc.text('CARNÊ DE PARCELAMENTO — EVENTOS', margin + 180, y + 22);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`PARCELA ${index + 1}/${total}`, margin + width - 12, y + 22, { align: 'right' });

  const sepX = margin + 150;
  doc.setDrawColor(148, 163, 184);
  doc.setLineDashPattern([4, 3], 0);
  doc.line(sepX, y + 36, sepX, y + height - 6);
  doc.setLineDashPattern([], 0);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('VENCIMENTO', margin + 12, y + 54);
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(formatDateOnly(charge.dueDate), margin + 12, y + 66);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('VALOR', margin + 12, y + 84);
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(formatCurrency(charge.value), margin + 12, y + 96);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('STATUS', margin + 12, y + 114);
  doc.setFontSize(9);
  const statusLabel = translateStatus(charge.status);
  doc.setTextColor(...getStatusColor(charge.status));
  doc.text(statusLabel, margin + 12, y + 126);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('ALUNO', margin + 12, y + 144);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(participant.displayName || 'Inscrito', margin + 12, y + 156, { maxWidth: 130 });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('LOCAL DE PAGAMENTO', sepX + 12, y + 54);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(charge.billingType === 'CREDIT_CARD' ? 'Cartão de Crédito - Cobrança Automática' : 'Pagamento Online (Boleto/Pix)', sepX + 12, y + 66);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('EVENTO / INSCRIÇÃO', sepX + 12, y + 84);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(participant.event.name, sepX + 12, y + 96, { maxWidth: 220 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('PAGADOR', sepX + 12, y + 114);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(charge.payerName || participant.displayName || 'Inscrito', sepX + 12, y + 126, { maxWidth: 220 });
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('INFORMAÇÕES / INSTRUÇÕES', sepX + 12, y + 144);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(71, 85, 105);
  if (charge.billingType === 'CREDIT_CARD') {
    doc.text('Esta parcela é debitada automaticamente no cartão cadastrado.', sepX + 12, y + 156);
    doc.text('Consulte a fatura do seu cartão para confirmar o lançamento.', sepX + 12, y + 166);
  } else {
    doc.text('Caso necessite pagar manualmente, utilize o link abaixo:', sepX + 12, y + 156);
    if (charge.invoiceUrl) {
      doc.setTextColor(59, 130, 246);
      doc.text(charge.invoiceUrl, sepX + 12, y + 168, { maxWidth: 300 });
    }
  }

  const rightColX = sepX + 240;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('VENCIMENTO', rightColX, y + 54);
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(formatDateOnly(charge.dueDate), rightColX, y + 66);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('MÉTODO', rightColX, y + 84);
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(translateMethod(charge.billingType), rightColX, y + 96);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('VALOR DO DOCUMENTO', rightColX, y + 114);
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42);
  doc.text(formatCurrency(charge.value), rightColX, y + 126);
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('STATUS', rightColX, y + 144);
  doc.setFontSize(9);
  doc.setTextColor(...getStatusColor(charge.status));
  doc.text(statusLabel, rightColX, y + 156);
}

async function resolvePaymentBookPlan(input: {
  ctx: EventsContext;
  eventId: string;
  participantId: string;
}) {
  const participant = await eventParticipantRepository.eventParticipant.findFirst({
    where: { id: input.participantId, eventId: input.eventId, contaId: input.ctx.contaId },
    select: eventParticipantScalarSelect,
  });
  if (!participant) return { participant: null, planId: null };

  let localPlanId: string | null = null;
  if (participant.asaasInstallmentId) {
    const directPlan = await eventParticipantRepository.standaloneInstallmentPlan.findFirst({
      where: { contaId: input.ctx.contaId, asaasInstallmentId: participant.asaasInstallmentId },
      select: { id: true, asaasInstallmentId: true },
    });
    if (directPlan) localPlanId = directPlan.id;
  }
  if (!localPlanId && participant.standaloneChargeId) {
    const localPlan = await eventParticipantRepository.standaloneInstallmentPlan.findFirst({
      where: { id: participant.standaloneChargeId, contaId: input.ctx.contaId },
      select: { id: true, asaasInstallmentId: true },
    });
    if (localPlan?.asaasInstallmentId) localPlanId = localPlan.id;
  }

  const entryIds = [participant.revenueEntryId];
  if (participant.alunoId) {
    const [costumes, ticketSales] = await Promise.all([
      eventParticipantRepository.eventCostumeAssignment.findMany({
        where: { contaId: input.ctx.contaId, eventId: input.eventId, alunoId: participant.alunoId },
        select: { revenueEntryId: true },
      }),
      eventParticipantRepository.eventTicketSale.findMany({
        where: { contaId: input.ctx.contaId, eventId: input.eventId, alunoId: participant.alunoId },
        select: { revenueEntryId: true },
      }),
    ]);
    entryIds.push(...costumes.map((item) => item.revenueEntryId), ...ticketSales.map((item) => item.revenueEntryId));
  }
  const uniqueEntryIds = Array.from(new Set(entryIds.filter((id): id is string => Boolean(id))));
  if (uniqueEntryIds.length > 0) {
    const entries = await eventParticipantRepository.eventFinancialEntry.findMany({
      where: { contaId: input.ctx.contaId, id: { in: uniqueEntryIds } },
      select: { asaasPaymentId: true },
    });
    const asaasPaymentIds = entries.map((entry) => entry.asaasPaymentId).filter((id): id is string => Boolean(id));
    if (asaasPaymentIds.length > 0) {
      const plans = await eventParticipantRepository.standaloneInstallmentPlan.findMany({
        where: { contaId: input.ctx.contaId, asaasInstallmentId: { in: asaasPaymentIds } },
        select: { id: true, asaasInstallmentId: true },
      });
      if (!localPlanId && plans.length > 0) localPlanId = plans[0].id;
      if (!localPlanId) {
        const charges = await eventParticipantRepository.charge.findMany({
          where: { contaId: input.ctx.contaId, asaasPaymentId: { in: asaasPaymentIds } },
          select: { standaloneInstallmentPlanId: true },
        });
        const planIds = charges.map((charge) => charge.standaloneInstallmentPlanId).filter((id): id is string => Boolean(id));
        if (planIds.length > 0) {
          const fallbackPlans = await eventParticipantRepository.standaloneInstallmentPlan.findMany({
            where: { contaId: input.ctx.contaId, id: { in: planIds } },
            select: { id: true, asaasInstallmentId: true },
          });
          if (fallbackPlans.length > 0) localPlanId = fallbackPlans[0].id;
        }
      }
    }
  }
  return { participant, planId: localPlanId };
}

export async function getEventPaymentBookLink(input: {
  ctx: EventsContext;
  eventId: string;
  participantId: string;
}): Promise<PaymentBookLinkResult> {
  const result = await resolvePaymentBookPlan(input);
  if (!result.participant) return { kind: 'error', status: 404, message: 'PARTICIPANTE_NAO_ENCONTRADO' };
  if (!result.planId) return { kind: 'error', status: 400, message: 'PARCELAMENTO_NAO_ENCONTRADO' };
  return { kind: 'redirect', url: `/api/events/${input.eventId}/participants/${input.participantId}/payment-book?planId=${result.planId}` };
}

export async function generateEventPaymentBook(input: {
  ctx: EventsContext;
  eventId: string;
  participantId: string;
  planId: string | undefined;
}): Promise<PaymentBookResult> {
  const participant = await eventParticipantRepository.eventParticipant.findFirst({
    where: { id: input.participantId, eventId: input.eventId, contaId: input.ctx.contaId },
    select: { ...eventParticipantScalarSelect, event: true, turma: true },
  });
  if (!participant) return { kind: 'error', status: 404, message: 'Participante não encontrado.' };
  if (!input.planId) return { kind: 'error', status: 400, message: 'ID do parcelamento ausente.' };

  const plan = await eventParticipantRepository.standaloneInstallmentPlan.findFirst({
    where: { id: input.planId, contaId: input.ctx.contaId },
    include: { charges: { orderBy: { dueDate: 'asc' } } },
  });
  if (!plan || plan.charges.length === 0) return { kind: 'error', status: 404, message: 'Plano de parcelamento não encontrado.' };

  if ((plan.billingType === 'BOLETO' || plan.billingType === 'PIX') && plan.asaasInstallmentId) {
    try {
      const pdfUrl = await getTenantInstallmentPaymentBook(input.ctx.contaId, plan.asaasInstallmentId);
      if (pdfUrl) return { kind: 'redirect', url: pdfUrl };
    } catch (error) {
      console.error('[payment-book][get] Failed to fetch provider payment book', {
        contaId: input.ctx.contaId,
        participantId: input.participantId,
        error: error instanceof Error ? error.message : 'provider_payment_book_failed',
      });
    }
  }

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const total = plan.charges.length;
  plan.charges.forEach((charge, index) => {
    const slipIndexOnPage = index % 3;
    if (index > 0 && slipIndexOnPage === 0) doc.addPage();
    doc.setFont('helvetica', 'normal');
    drawSlip(doc, 30 + slipIndexOnPage * 260, index, total, charge, participant);
  });
  const pdf = Buffer.from(doc.output('arraybuffer'));
  const displayName = participant.displayName || 'Inscrito';
  return {
    kind: 'pdf',
    body: pdf,
    filename: `carne-${displayName.replace(/\s+/g, '-')}.pdf`,
  };
}
