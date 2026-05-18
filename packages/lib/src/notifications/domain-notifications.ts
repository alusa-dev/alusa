import {
  NotificationCategory,
  NotificationSeverity,
  NotificationType,
} from '@prisma/client';
import { prisma } from '../prisma';
import { createNotification } from '../services/notifications.service';

function formatDateBr(value: Date): string {
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(value);
}

export async function createEnrollmentRenewedNotification(params: {
  contaId: string;
  matriculaId: string;
  matriculaOrigemId: string;
  alunoNome: string;
  actorUserId?: string | null;
}): Promise<void> {
  await createNotification({
    contaId: params.contaId,
    type: NotificationType.ENROLLMENT_RENEWED,
    category: NotificationCategory.ENROLLMENT,
    severity: NotificationSeverity.INFO,
    title: 'Rematrícula realizada',
    message: `${params.alunoNome} foi rematriculado(a). Nova matrícula criada a partir da matrícula anterior.`,
    dedupeKey: `enrollment:renewed:${params.matriculaId}`,
    relatedPath: `/matriculas/${params.matriculaId}`,
    entityType: 'Matricula',
    entityId: params.matriculaId,
    metadata: {
      matriculaOrigemId: params.matriculaOrigemId,
      alunoNome: params.alunoNome,
    },
    actor: {
      type: params.actorUserId ? 'USER' : 'SYSTEM',
      id: params.actorUserId ?? null,
    },
  }).catch((error) => {
    console.warn('[Notifications] Falha ao criar notificação de rematrícula', {
      matriculaId: params.matriculaId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function createEnrollmentLifecycleNotification(params: {
  contaId: string;
  matriculaId: string;
  alunoNome: string;
  action: 'PAUSADA' | 'RETOMADA' | 'CANCELADA';
  motivo?: string | null;
  actorUserId?: string | null;
}): Promise<void> {
  const config = {
    PAUSADA: {
      type: NotificationType.ENROLLMENT_PAUSED,
      title: 'Matrícula pausada',
      message: `A matrícula de ${params.alunoNome} foi pausada.`,
    },
    RETOMADA: {
      type: NotificationType.ENROLLMENT_RESUMED,
      title: 'Matrícula retomada',
      message: `A matrícula de ${params.alunoNome} foi retomada.`,
    },
    CANCELADA: {
      type: NotificationType.ENROLLMENT_CANCELLED,
      title: 'Matrícula cancelada',
      message: `A matrícula de ${params.alunoNome} foi cancelada.`,
    },
  }[params.action];

  await createNotification({
    contaId: params.contaId,
    type: config.type,
    category: NotificationCategory.ENROLLMENT,
    severity:
      params.action === 'CANCELADA'
        ? NotificationSeverity.WARNING
        : NotificationSeverity.INFO,
    title: config.title,
    message: config.message,
    dedupeKey: `enrollment:lifecycle:${params.action}:${params.matriculaId}:${new Date().toISOString().slice(0, 10)}`,
    relatedPath: `/matriculas/${params.matriculaId}`,
    entityType: 'Matricula',
    entityId: params.matriculaId,
    metadata: {
      action: params.action,
      motivo: params.motivo ?? null,
      alunoNome: params.alunoNome,
    },
    actor: {
      type: params.actorUserId ? 'USER' : 'SYSTEM',
      id: params.actorUserId ?? null,
    },
  }).catch((error) => {
    console.warn('[Notifications] Falha ao criar notificação de ciclo de matrícula', {
      matriculaId: params.matriculaId,
      action: params.action,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function createContractSignedNotification(params: {
  contaId: string;
  contratoId: string;
  matriculaId: string;
  alunoNome: string;
  assinadoPor?: string | null;
}): Promise<void> {
  await createNotification({
    contaId: params.contaId,
    type: NotificationType.CONTRACT_SIGNED,
    category: NotificationCategory.CONTRACT,
    severity: NotificationSeverity.SUCCESS,
    title: 'Contrato assinado',
    message: `O contrato de ${params.alunoNome} foi assinado${params.assinadoPor ? ` por ${params.assinadoPor}` : ''}.`,
    dedupeKey: `contract:signed:${params.contratoId}`,
    relatedPath: `/matriculas/${params.matriculaId}`,
    entityType: 'Contrato',
    entityId: params.contratoId,
    metadata: {
      matriculaId: params.matriculaId,
      alunoNome: params.alunoNome,
      assinadoPor: params.assinadoPor ?? null,
    },
    actor: { type: 'SYSTEM' },
  }).catch((error) => {
    console.warn('[Notifications] Falha ao criar notificação de contrato assinado', {
      contratoId: params.contratoId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function createContractCancelledNotification(params: {
  contaId: string;
  contratoId: string;
  matriculaId: string;
  alunoNome: string;
}): Promise<void> {
  await createNotification({
    contaId: params.contaId,
    type: NotificationType.CONTRACT_CANCELLED,
    category: NotificationCategory.CONTRACT,
    severity: NotificationSeverity.WARNING,
    title: 'Contrato cancelado',
    message: `O contrato de ${params.alunoNome} foi cancelado.`,
    dedupeKey: `contract:cancelled:${params.contratoId}`,
    relatedPath: `/matriculas/${params.matriculaId}`,
    entityType: 'Contrato',
    entityId: params.contratoId,
    metadata: { matriculaId: params.matriculaId, alunoNome: params.alunoNome },
    actor: { type: 'SYSTEM' },
  }).catch((error) => {
    console.warn('[Notifications] Falha ao criar notificação de contrato cancelado', {
      contratoId: params.contratoId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function createContractExpiredNotification(params: {
  contaId: string;
  matriculaId: string;
  alunoNome: string;
  dataFimContrato: Date;
}): Promise<void> {
  const dateKey = params.dataFimContrato.toISOString().slice(0, 10);
  await createNotification({
    contaId: params.contaId,
    type: NotificationType.CONTRACT_EXPIRED,
    category: NotificationCategory.CONTRACT,
    severity: NotificationSeverity.WARNING,
    title: 'Contrato expirado',
    message: `O contrato de ${params.alunoNome} expirou em ${formatDateBr(params.dataFimContrato)}.`,
    dedupeKey: `contract:expired:${params.matriculaId}:${dateKey}`,
    relatedPath: `/matriculas/${params.matriculaId}`,
    entityType: 'Matricula',
    entityId: params.matriculaId,
    metadata: {
      alunoNome: params.alunoNome,
      dataFimContrato: params.dataFimContrato.toISOString(),
    },
    actor: { type: 'SYSTEM' },
  }).catch((error) => {
    console.warn('[Notifications] Falha ao criar notificação de contrato expirado', {
      matriculaId: params.matriculaId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function createContractExpiringNotification(params: {
  contaId: string;
  matriculaId: string;
  alunoNome: string;
  dataFimContrato: Date;
  diasRestantes: number;
}): Promise<void> {
  const dateKey = params.dataFimContrato.toISOString().slice(0, 10);
  await createNotification({
    contaId: params.contaId,
    type: NotificationType.CONTRACT_EXPIRING,
    category: NotificationCategory.CONTRACT,
    severity:
      params.diasRestantes <= 3
        ? NotificationSeverity.WARNING
        : NotificationSeverity.INFO,
    title: 'Contrato próximo do vencimento',
    message: `O contrato de ${params.alunoNome} vence em ${params.diasRestantes} dia(s) (${formatDateBr(params.dataFimContrato)}).`,
    dedupeKey: `contract:expiring:${params.matriculaId}:${dateKey}:${params.diasRestantes}`,
    relatedPath: `/matriculas/${params.matriculaId}`,
    entityType: 'Matricula',
    entityId: params.matriculaId,
    metadata: {
      alunoNome: params.alunoNome,
      dataFimContrato: params.dataFimContrato.toISOString(),
      diasRestantes: params.diasRestantes,
    },
    actor: { type: 'SYSTEM' },
  }).catch((error) => {
    console.warn('[Notifications] Falha ao criar notificação de contrato expirando', {
      matriculaId: params.matriculaId,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function createExperimentalClassNotification(params: {
  contaId: string;
  experimentalId: string;
  alunoNome: string;
  startAt: Date;
  variant: 'SCHEDULED' | 'RESCHEDULED' | 'COMPLETED' | 'CANCELLED';
  actorUserId?: string | null;
}): Promise<void> {
  const config = {
    SCHEDULED: {
      type: NotificationType.EXPERIMENTAL_SCHEDULED,
      title: 'Aula experimental agendada',
      message: `Aula experimental de ${params.alunoNome} agendada para ${formatDateBr(params.startAt)}.`,
    },
    RESCHEDULED: {
      type: NotificationType.EXPERIMENTAL_RESCHEDULED,
      title: 'Aula experimental reagendada',
      message: `Aula experimental de ${params.alunoNome} reagendada para ${formatDateBr(params.startAt)}.`,
    },
    COMPLETED: {
      type: NotificationType.EXPERIMENTAL_COMPLETED,
      title: 'Aula experimental realizada',
      message: `Aula experimental de ${params.alunoNome} foi marcada como realizada.`,
    },
    CANCELLED: {
      type: NotificationType.EXPERIMENTAL_CANCELLED,
      title: 'Aula experimental cancelada',
      message: `Aula experimental de ${params.alunoNome} foi cancelada.`,
    },
  }[params.variant];

  const dedupeSuffix =
    params.variant === 'SCHEDULED'
      ? params.experimentalId
      : `${params.experimentalId}:${params.startAt.toISOString()}`;

  await createNotification({
    contaId: params.contaId,
    type: config.type,
    category: NotificationCategory.EXPERIMENTAL,
    severity:
      params.variant === 'CANCELLED'
        ? NotificationSeverity.WARNING
        : NotificationSeverity.INFO,
    title: config.title,
    message: config.message,
    dedupeKey: `experimental:${params.variant.toLowerCase()}:${dedupeSuffix}`,
    relatedPath: `/aulas/experimentais/${params.experimentalId}`,
    entityType: 'AulaExperimental',
    entityId: params.experimentalId,
    metadata: {
      alunoNome: params.alunoNome,
      startAt: params.startAt.toISOString(),
      variant: params.variant,
    },
    actor: {
      type: params.actorUserId ? 'USER' : 'SYSTEM',
      id: params.actorUserId ?? null,
    },
  }).catch((error) => {
    console.warn('[Notifications] Falha ao criar notificação de aula experimental', {
      experimentalId: params.experimentalId,
      variant: params.variant,
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export async function loadMatriculaNotificationContext(matriculaId: string, contaId: string) {
  return prisma.matricula.findFirst({
    where: { id: matriculaId, aluno: { contaId } },
    select: {
      id: true,
      aluno: { select: { nome: true, contaId: true } },
    },
  });
}

export async function loadContratoNotificationContext(contratoId: string) {
  return prisma.contrato.findUnique({
    where: { id: contratoId },
    select: {
      id: true,
      matriculaId: true,
      matricula: {
        select: {
          aluno: { select: { nome: true, contaId: true } },
        },
      },
    },
  });
}
