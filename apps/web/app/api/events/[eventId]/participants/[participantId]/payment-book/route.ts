import { NextRequest, NextResponse } from 'next/server';
import { prisma, loadAsaasCredentials } from '@alusa/database';
import { getAsaasBaseUrlForApiKeyOrThrow } from '@alusa/asaas';
import { jsPDF } from 'jspdf';
import { getEventsContext, handleEventsRouteError, jsonError } from '../../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

function formatCurrency(value: any) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value));
}

function formatDateOnly(value: any) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(new Date(value));
}

function translateMethod(billingType: string | null | undefined) {
  if (!billingType) return 'Outro';
  const methods: Record<string, string> = {
    CREDIT_CARD: 'Cartão de Crédito',
    BOLETO: 'Boleto Bancário',
    PIX: 'Pix',
  };
  return methods[billingType] || billingType;
}

function translateStatus(status: string | null | undefined) {
  if (!status) return 'PENDENTE';
  const paidStatuses = ['CONFIRMED', 'RECEIVED', 'RECEIVED_IN_CASH', 'DUNNING_RECEIVED', 'PAID'];
  if (paidStatuses.includes(status)) return 'PAGO';
  if (status === 'CANCELED') return 'CANCELADO';
  if (status === 'OVERDUE') return 'ATRASADO';
  return 'PENDENTE';
}

function getStatusColor(status: string | null | undefined): [number, number, number] {
  const trans = translateStatus(status);
  if (trans === 'PAGO') return [16, 185, 129];      // Emerald 500
  if (trans === 'CANCELADO') return [100, 116, 139]; // Slate 500
  if (trans === 'ATRASADO') return [239, 68, 68];    // Red 500
  return [245, 158, 11];                             // Amber 500
}

function drawSlip(
  doc: jsPDF,
  y: number,
  index: number,
  total: number,
  charge: any,
  participant: any
) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 36;
  const width = pageWidth - margin * 2; // 523 pt
  const height = 230;

  // Outer border
  doc.setDrawColor(203, 213, 225); // Slate 300
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, y, width, height, 4, 4, 'FD');

  // Draw Header of the slip
  doc.setFillColor(248, 250, 252); // Slate 50
  doc.rect(margin + 1, y + 1, width - 2, 35, 'F');
  
  // Header Text
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(15, 23, 42); // Slate 900
  doc.text(`ALUSA ERP EDUCACIONAL`, margin + 12, y + 22);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(71, 85, 105); // Slate 600
  doc.text(`CARNÊ DE PARCELAMENTO — EVENTOS`, margin + 180, y + 22);
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(`PARCELA ${index + 1}/${total}`, margin + width - 12, y + 22, { align: 'right' });

  // Dotted separator line (Canhoto vs Ficha) at x = margin + 150
  const sepX = margin + 150;
  doc.setDrawColor(148, 163, 184); // Slate 400
  doc.setLineDashPattern([4, 3], 0);
  doc.line(sepX, y + 36, sepX, y + height - 6);
  doc.setLineDashPattern([], 0);

  // Left portion: Canhoto (Client Copy)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139); // Slate 500
  doc.text('VENCIMENTO', margin + 12, y + 54);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(formatDateOnly(charge.dueDate), margin + 12, y + 66);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('VALOR', margin + 12, y + 84);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text(formatCurrency(charge.value), margin + 12, y + 96);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('STATUS', margin + 12, y + 114);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  const statusLabel = translateStatus(charge.status);
  doc.setTextColor(...getStatusColor(charge.status));
  doc.text(statusLabel, margin + 12, y + 126);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('ALUNO', margin + 12, y + 144);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(15, 23, 42);
  doc.text(participant.displayName || 'Inscrito', margin + 12, y + 156, { maxWidth: 130 });

  // Right portion: Ficha (Bank/Receipt Copy)
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
  doc.text(participant.event.name, sepX + 12, y + 96, { maxWidth: 220 });

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('PAGADOR', sepX + 12, y + 114);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
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
    doc.setTextColor(59, 130, 246); // Blue
    if (charge.invoiceUrl) {
      doc.text(charge.invoiceUrl, sepX + 12, y + 168, { maxWidth: 300 });
    }
  }

  // Right Side Data Fields (Vencimento, Valor) in columns on the far right
  const rightColX = sepX + 240;
  
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('VENCIMENTO', rightColX, y + 54);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(15, 23, 42);
  doc.text(formatDateOnly(charge.dueDate), rightColX, y + 66);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('MÉTODO', rightColX, y + 84);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text(translateMethod(charge.billingType), rightColX, y + 96);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('VALOR DO DOCUMENTO', rightColX, y + 114);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.text(formatCurrency(charge.value), rightColX, y + 126);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(100, 116, 139);
  doc.text('STATUS', rightColX, y + 144);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.setTextColor(...getStatusColor(charge.status));
  doc.text(statusLabel, rightColX, y + 156);
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = await params;
    const ctx = await getEventsContext('events.view');

    // 1. Fetch the participant to check if it belongs to the active account/tenant
    const participant = await prisma.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
    });

    if (!participant) {
      return jsonError(404, 'PARTICIPANTE_NAO_ENCONTRADO', 'Inscrição não encontrada.');
    }

    // 2. Find the asaasInstallmentId for this participant's charges
    let asaasInstallmentId: string | null = null;
    let localPlanId: string | null = null;
    
    let entryIds: string[] = [];
    if (participant.revenueEntryId) {
      entryIds.push(participant.revenueEntryId);
    }
    
    if (participant.alunoId) {
      const costumes = await prisma.eventCostumeAssignment.findMany({
        where: { contaId: ctx.contaId, eventId, alunoId: participant.alunoId },
        select: { revenueEntryId: true },
      });
      const ticketSales = await prisma.eventTicketSale.findMany({
        where: { contaId: ctx.contaId, eventId, alunoId: participant.alunoId },
        select: { revenueEntryId: true },
      });
      
      const extraIds = [
        ...costumes.map(c => c.revenueEntryId),
        ...ticketSales.map(t => t.revenueEntryId),
      ].filter((id): id is string => Boolean(id));
      
      entryIds.push(...extraIds);
    }

    entryIds = Array.from(new Set(entryIds));

    if (entryIds.length > 0) {
      const financialEntries = await prisma.eventFinancialEntry.findMany({
        where: { contaId: ctx.contaId, id: { in: entryIds } },
        select: { asaasPaymentId: true },
      });

      const asaasPaymentIds = financialEntries
        .map((e) => e.asaasPaymentId)
        .filter((id): id is string => Boolean(id));

      if (asaasPaymentIds.length > 0) {
        const plans = await prisma.standaloneInstallmentPlan.findMany({
          where: {
            contaId: ctx.contaId,
            asaasInstallmentId: { in: asaasPaymentIds },
          },
          select: { id: true, asaasInstallmentId: true, billingType: true },
        });

        if (plans.length > 0) {
          asaasInstallmentId = plans[0].asaasInstallmentId;
          localPlanId = plans[0].id;
        }

        if (!asaasInstallmentId) {
          const directCharges = await prisma.charge.findMany({
            where: {
              contaId: ctx.contaId,
              asaasPaymentId: { in: asaasPaymentIds },
            },
            select: { standaloneInstallmentPlanId: true },
          });

          const planIdsFromCharges = directCharges
            .map((c) => c.standaloneInstallmentPlanId)
            .filter((id): id is string => Boolean(id));

          if (planIdsFromCharges.length > 0) {
            const extraPlans = await prisma.standaloneInstallmentPlan.findMany({
              where: {
                contaId: ctx.contaId,
                id: { in: planIdsFromCharges },
              },
              select: { id: true, asaasInstallmentId: true, billingType: true },
            });
            if (extraPlans.length > 0) {
              asaasInstallmentId = extraPlans[0].asaasInstallmentId;
              localPlanId = extraPlans[0].id;
            }
          }
        }
      }
    }

    if (!localPlanId) {
      return jsonError(400, 'PARCELAMENTO_NAO_ENCONTRADO', 'Nenhum parcelamento encontrado para esta inscrição.');
    }

    // Return the local PDF URL
    return NextResponse.json({
      data: {
        pdfUrl: `/api/events/${eventId}/participants/${participantId}/payment-book?planId=${localPlanId}`
      }
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_GERAR_CARNE_PARCELAMENTO');
  }
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = await params;
    const { searchParams } = new URL(request.url);
    const planId = searchParams.get('planId');

    const ctx = await getEventsContext('events.view');

    const participant = await prisma.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      include: {
        event: true,
        turma: true,
      },
    });

    if (!participant) {
      return new NextResponse('Participante não encontrado.', { status: 404 });
    }

    if (!planId) {
      return new NextResponse('ID do parcelamento ausente.', { status: 400 });
    }

    const plan = await prisma.standaloneInstallmentPlan.findFirst({
      where: {
        id: planId,
        contaId: ctx.contaId,
      },
      include: {
        charges: {
          orderBy: { dueDate: 'asc' },
        },
      },
    });

    if (!plan || plan.charges.length === 0) {
      return new NextResponse('Plano de parcelamento não encontrado.', { status: 404 });
    }

    // Try fetching the payment book PDF from Asaas first if it is BOLETO or PIX
    if ((plan.billingType === 'BOLETO' || plan.billingType === 'PIX') && plan.asaasInstallmentId) {
      try {
        const credentials = await loadAsaasCredentials(ctx.contaId);
        if (credentials?.apiKey) {
          const baseUrl = getAsaasBaseUrlForApiKeyOrThrow(credentials.apiKey);
          const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
          const url = `${base}installments/${plan.asaasInstallmentId}/paymentBook`;

          const asaasRes = await fetch(url, {
            headers: {
              'access_token': credentials.apiKey,
              'User-Agent': 'Alusa/1.0',
            },
          });

          if (asaasRes.ok && asaasRes.headers.get('content-type')?.includes('application/pdf')) {
            const pdfBuffer = await asaasRes.arrayBuffer();
            const displayName = participant.displayName || 'Inscrito';
            return new NextResponse(Buffer.from(pdfBuffer), {
              headers: {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `inline; filename="carne-${displayName.replace(/\s+/g, '-')}.pdf"`,
                'Cache-Control': 'private, no-store',
              },
            });
          } else {
            console.warn('[payment-book][get] Asaas response was not OK or not PDF:', asaasRes.status);
          }
        }
      } catch (asaasError) {
        console.error('[payment-book][get] Failed to fetch Asaas payment book:', asaasError);
      }
    }

    // Generate custom PDF using jsPDF (fallback for CREDIT_CARD or failed Asaas request)
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const total = plan.charges.length;

    plan.charges.forEach((charge, index) => {
      // Fit 3 slips per page
      const slipIndexOnPage = index % 3;
      if (index > 0 && slipIndexOnPage === 0) {
        doc.addPage();
      }

      const y = 30 + slipIndexOnPage * 260; // 30, 290, 550
      
      // Draw the slip
      doc.setFont('helvetica', 'normal');
      drawSlip(doc, y, index, total, charge, participant);
    });

    const pdf = Buffer.from(doc.output('arraybuffer'));
    const displayName = participant.displayName || 'Inscrito';
    return new NextResponse(pdf, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="carne-${displayName.replace(/\s+/g, '-')}.pdf"`,
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[payment-book][get] Error generating PDF:', error);
    return new NextResponse('Erro interno ao gerar o PDF.', { status: 500 });
  }
}
