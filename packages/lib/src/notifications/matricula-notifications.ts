/**
 * Notificações de ciclo de vida da matrícula (inbox interna da equipe).
 */

import { prisma } from '../prisma';
import { createEnrollmentLifecycleNotification } from './domain-notifications';

export interface NotifyMatriculaActionInput {
  matriculaId: string;
  action: 'PAUSADA' | 'RETOMADA' | 'CANCELADA';
  motivo?: string;
  contaId: string;
  actorUserId?: string | null;
}

export interface NotificationResult {
  success: boolean;
  message: string;
}

export async function notifyMatriculaAction(
  input: NotifyMatriculaActionInput,
): Promise<NotificationResult> {
  try {
    const matricula = await prisma.matricula.findFirst({
      where: {
        id: input.matriculaId,
        aluno: { contaId: input.contaId },
      },
      select: {
        id: true,
        aluno: { select: { nome: true } },
      },
    });

    if (!matricula) {
      return { success: false, message: 'Matrícula não encontrada' };
    }

    await createEnrollmentLifecycleNotification({
      contaId: input.contaId,
      matriculaId: matricula.id,
      alunoNome: matricula.aluno.nome ?? 'Aluno',
      action: input.action,
      motivo: input.motivo ?? null,
      actorUserId: input.actorUserId ?? null,
    });

    return {
      success: true,
      message: 'Notificação interna registrada para a equipe.',
    };
  } catch (error) {
    console.error('[NOTIFICACAO_MATRICULA] Erro ao enviar notificação:', error);
    return {
      success: false,
      message: (error as Error).message || 'Erro ao enviar notificação',
    };
  }
}
