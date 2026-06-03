import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@alusa/database';
import { unregisterEventParticipant, calculateParticipantPayment } from '@alusa/lib/events/events.service';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

const publicOrderPaymentMethodLabels: Record<string, string> = {
  PIX: 'Pix',
  BOLETO: 'Boleto',
  CREDIT_CARD: 'Cartão de crédito',
};

const patchParticipantBodySchema = z.object({
  displayName: z.string().trim().optional(),
  notes: z.string().trim().nullable().optional(),
  isFeePaid: z.boolean().optional(),
  costumes: z.array(z.object({
    id: z.string(),
    definedSize: z.string().trim().nullable().optional(),
    status: z.enum(['PENDING', 'ORDERED', 'RECEIVED', 'DELIVERED', 'RETURNED', 'DAMAGED', 'LOST', 'CANCELLED']).optional(),
    notes: z.string().trim().nullable().optional(),
  })).optional(),
});

export async function GET(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = await params;
    const ctx = await getEventsContext('events.view');

    const participant = await prisma.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
      include: {
        aluno: true,
        event: true,
        responsavel: true,
        turma: true,
      },
    });

    if (!participant) {
      return NextResponse.json(
        { error: { code: 'PARTICIPANTE_NAO_ENCONTRADO', message: 'Inscrição não encontrada.' } },
        { status: 404 }
      );
    }

    let costumes: any[] = [];
    let ticketSales: any[] = [];
    let financialEntries: any[] = [];

    if (participant.alunoId || participant.responsavelId) {
      if (participant.alunoId) {
        costumes = await prisma.eventCostumeAssignment.findMany({
          where: { contaId: ctx.contaId, eventId, alunoId: participant.alunoId },
          include: {
            costume: true,
          },
        });
      }

      ticketSales = await prisma.eventTicketSale.findMany({
        where: {
          contaId: ctx.contaId,
          eventId,
          OR: [
            ...(participant.alunoId ? [{ alunoId: participant.alunoId }] : []),
            ...(participant.responsavelId ? [{ responsavelId: participant.responsavelId }] : []),
          ],
        },
        include: {
          lot: true,
        },
      });

      const buyerEmails = [...new Set([
        participant.aluno?.email?.trim().toLowerCase(),
        participant.responsavel?.email?.trim().toLowerCase(),
      ].filter((email): email is string => Boolean(email)))];

      if (buyerEmails.length > 0) {
        const publicOrders = await prisma.eventMapOrder.findMany({
          where: {
            contaId: ctx.contaId,
            eventId,
            status: { in: ['PAYMENT_PENDING', 'CONFIRMED', 'PARTIALLY_REFUNDED'] },
            OR: buyerEmails.map((email) => ({ buyerEmail: { equals: email, mode: 'insensitive' } })),
          },
          include: {
            reservation: {
              include: {
                seats: {
                  include: {
                    publicSeat: {
                      select: { lotId: true, lotName: true },
                    },
                  },
                },
              },
            },
            items: {
              include: {
                publicSeat: {
                  select: { lotId: true, lotName: true },
                },
                ticket: {
                  select: { id: true, status: true },
                },
              },
            },
          },
        });

        ticketSales.push(...publicOrders.map((order) => {
          const lotSources = order.status === 'PAYMENT_PENDING'
            ? (order.reservation?.seats ?? []).map((seat) => seat.publicSeat)
            : order.items.map((item) => item.publicSeat);

          const lots = lotSources
            .map((seat) => {
              if (!seat.lotId && !seat.lotName) return null;
              return {
                id: seat.lotId ?? `public-order:${order.id}`,
                name: seat.lotName ?? 'Mapa público',
              };
            })
            .filter((lot): lot is { id: string; name: string } => Boolean(lot));
          const uniqueLots = lots.filter((lot, index, arr) => arr.findIndex((entry) => entry.id === lot.id) === index);
          const primaryLot = uniqueLots[0] ?? null;
          const quantity = order.status === 'PAYMENT_PENDING'
            ? (order.reservation?.seats.length ?? 0)
            : Math.max(order.items.length, 0);
          const mappedStatus = order.status === 'PAYMENT_PENDING'
            ? 'RESERVED'
            : order.status === 'PARTIALLY_REFUNDED'
              ? 'REFUNDED'
              : 'PAID';
          const soldAt = order.paidAt ?? order.confirmedAt ?? order.createdAt;

          return {
            id: order.id,
            buyerName: order.buyerName,
            quantity,
            totalAmount: order.totalAmount,
            paymentMethod: order.paymentMethod ?? null,
            paymentMethodLabel: order.paymentMethod
              ? (publicOrderPaymentMethodLabels[order.paymentMethod] ?? order.paymentMethod)
              : 'Não informado',
            status: mappedStatus,
            soldAt,
            source: 'PUBLIC_ORDER',
            eventMapOrderId: order.id,
            asaasPaymentId: order.asaasPaymentId,
            invoiceUrl: order.invoiceUrl,
            ticketsUrl: order.status === 'CONFIRMED' ? `/api/events/public-orders/${order.id}/tickets` : null,
            lot: {
              id: primaryLot?.id ?? `public-order:${order.id}`,
              name: uniqueLots.length <= 1 ? (primaryLot?.name ?? 'Mapa público') : `${primaryLot?.name ?? 'Mapa público'} +${uniqueLots.length - 1}`,
            },
          };
        }));
      }

      const entryIds = [
        participant.revenueEntryId,
        ...costumes.map((c) => c.revenueEntryId),
        ...ticketSales.map((t) => t.revenueEntryId),
      ].filter((id): id is string => Boolean(id));

      if (entryIds.length > 0) {
        financialEntries = await prisma.eventFinancialEntry.findMany({
          where: { contaId: ctx.contaId, id: { in: entryIds } },
          orderBy: { dueDate: 'asc' },
        });
      }
    } else if (participant.revenueEntryId) {
      const entry = await prisma.eventFinancialEntry.findFirst({
        where: { contaId: ctx.contaId, id: participant.revenueEntryId },
      });
      if (entry) {
        financialEntries = [entry];
      }
    }

    let charges: any[] = [];
    let asaasInstallmentId: string | null = null;
    const planIdsByAsaasPaymentId = new Map<string, string[]>();
    const asaasPaymentIds = financialEntries
      .map((e) => e.asaasPaymentId)
      .filter((id): id is string => Boolean(id));

    if (asaasPaymentIds.length > 0) {
      const plans = await prisma.standaloneInstallmentPlan.findMany({
        where: {
          contaId: ctx.contaId,
          asaasInstallmentId: { in: asaasPaymentIds },
        },
        include: {
          charges: {
            orderBy: { dueDate: 'asc' },
          },
        },
      });

      if (plans.length > 0) {
        asaasInstallmentId = plans[0].asaasInstallmentId;
      }
      for (const plan of plans) {
        if (!plan.asaasInstallmentId) continue;
        const ids = planIdsByAsaasPaymentId.get(plan.asaasInstallmentId) ?? [];
        ids.push(plan.id);
        planIdsByAsaasPaymentId.set(plan.asaasInstallmentId, ids);
      }

      const directCharges = await prisma.charge.findMany({
        where: {
          contaId: ctx.contaId,
          asaasPaymentId: { in: asaasPaymentIds },
        },
      });

      const collectedCharges = [
        ...plans.flatMap((p) => p.charges),
        ...directCharges,
      ];

      const planIdsFromCharges = directCharges
        .map((c) => c.standaloneInstallmentPlanId)
        .filter((id): id is string => Boolean(id));

      if (planIdsFromCharges.length > 0) {
        const extraPlans = await prisma.standaloneInstallmentPlan.findMany({
          where: {
            contaId: ctx.contaId,
            id: { in: planIdsFromCharges },
          },
          include: {
            charges: {
              orderBy: { dueDate: 'asc' },
            },
          },
        });
        collectedCharges.push(...extraPlans.flatMap((p) => p.charges));

        if (!asaasInstallmentId && extraPlans.length > 0) {
          asaasInstallmentId = extraPlans[0].asaasInstallmentId;
        }
        for (const plan of extraPlans) {
          if (!plan.asaasInstallmentId) continue;
          const ids = planIdsByAsaasPaymentId.get(plan.asaasInstallmentId) ?? [];
          ids.push(plan.id);
          planIdsByAsaasPaymentId.set(plan.asaasInstallmentId, ids);
        }
      }

      const seen = new Set();
      charges = collectedCharges
        .filter((c) => {
          if (seen.has(c.id)) return false;
          seen.add(c.id);
          return true;
        })
        .sort((a, b) => {
          const dateA = a.dueDate ? new Date(a.dueDate).getTime() : 0;
          const dateB = b.dueDate ? new Date(b.dueDate).getTime() : 0;
          return dateA - dateB;
        });
    }

    const costumeCount = costumes.length;
    const pendingCostumes = costumes.filter((c) => c.status !== 'DELIVERED').length;
    const costumesValue = costumes.reduce(
      (sum, c) => sum + (c.billingMode === 'SEPARATE_CHARGE' && c.chargedValue ? c.chargedValue.toNumber() : 0),
      0,
    );

    const ticketsBought = ticketSales.filter((t) => ['PAID', 'COMPLIMENTARY'].includes(t.status)).reduce((sum, t) => sum + t.quantity, 0);
    const ticketsValue = ticketSales.filter((t) => t.status === 'PAID').reduce((sum, t) => sum + (typeof t.totalAmount?.toNumber === 'function' ? t.totalAmount.toNumber() : Number(t.totalAmount ?? 0)), 0);

    const feeValue = participant.registrationFeeCharged.toNumber();
    const totalSpent = feeValue + costumesValue + ticketsValue;

    const feeEntry = participant.revenueEntryId
      ? financialEntries.find((e) => e.id === participant.revenueEntryId)
      : null;

    let participantCharges: any[] = [];
    if (feeEntry?.asaasPaymentId) {
      const entryAsaasId = feeEntry.asaasPaymentId;
      const feePlanIds = planIdsByAsaasPaymentId.get(entryAsaasId) ?? [];
      participantCharges = charges.filter((c: any) =>
        c.asaasPaymentId === entryAsaasId ||
        (c.standaloneInstallmentPlanId && feePlanIds.includes(c.standaloneInstallmentPlanId))
      );
    }

    const paymentDetails = calculateParticipantPayment(
      feeValue,
      participant.isFeePaid,
      feeEntry,
      participantCharges
    );

    return NextResponse.json({
      data: {
        participant: {
          ...participant,
          registrationFeeCharged: feeValue,
          percentPaid: paymentDetails.percentPaid,
          totalPaid: paymentDetails.totalPaid,
          financialStatus: paymentDetails.status,
          metrics: {
            costumeCount,
            pendingCostumes,
            costumesValue,
            ticketsBought,
            ticketsValue,
            totalSpent,
          },
        },
        costumes: costumes.map((c) => ({
          ...c,
          chargedValue: c.chargedValue ? c.chargedValue.toNumber() : null,
        })),
        ticketSales: ticketSales.map((t) => ({
          ...t,
          unitPriceSnapshot: typeof t.unitPriceSnapshot?.toNumber === 'function' ? t.unitPriceSnapshot.toNumber() : (t.quantity ? Number(t.totalAmount ?? 0) / t.quantity : Number(t.totalAmount ?? 0)),
          totalAmount: typeof t.totalAmount?.toNumber === 'function' ? t.totalAmount.toNumber() : Number(t.totalAmount ?? 0),
        })),
        financialEntries: financialEntries.map((e) => {
          const isFeeEntry = e.id === participant.revenueEntryId;
          const feeEntryStatus = {
            QUITADO: 'RECEIVED',
            EM_DIA: 'PENDING',
            ATRASADO: 'PENDING',
            PENDENTE: 'PENDING',
            CANCELADO: 'CANCELLED',
            ESTORNADO: 'REFUNDED',
            ESTORNADO_PARCIAL: 'PARTIALLY_REFUNDED',
            ISENTO: 'RECEIVED',
          }[paymentDetails.status] ?? e.status;

          return {
            ...e,
            status: isFeeEntry ? feeEntryStatus : e.status,
            expectedAmount: e.expectedAmount.toNumber(),
            actualAmount: isFeeEntry
              ? (paymentDetails.totalPaid > 0 ? paymentDetails.totalPaid : null)
              : (e.actualAmount ? e.actualAmount.toNumber() : null),
          };
        }),
        charges: charges.map((c) => ({
          ...c,
          value: c.value ? c.value.toNumber() : null,
        })),
        asaasInstallmentId,
      },
    });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_BUSCAR_DETALHES_PARTICIPANTE');
  }
}

export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = await params;
    const ctx = await getEventsContext('events.update');
    const body = patchParticipantBodySchema.parse(await request.json());

    const participant = await prisma.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
    });

    if (!participant) {
      return NextResponse.json(
        { error: { code: 'PARTICIPANTE_NAO_ENCONTRADO', message: 'Inscrição não encontrada.' } },
        { status: 404 }
      );
    }

    await prisma.$transaction(async (tx) => {
      if (body.displayName !== undefined || body.notes !== undefined) {
        await tx.eventParticipant.update({
          where: { id: participantId },
          data: {
            ...(body.displayName !== undefined ? { displayName: body.displayName } : {}),
            ...(body.notes !== undefined ? { notes: body.notes } : {}),
          },
        });
      }

      if (body.isFeePaid !== undefined && body.isFeePaid !== participant.isFeePaid) {
        // Business rule: only allow changing if it's manual payment, without Asaas intervention.
        let hasAsaas = false;
        if (participant.revenueEntryId) {
          const entry = await tx.eventFinancialEntry.findFirst({
            where: { id: participant.revenueEntryId, contaId: ctx.contaId },
          });
          if (entry && entry.asaasPaymentId) {
            hasAsaas = true;
          }
        }

        if (hasAsaas) {
          throw new Error('Não é possível alterar manualmente o status de um pagamento gerenciado pelo Asaas.');
        }

        await tx.eventParticipant.update({
          where: { id: participantId },
          data: {
            isFeePaid: body.isFeePaid,
          },
        });

        if (participant.revenueEntryId) {
          if (body.isFeePaid) {
            await tx.eventFinancialEntry.update({
              where: { id: participant.revenueEntryId },
              data: {
                status: 'RECEIVED',
                actualAmount: participant.registrationFeeCharged,
                realizedAt: new Date(),
              },
            });
          } else {
            await tx.eventFinancialEntry.update({
              where: { id: participant.revenueEntryId },
              data: {
                status: 'PENDING',
                actualAmount: null,
                realizedAt: null,
              },
            });
          }
        } else if (participant.registrationFeeCharged.gt(0)) {
          const entry = await tx.eventFinancialEntry.create({
            data: {
              contaId: ctx.contaId,
              eventId: participant.eventId,
              type: 'REVENUE',
              category: 'Taxa de inscrição',
              description: 'Taxa de inscrição',
              expectedAmount: participant.registrationFeeCharged,
              actualAmount: body.isFeePaid ? participant.registrationFeeCharged : null,
              dueDate: new Date(),
              realizedAt: body.isFeePaid ? new Date() : null,
              status: body.isFeePaid ? 'RECEIVED' : 'PENDING',
              paymentMethod: 'OTHER',
            },
          });
          await tx.eventParticipant.update({
            where: { id: participantId },
            data: {
              revenueEntryId: entry.id,
            },
          });
        }
      }

      if (body.costumes && body.costumes.length > 0) {
        for (const costumeUpdate of body.costumes) {
          const assignment = await tx.eventCostumeAssignment.findFirst({
            where: { id: costumeUpdate.id, contaId: ctx.contaId },
          });

          if (!assignment) continue;

          await tx.eventCostumeAssignment.update({
            where: { id: costumeUpdate.id },
            data: {
              ...(costumeUpdate.definedSize !== undefined ? { definedSize: costumeUpdate.definedSize } : {}),
              ...(costumeUpdate.status !== undefined ? { status: costumeUpdate.status } : {}),
              ...(costumeUpdate.notes !== undefined ? { notes: costumeUpdate.notes } : {}),
            },
          });
        }
      }
    });

    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_ATUALIZAR_PARTICIPANTE');
  }
}

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  try {
    const { eventId, participantId } = await params;
    const ctx = await getEventsContext('events.update');

    const participant = await prisma.eventParticipant.findFirst({
      where: { id: participantId, eventId, contaId: ctx.contaId },
    });

    if (!participant) {
      return NextResponse.json(
        { error: { code: 'PARTICIPANTE_NAO_ENCONTRADO', message: 'Inscrição não encontrada.' } },
        { status: 404 }
      );
    }

    const result = await unregisterEventParticipant(ctx, eventId, participantId);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_DESINSCREVER_PARTICIPANTE');
  }
}
