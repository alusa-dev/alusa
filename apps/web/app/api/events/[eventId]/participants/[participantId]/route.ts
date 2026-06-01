import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@alusa/database';
import { unregisterEventParticipant } from '@alusa/lib/events/events.service';
import { getEventsContext, handleEventsRouteError } from '../../../_helpers';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

type RouteParams = { params: Promise<{ eventId: string; participantId: string }> };

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
      where: { id: participantId, contaId: ctx.contaId },
      include: {
        aluno: true,
        event: true,
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

    if (participant.alunoId) {
      costumes = await prisma.eventCostumeAssignment.findMany({
        where: { contaId: ctx.contaId, eventId, alunoId: participant.alunoId },
        include: {
          costume: true,
        },
      });

      ticketSales = await prisma.eventTicketSale.findMany({
        where: { contaId: ctx.contaId, eventId, alunoId: participant.alunoId },
        include: {
          lot: true,
        },
      });

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
    const costumesValue = costumes.reduce((sum, c) => sum + (c.chargedValue ? c.chargedValue.toNumber() : 0), 0);

    const ticketsBought = ticketSales.filter((t) => ['PAID', 'COMPLIMENTARY'].includes(t.status)).reduce((sum, t) => sum + t.quantity, 0);
    const ticketsValue = ticketSales.filter((t) => t.status === 'PAID').reduce((sum, t) => sum + t.totalAmount.toNumber(), 0);

    const feeValue = participant.registrationFeeCharged.toNumber();
    const totalSpent = feeValue + costumesValue + ticketsValue;

    return NextResponse.json({
      data: {
        participant: {
          ...participant,
          registrationFeeCharged: feeValue,
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
          unitPriceSnapshot: t.unitPriceSnapshot.toNumber(),
          totalAmount: t.totalAmount.toNumber(),
        })),
        financialEntries: financialEntries.map((e) => ({
          ...e,
          expectedAmount: e.expectedAmount.toNumber(),
          actualAmount: e.actualAmount ? e.actualAmount.toNumber() : null,
        })),
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
      where: { id: participantId, contaId: ctx.contaId },
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
      where: { id: participantId, contaId: ctx.contaId },
    });

    if (!participant) {
      return NextResponse.json(
        { error: { code: 'PARTICIPANTE_NAO_ENCONTRADO', message: 'Inscrição não encontrada.' } },
        { status: 404 }
      );
    }

    if (participant.alunoId) {
      // 1. Verificar se possui figurinos vinculados
      const costumes = await prisma.eventCostumeAssignment.findFirst({
        where: { contaId: ctx.contaId, eventId, alunoId: participant.alunoId },
      });
      if (costumes) {
        return NextResponse.json(
          {
            error: {
              code: 'POSSUI_FIGURINOS',
              message: 'Não é possível remover a inscrição pois o participante possui figurinos vinculados. Remova os figurinos primeiro.',
            },
          },
          { status: 409 }
        );
      }

      // 2. Verificar se possui ingressos vinculados
      const ticketSales = await prisma.eventTicketSale.findFirst({
        where: { contaId: ctx.contaId, eventId, alunoId: participant.alunoId },
      });
      if (ticketSales) {
        return NextResponse.json(
          {
            error: {
              code: 'POSSUI_INGRESSOS',
              message: 'Não é possível remover a inscrição pois o participante possui ingressos/vendas registradas. Cancele as vendas primeiro.',
            },
          },
          { status: 409 }
        );
      }
    }

    const result = await unregisterEventParticipant(ctx, participantId);
    return NextResponse.json({ data: result });
  } catch (error) {
    return handleEventsRouteError(error, 'ERRO_DESINSCREVER_PARTICIPANTE');
  }
}
