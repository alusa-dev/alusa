import { prisma } from '@alusa/database';
import { type AuditActorType } from '@prisma/client';

import { auditLogService } from '../../foundation/audit-log.service';
import { withAdvisoryLock } from '../../foundation/advisory-lock.server';

export type CloseAccountResultType = 'DEACTIVATED_INTERNAL';

export type CloseAccountErrorCode =
  | 'CONFIRM_TEXT_INVALID'
  | 'REMOVE_REASON_REQUIRED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'LOCK_NOT_ACQUIRED'
  | 'UNEXPECTED_ERROR';

export type CloseAccountResult =
  | {
      success: true;
      result: CloseAccountResultType;
      message: string;
      asaasAttempted: boolean;
      asaasSuccess: boolean;
    }
  | {
      success: false;
      errorCode: CloseAccountErrorCode;
      message: string;
    };

function toTrimmed(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function resultMessage(): string {
  return 'Conta desativada. Para voltar a acessar, solicite a reativação pelo e-mail cadastrado.';
}

export async function encerrarContaAlusa(input: {
  contaId: string;
  confirmText: string;
  reason: string;
  actor: { type: AuditActorType; id?: string; role?: string };
  requestId?: string;
  ip?: string | null;
}): Promise<CloseAccountResult> {
  const reason = toTrimmed(input.reason);

  if (input.confirmText !== 'DESATIVAR') {
    return {
      success: false,
      errorCode: 'CONFIRM_TEXT_INVALID',
      message: 'Digite DESATIVAR para confirmar.',
    };
  }

  if (!reason || reason.length < 5) {
    return {
      success: false,
      errorCode: 'REMOVE_REASON_REQUIRED',
      message: 'Informe um motivo com pelo menos 5 caracteres.',
    };
  }

  const lockKey = `close-account:${input.contaId}`;
  const locked = await withAdvisoryLock(
    lockKey,
    async () => {
      const conta = await prisma.conta.findUnique({
        where: { id: input.contaId },
        select: { id: true, ownerUserId: true, status: true, deletedAt: true },
      });

      if (!conta) {
        return {
          success: false,
          errorCode: 'NOT_FOUND',
          message: 'Conta não encontrada.',
        } as CloseAccountResult;
      }

      const isAdmin =
        (input.actor.role ?? '').toUpperCase() === 'ADMIN' || input.actor.type === 'ADMIN';
      const isOwner = Boolean(
        input.actor.id && conta.ownerUserId && input.actor.id === conta.ownerUserId,
      );

      if (!isAdmin && !isOwner) {
        return {
          success: false,
          errorCode: 'FORBIDDEN',
          message: 'Acesso negado.',
        } as CloseAccountResult;
      }

      const alreadyClosed =
        Boolean(conta.deletedAt) || String(conta.status).toUpperCase() !== 'ATIVO';
      if (!alreadyClosed) {
        const now = new Date();

        await prisma.conta.update({
          where: { id: conta.id },
          data: {
            status: 'INATIVO',
            deletedAt: now,
            deletedByUserId: input.actor.id,
            deleteReason: reason,
          },
        });

        await auditLogService.record({
          contaId: conta.id,
          action: 'conta.deactivated',
          entity: { type: 'Conta', id: conta.id },
          metadata: {
            reason,
            requestId: input.requestId ?? null,
            deactivatedIp: input.ip ?? null,
            preservedFinancialHistory: true,
            preservedExternalAccount: true,
          },
          actor: { type: input.actor.type, id: input.actor.id },
        });

        console.info('[conta.desativar] conta desativada', {
          contaId: conta.id,
          actorId: input.actor.id ?? null,
        });
      }

      return {
        success: true,
        result: 'DEACTIVATED_INTERNAL',
        message: resultMessage(),
        asaasAttempted: false,
        asaasSuccess: false,
      } as CloseAccountResult;
    },
    { logContext: { contaId: input.contaId, actorId: input.actor.id } },
  );

  if (!locked.acquired) {
    return {
      success: false,
      errorCode: 'LOCK_NOT_ACQUIRED',
      message: 'Processo já em andamento. Tente novamente em instantes.',
    };
  }

  return locked.result;
}
