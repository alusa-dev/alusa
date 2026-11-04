import { Role } from '@prisma/client';
import {
  createInvite,
  DuplicateInviteError,
  ForbiddenRoleError,
  InvalidInviteTargetError,
  MissingContaError,
  UserAlreadyLinkedError,
  UserInactiveError,
} from '@alusa/lib/server/services/invite-user-service';
import { findInviteTargetInConta } from '@/src/server/users/invite-scope.service';
import prisma from '@/lib/prisma';
import { sendInviteEmail } from '@/lib/auth-email-flow';
import { getInviteBaseUrl } from '@/lib/app-url';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';
import type { InviteRoleDTO } from '@/features/users/dtos';

export type EmployeeAccessInviteStatus = 'pending' | 'sent' | 'failed' | 'already_active';

export type EmployeeAccessInviteResult = {
  status: EmployeeAccessInviteStatus;
  message: string;
  inviteUrl?: string;
};

export async function inviteEmployeeAccess(input: {
  contaId: string;
  invitedById: string;
  invitedByName?: string | null;
  recordId: string;
  email: string;
  role: InviteRoleDTO;
  request?: Request;
}): Promise<EmployeeAccessInviteResult> {
  let actorMembership;
  try {
    actorMembership = await prisma.usuarioConta.findFirst({
      where: {
        usuarioId: input.invitedById,
        contaId: input.contaId,
        status: 'ATIVO',
        usuario: { status: 'ATIVO' },
        conta: { status: 'ATIVO', deletedAt: null },
      },
      select: { role: true },
    });
  } catch (error) {
    logInviteFailure(input.request, error);
    actorMembership = null;
  }
  if (actorMembership?.role !== 'ADMIN') {
    return {
      status: 'failed',
      message: 'Colaborador salvo. Somente um administrador ativo desta escola pode enviar convites de acesso.',
    };
  }

  const target = await findInviteTargetInConta(input.contaId, {
    recordType: 'COLABORADOR',
    recordId: input.recordId,
  }).catch(() => null);

  if (!target || target.email !== input.email.trim().toLowerCase()) {
    return {
      status: 'failed',
      message: 'Colaborador salvo, mas não foi possível validar o cadastro para liberar acesso. Revise o e-mail e tente novamente.',
    };
  }
  if (target.accessStatus === 'ACTIVE') {
    return { status: 'already_active', message: 'Colaborador salvo. O acesso já está ativo nesta escola.' };
  }

  let baseUrl: string;
  try {
    baseUrl = getInviteBaseUrl();
  } catch (error) {
    logInviteFailure(input.request, error);
    return {
      status: 'failed',
      message: 'Colaborador salvo, mas o convite não pôde ser preparado. Verifique a configuração e tente novamente.',
    };
  }

  let invite: Awaited<ReturnType<typeof createInvite>>;
  try {
    invite = await createInvite(
      target.email,
      roleToPrismaRole(input.role),
      input.invitedById,
      input.contaId,
      { target: { kind: 'EXISTING_RECORD', recordType: 'COLABORADOR', recordId: input.recordId } },
    );
  } catch (error) {
    if (error instanceof UserAlreadyLinkedError) {
      return { status: 'already_active', message: 'Colaborador salvo. O acesso já está ativo nesta escola.' };
    }
    if (error instanceof DuplicateInviteError) {
      let pending: Awaited<ReturnType<typeof findPendingEmployeeInvite>>;
      try {
        pending = await findPendingEmployeeInvite(input.contaId, input.recordId);
      } catch (lookupError) {
        logInviteFailure(input.request, lookupError);
        return { status: 'failed', message: 'Colaborador salvo, mas não foi possível recuperar o convite pendente. Tente novamente.' };
      }
      if (pending && pending.email === target.email && pending.role === roleToPrismaRole(input.role)) {
        const pendingUrl = new URL('/auth/register', `${baseUrl}/`);
        pendingUrl.searchParams.set('token', pending.token);
        return {
          status: 'pending',
          message: 'Colaborador salvo. O convite existente continua pendente; use o mesmo link para recuperar o envio.',
          inviteUrl: pendingUrl.toString(),
        };
      }
      if (pending) {
        return {
          status: 'failed',
          message: 'Colaborador salvo, mas já existe um convite pendente para este cadastro com outro e-mail ou perfil. Revise o convite existente antes de continuar.',
        };
      }
      return { status: 'pending', message: 'Colaborador salvo. Já existe um convite pendente; consulte Convites pendentes.' };
    }
    if (error instanceof UserInactiveError) {
      return { status: 'failed', message: 'Colaborador salvo, mas a identidade vinculada está inativa. Reative o usuário antes de convidar.' };
    }
    if (error instanceof InvalidInviteTargetError) {
      return { status: 'failed', message: 'Colaborador salvo, mas o e-mail não corresponde ao cadastro vinculado. Revise o vínculo antes de convidar.' };
    }
    if (error instanceof ForbiddenRoleError) {
      return { status: 'failed', message: 'Colaborador salvo, mas esse perfil não pode receber convite. Selecione outro perfil de acesso.' };
    }
    if (error instanceof MissingContaError) {
      return { status: 'failed', message: 'Colaborador salvo, mas não foi possível confirmar a conta ativa para o convite.' };
    }
    logInviteFailure(input.request, error);
    return { status: 'failed', message: 'Colaborador salvo, mas não foi possível criar o convite. Tente novamente.' };
  }

  const inviteUrl = new URL('/auth/register', `${baseUrl}/`);
  inviteUrl.searchParams.set('token', invite.token);
  const url = inviteUrl.toString();

  try {
    const delivery = await sendInviteEmail({
      inviteId: invite.id,
      inviteUrl: url,
      email: target.email,
      role: roleToPrismaRole(input.role),
      invitedByName: input.invitedByName ?? undefined,
      expiresAt: invite.expiresAt,
    });
    if (delivery.delivery === 'sent') {
      return { status: 'sent', message: 'Colaborador salvo e convite enviado por e-mail.' };
    }
    if (delivery.delivery === 'logged') {
      return {
        status: 'pending',
        message: 'Colaborador salvo. O convite está pendente; o e-mail não foi enviado pelo ambiente atual. Compartilhe o link abaixo.',
        inviteUrl: url,
      };
    }
    logInviteFailure(input.request, new Error('Invite email delivery returned failed'));
    return {
      status: 'failed',
      message: 'Colaborador salvo, mas o e-mail não foi enviado. O convite continua pendente; compartilhe o link abaixo.',
      inviteUrl: url,
    };
  } catch (error) {
    logInviteFailure(input.request, error);
    return {
      status: 'failed',
      message: 'Colaborador salvo, mas o e-mail não foi enviado. O convite continua pendente; compartilhe o link abaixo.',
      inviteUrl: url,
    };
  }
}

async function findPendingEmployeeInvite(contaId: string, recordId: string) {
  const rows = await prisma.invite.findMany({
    where: {
      contaId,
      status: 'PENDING',
      expiresAt: { gt: new Date() },
      metadata: { path: ['target', 'recordId'], equals: recordId },
    },
    orderBy: { createdAt: 'desc' },
    select: { email: true, role: true, token: true, metadata: true },
  });
  const row = rows.find((candidate) => {
    if (!candidate.metadata || typeof candidate.metadata !== 'object' || Array.isArray(candidate.metadata)) return false;
    const target = (candidate.metadata as { target?: unknown }).target;
    if (!target || typeof target !== 'object' || Array.isArray(target)) return false;
    const scopedTarget = target as { kind?: unknown; recordType?: unknown; recordId?: unknown };
    return scopedTarget.kind === 'EXISTING_RECORD' && scopedTarget.recordType === 'COLABORADOR' && scopedTarget.recordId === recordId;
  });
  if (!row) return null;
  return { ...row, email: row.email?.trim().toLowerCase() ?? null };
}

function roleToPrismaRole(role: InviteRoleDTO): Role {
  return role as Role;
}

function logInviteFailure(request: Request | undefined, error: unknown) {
  if (!request) return;
  logApiOperationalEvent({
    severity: 'warn',
    eventName: 'api.employees.access_invite.failed',
    route: new URL(request.url).pathname,
    method: request.method,
    requestId: getRequestId(request),
    error,
  });
}
