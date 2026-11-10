import { logEnrollmentOperationalEvent } from '@/lib/observability/api-logger';
import type { Prisma, PrismaClient } from '@prisma/client';
import { StatusMatricula } from '@prisma/client';
import { prisma as defaultPrisma } from '@/src/prisma';
import {
  pauseAssinatura,
  ativarAssinatura,
  getSubscription,
  listSubscriptionPayments,
  deletePayment,
  commitBillingAgreementChange,
  previewBillingAgreementChange,
  materializeBillingAgreement,
} from '@alusa/finance';
import { AsaasHttpError } from '@alusa/finance';
import { validatePausa, validateReativacao, validarCapacidade, validarConflitosHorario } from '@alusa/domain';
import { buildSeatOccupancyOverlapWhereClause } from '@alusa/lib/services/matricula-occupancy';
import {
  cancelLocalFutureEnrollmentCharges,
  markEnrollmentFinanceDivergence,
} from './enrollment-finance-consistency.service';
import {
  assertStudentCapacity,
  countAdditionalActiveStudentsForEnrollment,
} from '@/src/server/platform-billing/capacity';
import {
  syncFamilyLifecycleAggregate,
  type FamilyLifecycleImpact,
} from './family-lifecycle.service';
import { getAcademicDateKey, getCurrentAcademicDateKey } from '@alusa/shared/date-only';

// ============================================================================
// ERRORS
// ============================================================================

export class PausaBusinessError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 422, details?: unknown) {
    super(message);
    this.name = 'PausaBusinessError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

export type PausaRegularizacaoElegibilidadeCode =
  | 'MATRICULA_NAO_PAUSADA'
  | 'CONTRATO_ENCERRADO_REGULARIZACAO_NAO_APLICAVEL'
  | 'PRAZO_RETORNO_NAO_VENCIDO'
  | 'OPERACAO_PAUSA_NAO_ENCONTRADA'
  | 'PAUSA_JA_REGULARIZADA';

export type PausaRegularizacaoElegibilidade = {
  elegivel: boolean;
  exigeRegularizacao: boolean;
  codigo: PausaRegularizacaoElegibilidadeCode | null;
  mensagem: string | null;
};

export function avaliarElegibilidadeRegularizacaoPausa(input: {
  status: string;
  pausaAtiva: boolean;
  dataRetornoPrevista: Date | null;
  dataFimContrato: Date | null;
  timeZone?: string | null;
  now?: Date;
  possuiOperacaoPausa: boolean;
  possuiRegularizacao: boolean;
}): PausaRegularizacaoElegibilidade {
  if (input.status !== 'PAUSADA' || !input.pausaAtiva) {
    return {
      elegivel: false, exigeRegularizacao: false, codigo: 'MATRICULA_NAO_PAUSADA',
      mensagem: 'A matrícula precisa estar pausada para regularizar o prazo.',
    };
  }

  const today = getCurrentAcademicDateKey(input.now ?? new Date(), input.timeZone ?? undefined);
  const contractEnd = input.dataFimContrato ? getAcademicDateKey(input.dataFimContrato) : null;
  if (!contractEnd || contractEnd < today) {
    return {
      elegivel: false, exigeRegularizacao: false,
      codigo: 'CONTRATO_ENCERRADO_REGULARIZACAO_NAO_APLICAVEL',
      mensagem: 'O contrato não tem vigência confirmada ou já expirou. Esta regularização de pausa não se aplica; siga o fluxo de nova matrícula.',
    };
  }

  const returnDate = input.dataRetornoPrevista ? getAcademicDateKey(input.dataRetornoPrevista) : null;
  if (!returnDate || returnDate >= today) {
    return {
      elegivel: false, exigeRegularizacao: false, codigo: 'PRAZO_RETORNO_NAO_VENCIDO',
      mensagem: 'A regularização só pode ser enviada depois que a data prevista de retorno vencer.',
    };
  }

  if (input.possuiRegularizacao) {
    return {
      elegivel: false, exigeRegularizacao: false, codigo: 'PAUSA_JA_REGULARIZADA',
      mensagem: 'O prazo desta pausa já foi regularizado. Não é necessário enviar outra regularização.',
    };
  }

  if (!input.possuiOperacaoPausa) {
    return {
      elegivel: false, exigeRegularizacao: true, codigo: 'OPERACAO_PAUSA_NAO_ENCONTRADA',
      mensagem: 'Não foi encontrada a operação original de pausa. Atualize o registro antes de regularizar.',
    };
  }

  return { elegivel: true, exigeRegularizacao: true, codigo: null, mensagem: null };
}

async function carregarElegibilidadeRegularizacaoPausa(input: {
  tx: PrismaClient | Prisma.TransactionClient;
  contaId: string;
  matriculaId: string;
  status: string;
  pausaAtiva: boolean;
  dataRetornoPrevista: Date | null;
  dataFimContrato: Date | null;
  now?: Date;
}) {
  const [account, pauseOperation] = await Promise.all([
    input.tx.conta.findFirst({ where: { id: input.contaId }, select: { timezone: true } }),
    input.tx.matriculaOperacao.findFirst({
      where: { contaId: input.contaId, matriculaId: input.matriculaId, tipo: 'PAUSA' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    }),
  ]);
  const regularizations = pauseOperation ? await input.tx.matriculaOperacao.findMany({
    where: { contaId: input.contaId, matriculaId: input.matriculaId, tipo: 'REGULARIZACAO_PAUSA', status: 'SINCRONIZADO' },
    orderBy: { createdAt: 'desc' },
    take: 20,
    select: { id: true, correlationId: true, metadata: true, createdAt: true },
  }) : [];
  const existingRegularization = pauseOperation ? regularizations.find((operation) =>
    typeof operation.metadata === 'object' && operation.metadata !== null &&
    'pausaOperacaoId' in operation.metadata && operation.metadata.pausaOperacaoId === pauseOperation.id,
  ) ?? null : null;
  return {
    ...avaliarElegibilidadeRegularizacaoPausa({
      status: input.status,
      pausaAtiva: input.pausaAtiva,
      dataRetornoPrevista: input.dataRetornoPrevista,
      dataFimContrato: input.dataFimContrato,
      timeZone: account?.timezone,
      now: input.now,
      possuiOperacaoPausa: pauseOperation !== null,
      possuiRegularizacao: existingRegularization !== null,
    }),
    pauseOperation,
    existingRegularization,
  };
}

async function assertEnrollmentTermAllowsReactivation(input: {
  tx: PrismaClient | Prisma.TransactionClient;
  contaId: string;
  dataFimContrato: Date | null;
}) {
  const conta = await input.tx.conta.findFirst({ where: { id: input.contaId }, select: { timezone: true } });
  const today = getCurrentAcademicDateKey(new Date(), conta?.timezone ?? undefined);
  const contractEnd = input.dataFimContrato ? getAcademicDateKey(input.dataFimContrato) : null;
  if (!contractEnd || contractEnd < today) {
    throw new PausaBusinessError(
      'VINCULO_ACADEMICO_ENCERRADO',
      'Este vínculo acadêmico não possui vigência confirmada ou já foi encerrado. A reativação não é válida; faça uma nova matrícula para registrar o retorno.',
      409,
    );
  }
}

async function assertPauseDeadlineRegularized(input: {
  tx: PrismaClient | Prisma.TransactionClient;
  contaId: string;
  matriculaId: string;
  status: string;
  pausaAtiva: boolean;
  dataRetornoPrevista: Date | null;
  dataFimContrato: Date | null;
}) {
  if (input.status !== 'PAUSADA' || !input.pausaAtiva || !input.dataRetornoPrevista || !input.dataFimContrato) return;
  const eligibility = await carregarElegibilidadeRegularizacaoPausa({
    tx: input.tx,
    contaId: input.contaId,
    matriculaId: input.matriculaId,
    status: input.status,
    pausaAtiva: input.pausaAtiva,
    dataRetornoPrevista: input.dataRetornoPrevista,
    dataFimContrato: input.dataFimContrato,
  });
  if (eligibility.exigeRegularizacao) {
    throw new PausaBusinessError(
      'PAUSA_PRAZO_VENCIDO_REGULARIZACAO_OBRIGATORIA',
      'O prazo previsto da pausa venceu. Regularize a pausa com justificativa antes de reativar a matrícula.',
      409,
    );
  }
}

// ============================================================================
// TYPES
// ============================================================================

export type PausarMatriculaInput = {
  prisma: PrismaClient;
  matriculaId: string;
  contaId: string;
  actorId: string;
  motivoPausa: string;
  dataInicioPausa: string; // YYYY-MM-DD
  dataRetornoPrevista?: string; // YYYY-MM-DD
  manterVaga: boolean;
  cobrarDurantePausa: boolean;
  observacao?: string;
};

export type PausarMatriculaResult = {
  matriculaId: string;
  operacaoId: string;
  correlationId: string;
  previousStatus: StatusMatricula;
  newStatus: 'PAUSADA';
  manterVaga: boolean;
  cobrarDurantePausa: boolean;
  integrationStatus: 'PENDENTE_SINCRONISMO' | 'SINCRONIZADO' | 'DIVERGENTE';
  warningCode: string | null;
  asaasAction: 'SUBSCRIPTION_INACTIVATED' | 'LOCAL_ONLY' | 'SKIPPED_COBRAR_DURANTE_PAUSA';
  cobrancasFuturasRemovidas: number;
  warnings: string[];
  familyImpact?: FamilyLifecycleImpact | null;
};

export type ReativarMatriculaInput = {
  prisma: PrismaClient;
  matriculaId: string;
  contaId: string;
  actorId: string;
  dataRetornoEfetiva: string; // YYYY-MM-DD
  nextDueDate: string; // YYYY-MM-DD - Obrigatório para retomada da assinatura
  observacao?: string;
};

export type ReativarMatriculaResult = {
  matriculaId: string;
  operacaoId: string;
  correlationId: string;
  previousStatus: StatusMatricula;
  newStatus: 'ATIVA';
  integrationStatus: 'PENDENTE_SINCRONISMO' | 'SINCRONIZADO' | 'DIVERGENTE';
  warningCode: string | null;
  asaasAction: 'SUBSCRIPTION_UPDATED' | 'LOCAL_ONLY';
  warnings: string[];
  familyImpact?: FamilyLifecycleImpact | null;
};

export type RegularizarPausaInput = {
  tx: Prisma.TransactionClient;
  matriculaId: string;
  contaId: string;
  actorId: string;
  motivo: string;
};

export async function regularizarPausaVencida(input: RegularizarPausaInput) {
  const motivo = input.motivo.trim();
  if (motivo.length < 8 || motivo.length > 1000) {
    throw new PausaBusinessError('MOTIVO_REGULARIZACAO_INVALIDO', 'Informe uma justificativa entre 8 e 1000 caracteres.', 422);
  }

  await input.tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.contaId}), hashtext(${`pause-regularization:${input.matriculaId}`}))`;
  const matricula = await input.tx.matricula.findFirst({
    where: { id: input.matriculaId, contaId: input.contaId },
    select: { id: true, status: true, pausaAtiva: true, dataRetornoPrevista: true, dataFimContrato: true },
  });
  if (!matricula) throw new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404);
  const eligibility = await carregarElegibilidadeRegularizacaoPausa({
    tx: input.tx,
    contaId: input.contaId,
    matriculaId: input.matriculaId,
    status: matricula.status,
    pausaAtiva: matricula.pausaAtiva,
    dataRetornoPrevista: matricula.dataRetornoPrevista,
    dataFimContrato: matricula.dataFimContrato,
  });
  if (eligibility.existingRegularization) return { ...eligibility.existingRegularization, jaRegularizada: true };
  if (!eligibility.elegivel) {
    throw new PausaBusinessError(
      eligibility.codigo ?? 'PRAZO_RETORNO_NAO_VENCIDO',
      eligibility.mensagem ?? 'A regularização da pausa não está disponível.',
      409,
    );
  }
  const pausa = eligibility.pauseOperation;
  if (!pausa) throw new PausaBusinessError('OPERACAO_PAUSA_NAO_ENCONTRADA', 'Não foi encontrada a operação de pausa para regularizar.', 409);

  const now = new Date();
  const operation = await input.tx.matriculaOperacao.create({
    data: {
      matriculaId: matricula.id,
      contaId: input.contaId,
      tipo: 'REGULARIZACAO_PAUSA',
      origem: 'USER',
      status: 'SINCRONIZADO',
      actorId: input.actorId,
      observacao: motivo,
      payloadEnviado: { motivo },
      payloadRecebido: { regularizadaEm: now.toISOString() },
      metadata: {
        pausaOperacaoId: pausa.id,
        dataRetornoPrevista: matricula.dataRetornoPrevista ? getAcademicDateKey(matricula.dataRetornoPrevista) : null,
      },
      processedAt: now,
    },
  });
  return { ...operation, jaRegularizada: false };
}

// ============================================================================
// HELPER: Build financial error
// ============================================================================

function buildFinancialError(action: string, subscriptionId: string, error: unknown): PausaBusinessError {
  if (error instanceof AsaasHttpError) {
    const body = error.responseBody as Record<string, unknown> | null;
    const providerMessage = extractProviderMessage(body);

    if (error.status === 404) {
      return new PausaBusinessError(
        'ASSINATURA_NAO_ENCONTRADA',
        `Não foi possível ${action} a matrícula porque a assinatura financeira vinculada não foi encontrada.`,
        409,
        { status: error.status, subscriptionId, providerMessage },
      );
    }
    if (error.status === 401 || error.status === 403) {
      return new PausaBusinessError(
        'ASAAS_AUTH_INVALIDA',
        `Não foi possível ${action} a matrícula porque a conta financeira da instituição não autorizou a operação.`,
        502,
        { status: error.status, subscriptionId, providerMessage },
      );
    }
    return new PausaBusinessError(
      'DIVERGENCIA_INTEGRACAO',
      providerMessage
        ? `Não foi possível ${action} a matrícula: ${providerMessage}`
        : `Não foi possível ${action} a matrícula porque o serviço financeiro rejeitou a operação.`,
      502,
      { status: error.status, subscriptionId, providerMessage },
    );
  }

  return new PausaBusinessError(
    'DIVERGENCIA_INTEGRACAO',
    `Não foi possível ${action} a matrícula: falha inesperada ao comunicar com o serviço financeiro.`,
    502,
    { subscriptionId, originalError: error instanceof Error ? error.message : String(error) },
  );
}

function extractProviderMessage(body: Record<string, unknown> | null): string | null {
  if (!body) return null;
  if (typeof body.message === 'string') return body.message;
  if (Array.isArray(body.errors)) {
    return body.errors
      .map((e: unknown) => {
        if (!e || typeof e !== 'object') return null;
        const item = e as Record<string, unknown>;
        return typeof item.description === 'string' ? item.description : typeof item.message === 'string' ? item.message : null;
      })
      .filter(Boolean)
      .join(', ') || null;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getStringValue(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim().length > 0 ? value : null;
}

function getBooleanValue(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  return typeof value === 'boolean' ? value : undefined;
}

function parsePausePayload(payload: unknown): {
  dataInicioPausa: string | null;
  dataRetornoPrevista: string | null;
  motivoPausa: string | null;
  manterVaga: boolean | undefined;
  cobrarDurantePausa: boolean | undefined;
} {
  if (!isRecord(payload)) {
    return {
      dataInicioPausa: null,
      dataRetornoPrevista: null,
      motivoPausa: null,
      manterVaga: undefined,
      cobrarDurantePausa: undefined,
    };
  }

  return {
    dataInicioPausa: getStringValue(payload, 'dataInicioPausa'),
    dataRetornoPrevista: getStringValue(payload, 'dataRetornoPrevista'),
    motivoPausa: getStringValue(payload, 'motivoPausa'),
    manterVaga: getBooleanValue(payload, 'manterVaga'),
    cobrarDurantePausa: getBooleanValue(payload, 'cobrarDurantePausa'),
  };
}

async function reconcileMatriculaPendingSynchronization(input: {
  prisma: PrismaClient;
  matriculaId: string;
  contaId: string;
}): Promise<void> {
  const matricula = await input.prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: {
      id: true,
      alunoId: true,
      status: true,
      pausaAtiva: true,
      dataInicioPausa: true,
      dataRetornoPrevista: true,
      manterVaga: true,
      cobrarDurantePausa: true,
      motivoPausa: true,
      integrationStatus: true,
      warningCode: true,
      asaasSubscriptionId: true,
      matriculaFamiliarId: true,
      version: true,
    },
  });

  if (!matricula?.asaasSubscriptionId) {
    return;
  }

  const pendingOperations = await input.prisma.matriculaOperacao.findMany({
    where: {
      matriculaId: input.matriculaId,
      status: 'PENDENTE_SINCRONISMO',
      tipo: { in: ['PAUSA', 'REATIVACAO'] },
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      tipo: true,
      correlationId: true,
      createdAt: true,
      actorId: true,
      payloadEnviado: true,
    },
  });

  if (pendingOperations.length === 0) {
    return;
  }

  const remoteSubscription = await getSubscription(matricula.asaasSubscriptionId, {
    contaId: input.contaId,
  });

  if (remoteSubscription.deleted || (remoteSubscription.status !== 'ACTIVE' && remoteSubscription.status !== 'INACTIVE')) {
    return;
  }

  const now = new Date();
  const pendingPauseOperations = pendingOperations.filter((operation) => operation.tipo === 'PAUSA');
  const pendingReactivationOperations = pendingOperations.filter((operation) => operation.tipo === 'REATIVACAO');

  if (remoteSubscription.status === 'INACTIVE') {
    const latestPauseOperation = pendingPauseOperations[0] ?? null;
    const pausePayload = latestPauseOperation ? parsePausePayload(latestPauseOperation.payloadEnviado) : null;

    await input.prisma.$transaction(async (tx) => {
      await tx.matricula.update({
        where: { id: matricula.id, version: matricula.version },
        data: {
          status: 'PAUSADA',
          pausaAtiva: true,
          dataInicioPausa: pausePayload?.dataInicioPausa
            ? new Date(pausePayload.dataInicioPausa)
            : matricula.dataInicioPausa,
          dataRetornoPrevista:
            pausePayload?.dataRetornoPrevista !== null && pausePayload?.dataRetornoPrevista !== undefined
              ? new Date(pausePayload.dataRetornoPrevista)
              : matricula.dataRetornoPrevista,
          manterVaga: pausePayload?.manterVaga ?? matricula.manterVaga,
          cobrarDurantePausa: pausePayload?.cobrarDurantePausa ?? matricula.cobrarDurantePausa,
          motivoPausa: pausePayload?.motivoPausa ?? matricula.motivoPausa,
          ...((pausePayload?.cobrarDurantePausa ?? matricula.cobrarDurantePausa)
            ? {}
            : { statusFinanceiro: 'SUSPENSO' as const }),
          integrationStatus: 'SINCRONIZADO',
          warningCode: null,
          version: { increment: 1 },
        },
      });

      if (pendingPauseOperations.length > 0) {
        await tx.matriculaOperacao.updateMany({
          where: {
            matriculaId: matricula.id,
            tipo: 'PAUSA',
            status: 'PENDENTE_SINCRONISMO',
          },
          data: {
            status: 'SINCRONIZADO',
            erro: null,
            processedAt: now,
          },
        });
      }

      if (pendingReactivationOperations.length > 0) {
        await tx.matriculaOperacao.updateMany({
          where: {
            matriculaId: matricula.id,
            tipo: 'REATIVACAO',
            status: 'PENDENTE_SINCRONISMO',
          },
          data: {
            status: 'ERRO',
            erro: 'Operação superada: a assinatura permanece inativa no Asaas.',
            processedAt: now,
          },
        });
      }

      await tx.matriculaLog.create({
        data: {
          matriculaId: matricula.id,
          actorId: latestPauseOperation?.actorId ?? pendingReactivationOperations[0]?.actorId ?? null,
          action: 'MATRICULA_PAUSA_RECONCILIADA',
          metadata: {
            asaasSubscriptionId: matricula.asaasSubscriptionId,
            remoteStatus: remoteSubscription.status,
            reconciledAt: now.toISOString(),
            pendingPauseCount: pendingPauseOperations.length,
            invalidatedReactivationCount: pendingReactivationOperations.length,
          },
        },
      });
    });

    return;
  }

  const latestReactivationOperation = pendingReactivationOperations[0] ?? null;

  await input.prisma.$transaction(async (tx) => {
    const additionalActiveStudents = await countAdditionalActiveStudentsForEnrollment({
      tx,
      contaId: input.contaId,
      alunoId: matricula.alunoId,
    });
    await assertStudentCapacity({
      tx,
      contaId: input.contaId,
      additionalActiveStudents,
      operation: 'matricula.pause.reconcile-reactivate',
    });

    await tx.matricula.update({
      where: { id: matricula.id, version: matricula.version },
      data: {
        status: 'ATIVA',
        pausaAtiva: false,
        dataInicioPausa: null,
        dataRetornoPrevista: null,
        manterVaga: true,
        cobrarDurantePausa: false,
        motivoPausa: null,
        integrationStatus: 'SINCRONIZADO',
        warningCode: null,
        version: { increment: 1 },
      },
    });

    if (pendingReactivationOperations.length > 0) {
      await tx.matriculaOperacao.updateMany({
        where: {
          matriculaId: matricula.id,
          tipo: 'REATIVACAO',
          status: 'PENDENTE_SINCRONISMO',
        },
        data: {
          status: 'SINCRONIZADO',
          erro: null,
          processedAt: now,
        },
      });
    }

    if (pendingPauseOperations.length > 0) {
      await tx.matriculaOperacao.updateMany({
        where: {
          matriculaId: matricula.id,
          tipo: 'PAUSA',
          status: 'PENDENTE_SINCRONISMO',
        },
        data: {
          status: 'ERRO',
          erro: 'Operação superada: a assinatura já está ativa no Asaas.',
          processedAt: now,
        },
      });
    }

    await tx.matriculaLog.create({
      data: {
        matriculaId: matricula.id,
        actorId: latestReactivationOperation?.actorId ?? pendingPauseOperations[0]?.actorId ?? null,
        action: 'MATRICULA_REATIVACAO_RECONCILIADA',
        metadata: {
          asaasSubscriptionId: matricula.asaasSubscriptionId,
          remoteStatus: remoteSubscription.status,
          reconciledAt: now.toISOString(),
          pendingReactivationCount: pendingReactivationOperations.length,
          invalidatedPauseCount: pendingPauseOperations.length,
        },
      },
    });
  });
}

// ============================================================================
// PAUSAR MATRÍCULA
// ============================================================================

export async function pausarMatricula(input: PausarMatriculaInput): Promise<PausarMatriculaResult> {
  await reconcileMatriculaPendingSynchronization({
    prisma: input.prisma,
    matriculaId: input.matriculaId,
    contaId: input.contaId,
  });

  const operacaoPendente = await input.prisma.matriculaOperacao.findFirst({
    where: {
      matriculaId: input.matriculaId,
      tipo: 'PAUSA',
      status: 'PENDENTE_SINCRONISMO',
    },
    select: { id: true, correlationId: true, createdAt: true },
  });

  if (operacaoPendente) {
    throw new PausaBusinessError(
      'OPERACAO_DUPLICADA',
      'Já existe uma solicitação de pausa em processamento para esta matrícula.',
      409,
      {
        operacaoId: operacaoPendente.id,
        correlationId: operacaoPendente.correlationId,
        createdAt: operacaoPendente.createdAt,
      },
    );
  }

  const matricula = await input.prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: {
      id: true,
      alunoId: true,
      status: true,
      pausaAtiva: true,
      asaasSubscriptionId: true,
      matriculaFamiliarId: true,
      version: true,
      turmaId: true,
      comboId: true,
      combo: { select: { turmas: { select: { turmaId: true } } } },
      matriculaTurmas: { select: { turmaId: true } },
    },
  });

  if (!matricula) {
    throw new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404);
  }

  if (
    input.dataRetornoPrevista &&
    input.dataRetornoPrevista <= input.dataInicioPausa
  ) {
    throw new PausaBusinessError(
      'RETORNO_INVALIDO',
      'A data de retorno deve ser posterior ao início da pausa.',
      422,
    );
  }

  // Validação de domínio
  const validacao = validatePausa(matricula.status, matricula.pausaAtiva);
  if (!validacao.success) {
    const msgs: Record<string, string> = {
      MATRICULA_NAO_ATIVA: 'A matrícula precisa estar com status Ativa para ser pausada.',
      MATRICULA_JA_PAUSADA: 'A matrícula já se encontra pausada.',
    };
    throw new PausaBusinessError(validacao.error, msgs[validacao.error] ?? validacao.error);
  }

  // Criar operação local PENDENTE_SINCRONISMO
  const operacao = await input.prisma.matriculaOperacao.create({
    data: {
      matriculaId: matricula.id,
      contaId: input.contaId,
      tipo: 'PAUSA',
      origem: 'USER',
      status: 'PENDENTE_SINCRONISMO',
      actorId: input.actorId,
      observacao: input.observacao,
      payloadEnviado: {
        motivoPausa: input.motivoPausa,
        dataInicioPausa: input.dataInicioPausa,
        dataRetornoPrevista: input.dataRetornoPrevista ?? null,
        manterVaga: input.manterVaga,
        cobrarDurantePausa: input.cobrarDurantePausa,
      },
    },
  });

  const warnings: string[] = [];
  let asaasAction: PausarMatriculaResult['asaasAction'] = 'LOCAL_ONLY';
  let integrationStatus: PausarMatriculaResult['integrationStatus'] = 'SINCRONIZADO' as PausarMatriculaResult['integrationStatus'];
  let warningCode: string | null = null;
  let cobrancasFuturasRemovidas = 0;
  const deletedRemotePaymentIds: string[] = [];
  const failedRemotePaymentIds: string[] = [];
  let remoteDeletionUncertain = false;
  let localChargeAlignment = {
    scanned: 0,
    canceled: 0,
    pending: 0,
  };
  let canonicalAllocation = await input.prisma.billingAllocation.findFirst({
    where: {
      contaId: input.contaId,
      matriculaId: matricula.id,
      kind: 'TUITION',
      status: { in: ['ACTIVE', 'SCHEDULED'] },
    },
    orderBy: { validFrom: 'desc' },
    select: { id: true, agreementId: true, agreement: { select: { version: true } } },
  });
  // Matrículas familiares antigas podem ainda não ter o acordo canônico
  // materializado. Materializá-lo antes da pausa garante que a alteração
  // afete a assinatura consolidada, não apenas o status local do aluno.
  if (!canonicalAllocation && matricula.matriculaFamiliarId) {
    const familySubscription = await input.prisma.standaloneSubscription.findFirst({
      where: { contaId: input.contaId, familyGroupId: matricula.matriculaFamiliarId },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (familySubscription) {
      await materializeBillingAgreement({
        kind: 'FAMILY',
        contaId: input.contaId,
        standaloneSubscriptionId: familySubscription.id,
        familyGroupId: matricula.matriculaFamiliarId,
        actorId: input.actorId,
      });
      canonicalAllocation = await input.prisma.billingAllocation.findFirst({
        where: { contaId: input.contaId, matriculaId: matricula.id, kind: 'TUITION', status: { in: ['ACTIVE', 'SCHEDULED'] } },
        orderBy: { validFrom: 'desc' },
        select: { id: true, agreementId: true, agreement: { select: { version: true } } },
      });
    }
  }
  let canonicalApplied = false;

  if (canonicalAllocation && !input.cobrarDurantePausa) {
    try {
      const change = {
        kind: 'PAUSE_ALLOCATION' as const,
        contaId: input.contaId,
        agreementId: canonicalAllocation.agreementId,
        actorId: input.actorId,
        reason: input.motivoPausa,
        effectivePolicy: 'CURRENT_CYCLE_FULL' as const,
        effectiveDate: input.dataInicioPausa,
        allocationIds: [canonicalAllocation.id],
      };
      const preview = await previewBillingAgreementChange(change);
      const committed = await commitBillingAgreementChange({
        ...change,
        uiRequestId: `pause:${operacao.id}`,
        previewHash: preview.previewHash,
        previewExpiresAt: preview.expiresAt,
        expectedAgreementVersion: canonicalAllocation.agreement.version,
      });
      canonicalApplied = true;
      asaasAction = 'SUBSCRIPTION_INACTIVATED';
      integrationStatus = committed.status === 'COMPLETED' ? 'SINCRONIZADO' : 'DIVERGENTE';
      warningCode = committed.status === 'COMPLETED' ? null : 'OPERACAO_FINANCEIRA_REQUER_RECONCILIACAO';
    } catch (error) {
      await input.prisma.matriculaOperacao.update({
        where: { id: operacao.id },
        data: { status: 'ERRO', erro: error instanceof Error ? error.message : String(error), processedAt: new Date() },
      });
      throw buildFinancialError('pausar', matricula.asaasSubscriptionId ?? canonicalAllocation.agreementId, error);
    }
  }

  // Sincronizar com Asaas se houver assinatura e política de não cobrar
  if (!canonicalApplied && matricula.asaasSubscriptionId) {
    if (input.cobrarDurantePausa) {
      asaasAction = 'SKIPPED_COBRAR_DURANTE_PAUSA';
    } else {
      // 1. Inativar assinatura no Asaas
      try {
        await pauseAssinatura({
          subscriptionId: matricula.asaasSubscriptionId,
          contaId: input.contaId,
        });
        asaasAction = 'SUBSCRIPTION_INACTIVATED';
      } catch (error) {
        // Registrar falha na operação
        await input.prisma.matriculaOperacao.update({
          where: { id: operacao.id },
          data: {
            status: 'ERRO',
            erro: error instanceof Error ? error.message : String(error),
            payloadRecebido: { error: true },
            processedAt: new Date(),
          },
        });
        throw buildFinancialError('pausar', matricula.asaasSubscriptionId, error);
      }

      // 2. Listar cobranças da assinatura e remover futuras não liquidadas
      try {
        const payments = await listSubscriptionPayments(
          matricula.asaasSubscriptionId,
          { contaId: input.contaId, limit: 100 },
        );

        const today = input.dataInicioPausa;
        const futurasIndevidas = payments.data.filter((p) => {
          const isPending = p.status === 'PENDING' || p.status === 'OVERDUE';
          const isFuture = p.dueDate >= today;
          return isPending && isFuture;
        });

        for (const payment of futurasIndevidas) {
          try {
            await deletePayment(payment.id, { contaId: input.contaId });
            deletedRemotePaymentIds.push(payment.id);
            cobrancasFuturasRemovidas++;
          } catch (deleteError) {
            failedRemotePaymentIds.push(payment.id);
            warnings.push(`Não foi possível remover a cobrança ${payment.id}: ${deleteError instanceof Error ? deleteError.message : 'erro desconhecido'}`);
          }
        }
      } catch (listError) {
        remoteDeletionUncertain = true;
        warnings.push(`Não foi possível listar cobranças da assinatura para remoção: ${listError instanceof Error ? listError.message : 'erro desconhecido'}`);
      }
    }

    integrationStatus = asaasAction === 'SUBSCRIPTION_INACTIVATED' ? 'PENDENTE_SINCRONISMO' : 'SINCRONIZADO';
  }

  if (warnings.length > 0) {
    warningCode = 'COBRANCAS_FUTURAS_NAO_REMOVIDAS';
  }

  // Atualizar matrícula
  let finalIntegrationStatus: PausarMatriculaResult['integrationStatus'] = integrationStatus;
  let finalWarningCode = warningCode;

  await input.prisma.$transaction(async (tx) => {
    if (!input.cobrarDurantePausa) {
      localChargeAlignment = await cancelLocalFutureEnrollmentCharges({
        db: tx,
        matriculaId: matricula.id,
        contaId: input.contaId,
        effectiveDate: input.dataInicioPausa,
        actor: { id: input.actorId },
        reason: input.motivoPausa,
        canceledRemotePaymentIds: deletedRemotePaymentIds,
        failedRemotePaymentIds,
        remoteDeletionUncertain,
      });

      if (localChargeAlignment.pending > 0) {
        finalIntegrationStatus = 'DIVERGENTE';
        finalWarningCode = 'COBRANCAS_FUTURAS_CANCELAMENTO_PENDENTE';
        warnings.push(
          'Algumas cobranças futuras ficaram pendentes de confirmação no Asaas e precisam de reconciliação.',
        );
      }
    }

    await tx.matricula.update({
      where: { id: matricula.id, version: matricula.version },
      data: {
        status: 'PAUSADA',
        pausaAtiva: true,
        dataInicioPausa: new Date(input.dataInicioPausa),
        dataRetornoPrevista: input.dataRetornoPrevista ? new Date(input.dataRetornoPrevista) : null,
        manterVaga: input.manterVaga,
        cobrarDurantePausa: input.cobrarDurantePausa,
        motivoPausa: input.motivoPausa,
        ...(input.cobrarDurantePausa ? {} : { statusFinanceiro: 'SUSPENSO' as const }),
        integrationStatus: finalIntegrationStatus,
        warningCode: finalWarningCode,
        version: { increment: 1 },
      },
    });

    await tx.matriculaLog.create({
      data: {
        matriculaId: matricula.id,
        actorId: input.actorId,
        action: 'MATRICULA_PAUSADA',
        metadata: {
          correlationId: operacao.correlationId,
          motivoPausa: input.motivoPausa,
          dataInicioPausa: input.dataInicioPausa,
          dataRetornoPrevista: input.dataRetornoPrevista ?? null,
          manterVaga: input.manterVaga,
          cobrarDurantePausa: input.cobrarDurantePausa,
          asaasAction,
          cobrancasFuturasRemovidas,
          localChargeAlignment,
          deletedRemotePaymentIds,
          failedRemotePaymentIds,
          remoteDeletionUncertain,
        },
      },
    });
  });

  integrationStatus = finalIntegrationStatus;
  warningCode = finalWarningCode;

  const familyImpact = matricula.matriculaFamiliarId
    ? await syncFamilyLifecycleAggregate({
        prisma: input.prisma,
        contaId: input.contaId,
        familyId: matricula.matriculaFamiliarId,
      })
    : null;

  if (integrationStatus === 'DIVERGENTE') {
    try {
      await markEnrollmentFinanceDivergence({
        contaId: input.contaId,
        matriculaId: matricula.id,
        asaasSubscriptionId: matricula.asaasSubscriptionId,
        issue: 'PAYMENT_STATUS_DRIFT',
        severity: 'HIGH',
        localStatus: warningCode,
        remoteStatus: remoteDeletionUncertain ? 'UNKNOWN' : 'PARTIAL_FAILURE',
        metadata: {
          correlationId: operacao.correlationId,
          localChargeAlignment,
          deletedRemotePaymentIds,
          failedRemotePaymentIds,
          remoteDeletionUncertain,
        },
      });
    } catch (error) {
      logEnrollmentOperationalEvent('api.enrollment.finance.divergence_audit.failed', error);
    }
  }

  // Atualizar operação
  await input.prisma.matriculaOperacao.update({
    where: { id: operacao.id },
    data: {
      status: integrationStatus === 'PENDENTE_SINCRONISMO' ? 'PENDENTE_SINCRONISMO' : 'SINCRONIZADO',
      payloadRecebido: {
        asaasAction,
        cobrancasFuturasRemovidas,
        localChargeAlignment,
        warnings,
      },
      processedAt: new Date(),
    },
  });

  return {
    matriculaId: matricula.id,
    operacaoId: operacao.id,
    correlationId: operacao.correlationId,
    previousStatus: matricula.status,
    newStatus: 'PAUSADA',
    manterVaga: input.manterVaga,
    cobrarDurantePausa: input.cobrarDurantePausa,
    integrationStatus,
    warningCode,
    asaasAction,
    cobrancasFuturasRemovidas,
    warnings,
    familyImpact,
  };
}

// ============================================================================
// REATIVAR MATRÍCULA
// ============================================================================

export async function reativarMatricula(input: ReativarMatriculaInput): Promise<ReativarMatriculaResult> {
  if (!input.nextDueDate) {
    throw new PausaBusinessError(
      'NEXT_DUE_DATE_OBRIGATORIO_PARA_REATIVAR',
      'É obrigatório informar a data da próxima cobrança ao reativar a matrícula.',
    );
  }

  if (input.nextDueDate < input.dataRetornoEfetiva) {
    throw new PausaBusinessError(
      'NEXT_DUE_DATE_INVALIDA',
      'A próxima cobrança deve vencer na data de retorno ou depois dela.',
    );
  }

  const pauseDeadlineSnapshot = await input.prisma.matricula.findFirst({
    where: { id: input.matriculaId, contaId: input.contaId },
    select: { status: true, pausaAtiva: true, dataRetornoPrevista: true, dataFimContrato: true },
  });
  if (!pauseDeadlineSnapshot) {
    throw new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404);
  }
  if (pauseDeadlineSnapshot.status === 'PAUSADA') {
    await assertEnrollmentTermAllowsReactivation({
      tx: input.prisma,
      contaId: input.contaId,
      dataFimContrato: pauseDeadlineSnapshot.dataFimContrato,
    });
  }
  await assertPauseDeadlineRegularized({
    tx: input.prisma,
    contaId: input.contaId,
    matriculaId: input.matriculaId,
    status: pauseDeadlineSnapshot?.status ?? '',
    pausaAtiva: pauseDeadlineSnapshot?.pausaAtiva ?? false,
    dataRetornoPrevista: pauseDeadlineSnapshot?.dataRetornoPrevista ?? null,
    dataFimContrato: pauseDeadlineSnapshot?.dataFimContrato ?? null,
  });

  await reconcileMatriculaPendingSynchronization({
    prisma: input.prisma,
    matriculaId: input.matriculaId,
    contaId: input.contaId,
  });

  const operacaoPendente = await input.prisma.matriculaOperacao.findFirst({
    where: {
      matriculaId: input.matriculaId,
      tipo: 'REATIVACAO',
      status: 'PENDENTE_SINCRONISMO',
    },
    select: { id: true, correlationId: true, createdAt: true },
  });

  if (operacaoPendente) {
    throw new PausaBusinessError(
      'OPERACAO_DUPLICADA',
      'Já existe uma solicitação de reativação em processamento para esta matrícula.',
      409,
      {
        operacaoId: operacaoPendente.id,
        correlationId: operacaoPendente.correlationId,
        createdAt: operacaoPendente.createdAt,
      },
    );
  }

  const matricula = await input.prisma.matricula.findFirst({
    where: { id: input.matriculaId, aluno: { contaId: input.contaId } },
    select: {
      id: true,
      alunoId: true,
      status: true,
      pausaAtiva: true,
      dataRetornoPrevista: true,
      manterVaga: true,
      cobrarDurantePausa: true,
      asaasSubscriptionId: true,
      matriculaFamiliarId: true,
      version: true,
      turmaId: true,
      comboId: true,
      dataFimContrato: true,
      combo: { select: { turmas: { select: { turmaId: true } } } },
      matriculaTurmas: { select: { turmaId: true } },
    },
  });

  if (!matricula) {
    throw new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404);
  }

  const validacao = validateReativacao(matricula.status, matricula.manterVaga);
  if (!validacao.success) {
    const msgs: Record<string, string> = {
      MATRICULA_NAO_PAUSADA: 'A matrícula precisa estar com status Pausada para ser reativada.',
      SEM_VAGA_PARA_REATIVACAO: 'Não há vaga disponível na turma para reativar esta matrícula. A pausa liberou a vaga e a turma está lotada.',
    };
    throw new PausaBusinessError(validacao.error, msgs[validacao.error] ?? validacao.error);
  }

  // Reserve capacity before any Asaas side effect. The row remains paused while
  // reserved, and manterVaga=true makes that reservation visible to all
  // occupancy queries. Advisory locks match enrollment creation.
  const effectiveStart = new Date(`${input.dataRetornoEfetiva}T12:00:00.000Z`);
  let reservedVersion = matricula.version;
  const operacao = await input.prisma.$transaction(async (tx) => {
    const classIds = Array.from(new Set([
      ...(matricula.turmaId ? [matricula.turmaId] : []),
      ...(matricula.matriculaTurmas ?? []).map((item) => item.turmaId),
      ...(matricula.combo?.turmas?.map((item) => item.turmaId) ?? []),
    ])).sort();
    const lockIds = [
      ...classIds.map((id) => `turma:${id}`),
      ...(matricula.comboId ? [`combo:${matricula.comboId}`] : []),
    ].sort();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.contaId}), hashtext(${matricula.alunoId}))`;
    for (const lockId of lockIds) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.contaId}), hashtext(${lockId}))`;
    }

    const current = await tx.matricula.findFirst({
      where: { id: matricula.id, aluno: { contaId: input.contaId } },
      select: { id: true, status: true, version: true, manterVaga: true, pausaAtiva: true, dataRetornoPrevista: true, dataFimContrato: true },
    });
    if (!current || current.status !== 'PAUSADA' || current.version !== matricula.version) {
      throw new PausaBusinessError(
        'OPERACAO_DUPLICADA',
        'A matrícula mudou durante a reativação. Atualize os dados e tente novamente.',
        409,
      );
    }

    await assertEnrollmentTermAllowsReactivation({
      tx,
      contaId: input.contaId,
      dataFimContrato: current.dataFimContrato,
    });

    await assertPauseDeadlineRegularized({
      tx,
      contaId: input.contaId,
      matriculaId: matricula.id,
      status: current.status,
      pausaAtiva: current.pausaAtiva,
      dataRetornoPrevista: current.dataRetornoPrevista,
      dataFimContrato: current.dataFimContrato,
    });

    const occupancyPeriod = buildSeatOccupancyOverlapWhereClause(
      effectiveStart,
      matricula.dataFimContrato ?? effectiveStart,
    );
    if (!current.manterVaga) {
      const turmas = await tx.turma.findMany({
        where: { contaId: input.contaId, id: { in: classIds } },
        select: { id: true, nome: true, capacidade: true, diasSemana: true, horaInicio: true, horaFim: true },
      });
      for (const turma of turmas) {
        const occupied = await tx.matricula.count({
          where: {
            contaId: input.contaId,
            OR: [{ turmaId: turma.id }, { matriculaTurmas: { some: { turmaId: turma.id } } }],
            ...occupancyPeriod,
            NOT: { id: matricula.id },
          },
        });
        if (!validarCapacidade([{ id: turma.id, nome: turma.nome, capacidade: turma.capacidade, matriculasOcupantes: occupied }]).success) {
          throw new PausaBusinessError('SEM_VAGA_PARA_REATIVACAO', `Não há vaga disponível na turma "${turma.nome}" para reativar esta matrícula.`);
        }
      }

      if (matricula.comboId) {
        const combo = await tx.combo.findFirst({
          where: { id: matricula.comboId, contaId: input.contaId },
          select: { id: true, vagasLimite: true },
        });
        if (!combo) throw new PausaBusinessError('COMBO_NAO_ENCONTRADO', 'Combo da matrícula não encontrado.', 409);
        if (combo.vagasLimite != null) {
          const occupied = await tx.matricula.count({
            where: { contaId: input.contaId, comboId: combo.id, ...occupancyPeriod, NOT: { id: matricula.id } },
          });
          if (!validarCapacidade([], { vagasLimite: combo.vagasLimite, matriculasOcupantes: occupied }).success) {
            throw new PausaBusinessError('COMBO_SEM_VAGAS', 'Combo não possui vagas disponíveis para reativar esta matrícula.');
          }
        }
      }

      const otherEnrollments = await tx.matricula.findMany({
        where: { contaId: input.contaId, alunoId: matricula.alunoId, ...occupancyPeriod, NOT: { id: matricula.id } },
        include: {
          turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true } },
          matriculaTurmas: { include: { turma: { select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true } } } },
        },
      });
      const existingClasses = Array.from(new Map(
        otherEnrollments.flatMap((item) => [item.turma, ...item.matriculaTurmas.map((membership) => membership.turma)])
          .filter((item): item is NonNullable<typeof item> => item !== null)
          .map((item) => [item.id, item]),
      ).values());
      const targetClasses = await tx.turma.findMany({
        where: { contaId: input.contaId, id: { in: classIds } },
        select: { id: true, nome: true, diasSemana: true, horaInicio: true, horaFim: true },
      });
      const conflict = validarConflitosHorario(targetClasses, existingClasses);
      if (!conflict.success) {
        throw new PausaBusinessError('CONFLITO_HORARIO', `Conflito de horário entre "${conflict.turma1}" e "${conflict.turma2}".`);
      }
    }

    const additionalActiveStudents = await countAdditionalActiveStudentsForEnrollment({
      tx,
      contaId: input.contaId,
      alunoId: matricula.alunoId,
    });
    await assertStudentCapacity({ tx, contaId: input.contaId, additionalActiveStudents, operation: 'matricula.pause.reactivate' });

    const operation = await tx.matriculaOperacao.create({
      data: {
        matriculaId: matricula.id,
        contaId: input.contaId,
        tipo: 'REATIVACAO',
        origem: 'USER',
        status: 'PENDENTE_SINCRONISMO',
        actorId: input.actorId,
        observacao: input.observacao,
        payloadEnviado: { dataRetornoEfetiva: input.dataRetornoEfetiva, nextDueDate: input.nextDueDate },
      },
    });
    if (!current.manterVaga) {
      const reservation = await tx.matricula.update({
        where: { id: matricula.id, version: current.version },
        data: { manterVaga: true, version: { increment: 1 }, integrationStatus: 'PENDENTE_SINCRONISMO' },
        select: { version: true },
      });
      reservedVersion = reservation.version;
    }
    return operation;
  });

  const warnings: string[] = [];
  let asaasAction: ReativarMatriculaResult['asaasAction'] = 'LOCAL_ONLY';
  let integrationStatus: ReativarMatriculaResult['integrationStatus'] = 'SINCRONIZADO';
  let warningCode: string | null = null;
  let pausedCanonicalAllocation = await input.prisma.billingAllocation.findFirst({
    where: {
      contaId: input.contaId,
      matriculaId: matricula.id,
      kind: 'TUITION',
      status: 'PAUSED',
    },
    orderBy: { validUntil: 'desc' },
    select: { id: true, agreementId: true, agreement: { select: { version: true } } },
  });
  if (!pausedCanonicalAllocation && matricula.matriculaFamiliarId) {
    const familySubscription = await input.prisma.standaloneSubscription.findFirst({
      where: { contaId: input.contaId, familyGroupId: matricula.matriculaFamiliarId },
      select: { id: true },
      orderBy: { updatedAt: 'desc' },
    });
    if (familySubscription) {
      await materializeBillingAgreement({
        kind: 'FAMILY', contaId: input.contaId, standaloneSubscriptionId: familySubscription.id,
        familyGroupId: matricula.matriculaFamiliarId, actorId: input.actorId,
      });
      pausedCanonicalAllocation = await input.prisma.billingAllocation.findFirst({
        where: { contaId: input.contaId, matriculaId: matricula.id, kind: 'TUITION', status: 'PAUSED' },
        orderBy: { validUntil: 'desc' },
        select: { id: true, agreementId: true, agreement: { select: { version: true } } },
      });
    }
  }
  let canonicalApplied = false;

  if (pausedCanonicalAllocation && !matricula.cobrarDurantePausa) {
    try {
      const change = {
        kind: 'RESUME_ALLOCATION' as const,
        contaId: input.contaId,
        agreementId: pausedCanonicalAllocation.agreementId,
        actorId: input.actorId,
        reason: input.observacao?.trim() || 'Reativação da matrícula',
        effectivePolicy: 'CURRENT_CYCLE_FULL' as const,
        effectiveDate: input.dataRetornoEfetiva,
        allocationIds: [pausedCanonicalAllocation.id],
        nextDueDate: input.nextDueDate,
      };
      const preview = await previewBillingAgreementChange(change);
      const committed = await commitBillingAgreementChange({
        ...change,
        uiRequestId: `resume:${operacao.id}`,
        previewHash: preview.previewHash,
        previewExpiresAt: preview.expiresAt,
        expectedAgreementVersion: pausedCanonicalAllocation.agreement.version,
      });
      canonicalApplied = true;
      asaasAction = 'SUBSCRIPTION_UPDATED';
      integrationStatus = committed.status === 'COMPLETED' ? 'SINCRONIZADO' : 'DIVERGENTE';
      warningCode = committed.status === 'COMPLETED' ? null : 'OPERACAO_FINANCEIRA_REQUER_RECONCILIACAO';
    } catch (error) {
      const outcomeUncertain = !(error instanceof AsaasHttpError) || error.status >= 500;
      if (!outcomeUncertain && !matricula.manterVaga) {
        await input.prisma.matricula.updateMany({
          where: { id: matricula.id, aluno: { contaId: input.contaId }, version: reservedVersion, status: 'PAUSADA' },
          data: { manterVaga: false, integrationStatus: 'DIVERGENTE', version: { increment: 1 } },
        });
      }
      await input.prisma.matriculaOperacao.update({
        where: { id: operacao.id },
        data: {
          status: outcomeUncertain ? 'PENDENTE_SINCRONISMO' : 'ERRO',
          erro: error instanceof Error ? error.message : String(error),
          payloadRecebido: { outcomeUncertain },
          processedAt: outcomeUncertain ? null : new Date(),
        },
      });
      throw buildFinancialError('reativar', matricula.asaasSubscriptionId ?? pausedCanonicalAllocation.agreementId, error);
    }
  }

  if (!canonicalApplied && matricula.asaasSubscriptionId && !matricula.cobrarDurantePausa) {
    try {
      await ativarAssinatura({
        subscriptionId: matricula.asaasSubscriptionId,
        contaId: input.contaId,
        nextDueDate: input.nextDueDate,
      });
      asaasAction = 'SUBSCRIPTION_UPDATED';
      integrationStatus = 'PENDENTE_SINCRONISMO'; // Aguardamos webhook de confirmação

    } catch (error) {
      const outcomeUncertain = !(error instanceof AsaasHttpError) || error.status >= 500;
      if (!outcomeUncertain && !matricula.manterVaga) {
        await input.prisma.matricula.updateMany({
          where: { id: matricula.id, aluno: { contaId: input.contaId }, version: reservedVersion, status: 'PAUSADA' },
          data: { manterVaga: false, integrationStatus: 'DIVERGENTE', version: { increment: 1 } },
        });
      }
      await input.prisma.matriculaOperacao.update({
        where: { id: operacao.id },
        data: {
          status: outcomeUncertain ? 'PENDENTE_SINCRONISMO' : 'ERRO',
          erro: error instanceof Error ? error.message : String(error),
          payloadRecebido: { error: true, outcomeUncertain },
          processedAt: outcomeUncertain ? null : new Date(),
        },
      });
      throw buildFinancialError('reativar', matricula.asaasSubscriptionId, error);
    }
  }

  // Atualizar matrícula
  await input.prisma.$transaction(async (tx) => {
    const [overdueCharges, openEnrollmentFee] = await Promise.all([
      tx.cobranca.count({
        where: {
          contaId: input.contaId,
          matriculaId: matricula.id,
          status: 'ATRASADO',
        },
      }),
      tx.cobranca.count({
        where: {
          contaId: input.contaId,
          matriculaId: matricula.id,
          tipo: 'TAXA_MATRICULA',
          status: { in: ['A_VENCER', 'PENDENTE', 'PROCESSANDO', 'ATRASADO'] },
        },
      }),
    ]);

    const restoredFinancialStatus = overdueCharges > 0
      ? 'INADIMPLENTE' as const
      : openEnrollmentFee > 0
        ? 'PENDENTE_TAXA' as const
        : 'ADIMPLENTE' as const;

    await tx.matricula.update({
      where: { id: matricula.id, version: reservedVersion },
      data: {
        status: 'ATIVA',
        pausaAtiva: false,
        dataInicioPausa: null,
        dataRetornoPrevista: null,
        manterVaga: true,
        cobrarDurantePausa: false,
        motivoPausa: null,
        statusFinanceiro: restoredFinancialStatus,
        integrationStatus,
        warningCode,
        version: { increment: 1 },
      },
    });
    await tx.matriculaVinculoAcademico.updateMany({
      where: { contaId: input.contaId, matriculaId: matricula.id, vigenciaIniciadaEm: null },
      data: { vigenciaIniciadaEm: effectiveStart },
    });

    await tx.matriculaLog.create({
      data: {
        matriculaId: matricula.id,
        actorId: input.actorId,
        action: 'MATRICULA_REATIVADA',
        metadata: {
          correlationId: operacao.correlationId,
          dataRetornoEfetiva: input.dataRetornoEfetiva,
          nextDueDate: input.nextDueDate,
          asaasAction,
          warningCode,
          warnings,
          manterVagaAnterior: matricula.manterVaga,
        },
      },
    });
  });

  await input.prisma.matriculaOperacao.update({
    where: { id: operacao.id },
    data: {
      status:
        integrationStatus === 'PENDENTE_SINCRONISMO'
          ? 'PENDENTE_SINCRONISMO'
          : integrationStatus === 'DIVERGENTE'
            ? 'ERRO'
            : 'SINCRONIZADO',
      erro:
        integrationStatus === 'DIVERGENTE'
          ? 'A assinatura foi reativada, mas a cobrança já gerada não pôde ser alinhada automaticamente.'
          : null,
      payloadRecebido: { asaasAction, warnings },
      processedAt: new Date(),
    },
  });

  const familyImpact = matricula.matriculaFamiliarId
    ? await syncFamilyLifecycleAggregate({
        prisma: input.prisma,
        contaId: input.contaId,
        familyId: matricula.matriculaFamiliarId,
      })
    : null;

  return {
    matriculaId: matricula.id,
    operacaoId: operacao.id,
    correlationId: operacao.correlationId,
    previousStatus: matricula.status,
    newStatus: 'ATIVA',
    integrationStatus,
    warningCode,
    asaasAction,
    warnings,
    familyImpact,
  };
}

// ============================================================================
// RESUMO DE PAUSA
// ============================================================================

export type PausaResumoResult = {
  matriculaId: string;
  status: StatusMatricula;
  pausaAtiva: boolean;
  dataInicioPausa: string | null;
  dataRetornoPrevista: string | null;
  manterVaga: boolean;
  cobrarDurantePausa: boolean;
  motivoPausa: string | null;
  integrationStatus: string;
  warningCode: string | null;
  asaasSubscriptionId: string | null;
  regularizacaoPausa: PausaRegularizacaoElegibilidade;
  operacoes: Array<{
    id: string;
    tipo: string;
    status: string;
    createdAt: string;
    processedAt: string | null;
    observacao: string | null;
    cobrancasFuturasRemovidas: number;
    warnings: string[];
  }>;
};

export async function getPausaResumo(
  matriculaId: string,
  contaId: string,
  prisma: PrismaClient = defaultPrisma,
): Promise<PausaResumoResult> {
  const matricula = await prisma.matricula.findFirst({
    where: { id: matriculaId, aluno: { contaId } },
    select: {
      id: true,
      status: true,
      pausaAtiva: true,
      dataInicioPausa: true,
      dataRetornoPrevista: true,
      dataFimContrato: true,
      manterVaga: true,
      cobrarDurantePausa: true,
      motivoPausa: true,
      integrationStatus: true,
      warningCode: true,
      asaasSubscriptionId: true,
      operacoes: {
        where: { contaId, tipo: { in: ['PAUSA', 'REATIVACAO'] } },
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          tipo: true,
          status: true,
          createdAt: true,
          processedAt: true,
          observacao: true,
          payloadRecebido: true,
        },
      },
    },
  });

  if (!matricula) {
    throw new PausaBusinessError('MATRICULA_NOT_FOUND', 'Matrícula não encontrada.', 404);
  }

  const regularizacaoPausa = await carregarElegibilidadeRegularizacaoPausa({
    tx: prisma,
    contaId,
    matriculaId: matricula.id,
    status: matricula.status,
    pausaAtiva: matricula.pausaAtiva,
    dataRetornoPrevista: matricula.dataRetornoPrevista,
    dataFimContrato: matricula.dataFimContrato,
  });

  return {
    matriculaId: matricula.id,
    status: matricula.status,
    pausaAtiva: matricula.pausaAtiva,
    dataInicioPausa: matricula.dataInicioPausa?.toISOString().slice(0, 10) ?? null,
    dataRetornoPrevista: matricula.dataRetornoPrevista?.toISOString().slice(0, 10) ?? null,
    manterVaga: matricula.manterVaga,
    cobrarDurantePausa: matricula.cobrarDurantePausa,
    motivoPausa: matricula.motivoPausa,
    integrationStatus: matricula.integrationStatus,
    warningCode: matricula.warningCode,
    asaasSubscriptionId: matricula.asaasSubscriptionId,
    regularizacaoPausa: {
      elegivel: regularizacaoPausa.elegivel,
      exigeRegularizacao: regularizacaoPausa.exigeRegularizacao,
      codigo: regularizacaoPausa.codigo,
      mensagem: regularizacaoPausa.mensagem,
    },
    operacoes: matricula.operacoes.map((op) => ({
      id: op.id,
      tipo: op.tipo,
      status: op.status,
      createdAt: op.createdAt.toISOString(),
      processedAt: op.processedAt?.toISOString() ?? null,
      observacao: op.observacao,
      cobrancasFuturasRemovidas:
        op.payloadRecebido &&
        typeof op.payloadRecebido === 'object' &&
        !Array.isArray(op.payloadRecebido) &&
        typeof (op.payloadRecebido as Record<string, unknown>).cobrancasFuturasRemovidas === 'number'
          ? Number((op.payloadRecebido as Record<string, unknown>).cobrancasFuturasRemovidas)
          : 0,
      warnings:
        op.payloadRecebido &&
        typeof op.payloadRecebido === 'object' &&
        !Array.isArray(op.payloadRecebido) &&
        Array.isArray((op.payloadRecebido as Record<string, unknown>).warnings)
          ? ((op.payloadRecebido as Record<string, unknown>).warnings as unknown[]).filter(
              (item): item is string => typeof item === 'string',
            )
          : [],
    })),
  };
}
