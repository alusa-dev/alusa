import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { comparePassword, hashPassword, passwordPolicyMessage } from '@/lib/auth-password';
import { sendEmailVerificationForUser } from '@/lib/auth-email-flow';
import type { AcceptInviteInputDTO } from '@/features/users/dtos';
import {
  findExistingUserForInvite,
  findInviteForAcceptance,
  findPendingInviteForAcceptance,
} from './invite-acceptance.service';

export type InviteAcceptanceApplicationResult = {
  status: number;
  body: Record<string, unknown>;
  deliveryWarning?: boolean;
};

type AcceptanceContext = {
  input: AcceptInviteInputDTO;
  ip: string;
  userAgent: string | null;
  authenticatedUserId?: string;
  sessionEmail?: string | null;
};

function response(status: number, body: Record<string, unknown>): InviteAcceptanceApplicationResult {
  return { status, body };
}

async function verificationResult(input: {
  token: string;
  user: { id: string; email: string };
  role: string;
  message: string;
  ip: string;
  userAgent: string | null;
}): Promise<InviteAcceptanceApplicationResult> {
  let verificationEmailSent = true;
  try {
    await sendEmailVerificationForUser(input.user.id, { ip: input.ip, userAgent: input.userAgent }, {
      callbackUrl: `/auth/login?callbackUrl=${encodeURIComponent(`/auth/register?token=${encodeURIComponent(input.token)}`)}`,
    });
  } catch {
    verificationEmailSent = false;
  }
  return {
    status: 202,
    deliveryWarning: !verificationEmailSent,
    body: {
      message: verificationEmailSent ? input.message : 'Não foi possível enviar a confirmação. Tente novamente.',
      verificationRequired: true,
      verificationEmailSent,
      user: { id: input.user.id, email: input.user.email, role: input.role, contaId: null, emailVerified: false },
    },
  };
}

export async function acceptInviteApplication(context: AcceptanceContext): Promise<InviteAcceptanceApplicationResult> {
  const { input, ip, userAgent, authenticatedUserId } = context;
  const { token, password, name, senha, nome } = input;
  const finalPassword = senha || password;
  const finalName = nome || name;
  const invite = await findInviteForAcceptance(token);
  if (!invite || (invite.status !== 'PENDING' && invite.status !== 'ACCEPTED')) return response(404, { error: 'Convite inválido' });
  if (invite.status === 'PENDING' && invite.expiresAt.getTime() <= Date.now()) {
    await InviteUserService.expirePendingInvite(token);
    return response(410, { error: 'Convite expirado' });
  }
  if (invite.status === 'PENDING' && !(await findPendingInviteForAcceptance(token))) return response(404, { error: 'Convite inválido' });

  return completeInviteAcceptance({
    token, invite, finalPassword, finalName, inputEmail: input.email, finalEmail: context.authenticatedUserId ? context.sessionEmail ?? undefined : undefined,
    authenticatedUserId, ip, userAgent,
  });
}

type InviteForApplication = NonNullable<Awaited<ReturnType<typeof findInviteForAcceptance>>>;
async function completeInviteAcceptance(args: {
  token: string; invite: InviteForApplication; finalPassword?: string; finalName?: string;
  inputEmail?: string; finalEmail?: string; authenticatedUserId?: string; ip: string; userAgent: string | null;
}): Promise<InviteAcceptanceApplicationResult> {
  const { token, invite, finalPassword, finalName, inputEmail, authenticatedUserId, ip, userAgent } = args;
  try {
    const finalEmail = (args.finalEmail ?? inputEmail ?? invite.email)?.trim().toLowerCase();
    if (!finalEmail) return response(400, { error: 'Informe o e-mail que deseja usar na conta.' });
    if (invite.email && finalEmail !== invite.email.trim().toLowerCase()) return response(403, { error: 'Entre com o e-mail destinatário do convite.' });

    let identityUserId = authenticatedUserId;
    if (authenticatedUserId) {
      const sessionIdentity = await findExistingUserForInvite(finalEmail);
      if (!sessionIdentity || sessionIdentity.id !== authenticatedUserId) return response(403, { error: 'A sessão não corresponde ao e-mail desta identidade.' });
      if (String(sessionIdentity.status).toUpperCase() !== 'ATIVO') return response(409, { error: 'Esta conta está desativada.', code: 'ACCOUNT_INACTIVE' });
      if (!sessionIdentity.emailVerifiedAt) {
        return verificationResult({ token, user: sessionIdentity, role: invite.role, message: 'Confirme seu e-mail para concluir o convite.', ip, userAgent });
      }
    } else {
      if (!finalPassword) return response(400, { error: 'Informe sua senha para continuar.' });
      const existingUser = await findExistingUserForInvite(finalEmail);
      if (existingUser && String(existingUser.status).toUpperCase() !== 'ATIVO') {
        return response(409, { error: 'Esta conta está desativada. Solicite a um administrador a reativação antes de aceitar o convite.', code: 'ACCOUNT_INACTIVE' });
      }
      if (existingUser) {
        if (!(await comparePassword(finalPassword, existingUser.senhaHash))) return response(401, { error: 'E-mail ou senha inválidos.', code: 'INVALID_CREDENTIALS' });
        identityUserId = existingUser.id;
        if (!existingUser.emailVerifiedAt) {
          return verificationResult({ token, user: existingUser, role: invite.role, message: 'Confirme seu e-mail para concluir o convite.', ip, userAgent });
        }
      } else {
        if (!finalName) return response(400, { error: 'Nome é obrigatório para criar sua conta.' });
        let senhaHash: string;
        try { senhaHash = await hashPassword(finalPassword); }
        catch (error) { return response(400, { error: error instanceof Error ? error.message : passwordPolicyMessage }); }
        const user = await InviteUserService.prepareInviteIdentity(token, finalName, senhaHash, finalEmail);
        return verificationResult({ token, user, role: invite.role, message: 'Confirme seu e-mail para concluir o convite.', ip, userAgent });
      }
    }

    if (!identityUserId) return response(401, { error: 'Identidade não autenticada.' });
    if (!authenticatedUserId && !finalPassword) return response(400, { error: 'Informe sua senha para continuar.' });
    const user = await InviteUserService.acceptInvite(token, finalEmail, identityUserId);
    return response(200, {
      message: 'Convite aceito com sucesso', verificationEmailSent: true, verificationRequired: false,
      user: { id: user.id, email: user.email, role: user.role, contaId: user.contaId, emailVerified: Boolean(user.emailVerifiedAt) },
    });
  } catch (error: unknown) {
    if (error instanceof InviteUserService.ExpiredInviteError) return response(410, { error: 'Convite expirado' });
    if (error instanceof InviteUserService.InvalidInviteError) return response(404, { error: 'Convite inválido' });
    if (error instanceof InviteUserService.InvalidInviteTargetError) return response(404, { error: 'Cadastro do convite indisponível nesta escola.' });
    if (error instanceof InviteUserService.MissingInviteEmailError) return response(400, { error: error.message });
    if (error instanceof InviteUserService.InviteEmailNotVerifiedError) return response(409, { error: error.message, code: 'EMAIL_NOT_VERIFIED' });
    if (error instanceof InviteUserService.UserAlreadyLinkedError) return response(409, { error: 'Esta conta já está vinculada a esta escola. Fale com o administrador.', code: 'USER_ALREADY_LINKED' });
    if (error instanceof InviteUserService.StudentAlreadyLinkedError || error instanceof InviteUserService.GuardianProfileConflictError) {
      return response(409, { error: error.message, code: error instanceof InviteUserService.StudentAlreadyLinkedError ? 'STUDENT_ALREADY_LINKED' : 'GUARDIAN_PROFILE_CONFLICT' });
    }
    if (error instanceof InviteUserService.DuplicateInviteError || error instanceof InviteUserService.InviteStateConflictError) return response(409, { error: error.message, code: 'INVITE_CONFLICT' });
    if (error instanceof InviteUserService.ExistingAccountAuthenticationRequiredError) return response(409, { error: 'Entre na sua conta para aceitar este convite.', code: 'ACCOUNT_EXISTS' });
    if (error instanceof InviteUserService.MissingGuardianRecordError || error instanceof InviteUserService.InvalidGuardianStudentsError) return response(422, { error: error.message });
    if (error instanceof InviteUserService.UserInactiveError) return response(409, { error: error.message, code: 'ACCOUNT_INACTIVE' });
    throw error;
  }
}
