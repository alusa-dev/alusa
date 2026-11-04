import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { sendInviteEmail } from '@/lib/auth-email-flow';
import { getInviteBaseUrl } from '@/lib/app-url';
import type { CreateInviteInputDTO } from '@/features/users/dtos';
import { createInviteResultDTOSchema } from '@/features/users/dtos';
import { mapCreatedInviteRecordToDTO } from '@/features/users/mappers';
import { findInviteTargetInConta, findLegacyResponsibleTargetFromStudents } from './invite-scope.service';

export type InviteCreatorContext = {
  input: CreateInviteInputDTO;
  contaId: string;
  userId: string;
  role: string;
  name?: string | null;
};

export type InviteCreationApplicationResult = {
  status: number;
  body: Record<string, unknown>;
  rejected?: boolean;
  operationalError?: 'base-url' | 'delivery';
};

function result(status: number, body: Record<string, unknown>, extra: Partial<InviteCreationApplicationResult> = {}): InviteCreationApplicationResult {
  return { status, body, ...extra };
}

export function validateInviteCreationInput(input: CreateInviteInputDTO): InviteCreationApplicationResult | null {
  const legacyInput = 'target' in input ? null : input;
  const targetInput = 'target' in input
    ? input.target
    : legacyInput?.email
      ? { kind: 'EMAIL' as const, email: legacyInput.email, role: legacyInput.role }
      : null;
  const inviteRole = targetInput?.role ?? legacyInput?.role;
  if (inviteRole === 'ADMIN') return result(403, { error: 'Convites para ADMIN não são permitidos.' }, { rejected: true });
  if (!inviteRole) return result(400, { error: 'Dados inválidos' });
  if (targetInput?.kind === 'EMAIL' && inviteRole === 'RESPONSAVEL') return result(400, { error: 'Responsável deve ser selecionado a partir de um cadastro da escola.' });
  if (legacyInput && inviteRole === 'RESPONSAVEL' && (!legacyInput.alunosIds || legacyInput.alunosIds.length === 0)) {
    return result(400, { error: 'É necessário selecionar um cadastro de responsável existente.' });
  }
  if (targetInput?.kind === 'EXISTING_RECORD' && ((inviteRole === 'RESPONSAVEL') !== (targetInput.recordType === 'RESPONSAVEL'))) {
    return result(400, { error: 'Tipo de cadastro incompatível com o papel solicitado.' });
  }
  if (inviteRole !== 'RESPONSAVEL' && targetInput?.kind !== 'EXISTING_RECORD' && !targetInput?.email && !legacyInput?.email) {
    return result(400, { error: 'Email é obrigatório para esta função.' });
  }
  return null;
}

export async function createInviteApplication(context: InviteCreatorContext): Promise<InviteCreationApplicationResult> {
  const { input, contaId, userId, name, role: inviterRole } = context;
  const validation = validateInviteCreationInput(input);
  if (validation) return validation;
  const legacyInput = 'target' in input ? null : input;
  const targetInput = 'target' in input
    ? input.target
    : legacyInput?.email
      ? { kind: 'EMAIL' as const, email: legacyInput.email, role: legacyInput.role }
      : null;
  const inviteRole = targetInput?.role ?? legacyInput?.role;
  if (!inviteRole) return result(400, { error: 'Dados inválidos' });
  const normalizedRole = inviterRole.toUpperCase();
  if (normalizedRole !== 'ADMIN' && !(normalizedRole === 'RECEPCAO' && inviteRole === 'RESPONSAVEL')) {
    return result(403, { error: 'Sem permissão para convidar este papel.' });
  }

  let inviteBaseUrl: string;
  try { inviteBaseUrl = getInviteBaseUrl(); }
  catch { return result(503, { error: 'Não foi possível gerar o convite agora. Tente novamente mais tarde.' }, { operationalError: 'base-url' }); }

  try {
    let resolvedTarget: Awaited<ReturnType<typeof findInviteTargetInConta>> | null = null;
    if (targetInput?.kind === 'EXISTING_RECORD') resolvedTarget = await findInviteTargetInConta(contaId, targetInput);
    else if (legacyInput && inviteRole === 'RESPONSAVEL' && legacyInput.alunosIds) {
      resolvedTarget = await findLegacyResponsibleTargetFromStudents(contaId, legacyInput.alunosIds);
    }
    if ((targetInput?.kind === 'EXISTING_RECORD' || inviteRole === 'RESPONSAVEL') && !resolvedTarget) {
      return result(404, { error: 'Cadastro não localizado nesta escola ou sem vínculos válidos.' });
    }
    if (resolvedTarget?.accessStatus === 'ACTIVE') return result(409, { error: 'Este cadastro já tem acesso ativo nesta escola.' });
    const inviteEmail = resolvedTarget?.recordType === 'RESPONSAVEL'
      ? null
      : resolvedTarget?.email ?? (targetInput?.kind === 'EMAIL' ? targetInput.email : legacyInput?.email ?? null);
    if (!inviteEmail && inviteRole !== 'RESPONSAVEL') return result(400, { error: 'Email é obrigatório para esta função.' });
    const metadata = resolvedTarget ? {
      target: { kind: 'EXISTING_RECORD' as const, recordType: resolvedTarget.recordType, recordId: resolvedTarget.recordId },
      ...(resolvedTarget.recordType === 'RESPONSAVEL' ? { alunosIds: resolvedTarget.alunosIds } : {}),
    } : undefined;
    const createRole = inviteRole as Parameters<typeof InviteUserService.createInvite>[1];
    const invite = await InviteUserService.createInvite(inviteEmail, createRole, userId, contaId, metadata);
    const inviteUrl = new URL('/auth/register', `${inviteBaseUrl}/`);
    inviteUrl.searchParams.set('token', invite.token);
    const inviteLink = inviteUrl.toString();
    let emailDelivery: 'sent' | 'logged' | 'failed' | 'not_applicable' = 'not_applicable';
    let deliveryWarning = false;
    if (inviteEmail) {
      try {
        const delivery = await sendInviteEmail({ inviteId: invite.id, inviteUrl: inviteLink, email: inviteEmail, role: createRole, invitedByName: name, expiresAt: invite.expiresAt });
        emailDelivery = delivery.delivery;
      } catch {
        deliveryWarning = true;
        emailDelivery = 'failed';
      }
      try {
        await InviteUserService.recordInviteEmailDelivery({
          inviteId: invite.id, contaId,
          delivery: emailDelivery === 'sent' ? 'SENT' : emailDelivery === 'logged' ? 'LOGGED' : 'FAILED',
        });
      } catch { deliveryWarning = true; }
    }
    const body = createInviteResultDTOSchema.parse({
      invite: mapCreatedInviteRecordToDTO({
        ...invite,
        emailDeliveryStatus: emailDelivery === 'sent' ? 'SENT' : emailDelivery === 'logged' ? 'LOGGED' : emailDelivery === 'failed' ? 'FAILED' : 'NOT_APPLICABLE',
        deliveryAttempts: inviteEmail ? 1 : 0,
        lastDeliveryAttemptAt: inviteEmail ? new Date() : null,
        lastDeliveryErrorCode: emailDelivery === 'failed' ? 'DELIVERY_FAILED' : null,
        inviteUrl: inviteLink,
      }),
      emailDelivery,
    });
    return { status: 201, body, operationalError: deliveryWarning ? 'delivery' : undefined };
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Erro ao criar convite';
    const normalizedMessage = msg.toLocaleLowerCase('pt-BR');
    if (error instanceof InviteUserService.MissingContaError) return result(403, { error: msg });
    if (error instanceof InviteUserService.StudentAlreadyLinkedError) return result(409, { error: msg, code: 'STUDENT_ALREADY_LINKED' });
    if (error instanceof InviteUserService.InvalidInviteTargetError) return result(404, { error: msg, code: 'INVALID_TARGET' });
    if (error instanceof InviteUserService.UserInactiveError) return result(409, { error: msg, code: 'ACCOUNT_INACTIVE' });
    if (normalizedMessage.includes('já existe') || normalizedMessage.includes('cadastrado') || normalizedMessage.includes('vinculado')) {
      return result(409, { error: msg }, { rejected: true });
    }
    if (normalizedMessage.includes('admin')) return result(403, { error: msg });
    throw error;
  }
}
