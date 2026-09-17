import { prisma } from '@/lib/prisma';
import { eventParticipantScalarSelect } from '@alusa/lib/events/events.service';

export async function listEligibleEventStudents(input: { eventId: string; contaId: string; anchorAlunoId: string; responsavelId?: string; search?: string }) {
  const anchor = await prisma.aluno.findFirst({ where: { id: input.anchorAlunoId, contaId: input.contaId }, select: { id: true, responsaveis: { where: { contaId: input.contaId, responsavel: { financeiro: true } }, select: { responsavel: { select: { id: true, nome: true } } }, orderBy: { id: 'asc' } } } });
  if (!anchor) return null;
  const responsaveis = anchor.responsaveis.map(({ responsavel }) => responsavel);
  const selectedResponsavelId = input.responsavelId ?? (responsaveis.length === 1 ? responsaveis[0]?.id : undefined);
  if (selectedResponsavelId && !responsaveis.some((responsavel) => responsavel.id === selectedResponsavelId)) return { responsaveis, selectedResponsavelId, invalidResponsavel: true as const, items: [] };
  if (!selectedResponsavelId) return { responsaveis, selectedResponsavelId, items: [] };
  const items = await prisma.aluno.findMany({ where: { contaId: input.contaId, status: 'ATIVO', id: { not: input.anchorAlunoId }, ...(input.search ? { nome: { contains: input.search, mode: 'insensitive' } } : {}), responsaveis: { some: { contaId: input.contaId, responsavelId: selectedResponsavelId } }, eventParticipants: { none: { contaId: input.contaId, eventId: input.eventId } } }, select: { id: true, nome: true, email: true }, orderBy: { nome: 'asc' }, take: 20 });
  return { responsaveis, selectedResponsavelId, items };
}

export async function getEventParticipantForReactivation(input: { eventId: string; participantId: string; contaId: string }) {
  return prisma.eventParticipant.findFirst({ where: { id: input.participantId, eventId: input.eventId, contaId: input.contaId }, select: { ...eventParticipantScalarSelect, event: true } });
}

export async function getConfirmedEventOrderAccess(input: { eventId: string; orderId: string; contaId: string }) {
  return prisma.eventMapOrder.findFirst({ where: { id: input.orderId, contaId: input.contaId, eventId: input.eventId, status: 'CONFIRMED' }, select: { accessToken: true } });
}

export async function getEventOrderRefundContext(input: { orderId: string; contaId: string }) {
  return prisma.eventMapOrder.findFirst({ where: { id: input.orderId, contaId: input.contaId }, select: { id: true, eventId: true, asaasPaymentId: true, buyerName: true, buyerEmail: true, status: true, paymentStatus: true } });
}
