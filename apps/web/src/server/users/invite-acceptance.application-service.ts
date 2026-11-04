import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { comparePassword, hashPassword, passwordPolicyMessage } from '@/lib/auth-password';
import type { AuthContext } from '@/lib/auth-service';
import prisma from '@/lib/prisma';
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
  sessionAuthContext?: AuthContext | null;
};

function response(status: number, body: Record<string, unknown>): InviteAcceptanceApplicationResult {
  return { status, body };
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
    authenticatedUserId, sessionAuthContext: context.sessionAuthContext, ip, userAgent,
  });
}

type InviteForApplication = NonNullable<Awaited<ReturnType<typeof findInviteForAcceptance>>>;
async function completeInviteAcceptance(args: {
  token: string; invite: InviteForApplication; finalPassword?: string; finalName?: string;
  inputEmail?: string; finalEmail?: string; authenticatedUserId?: string; sessionAuthContext?: AuthContext | null; ip: string; userAgent: string | null;
}): Promise<InviteAcceptanceApplicationResult> {
  const { token, invite, finalPassword, finalName, inputEmail, authenticatedUserId } = args;
  const authContext: AuthContext = invite.role === 'RESPONSAVEL' ? 'PORTAL' : 'COLLABORATOR';
  try {
    const finalEmail = (args.finalEmail ?? inputEmail ?? invite.email)?.trim().toLowerCase();
    if (!finalEmail) return response(400, { error: 'Informe o e-mail que deseja usar na conta.' });
    if (invite.email && finalEmail !== invite.email.trim().toLowerCase()) return response(403, { error: 'Entre com o e-mail destinatário do convite.' });

    let identityUserId = authenticatedUserId;
    if (authenticatedUserId) {
      const sessionCredential = await prisma.authCredential.findUnique({
        where: { uq_auth_credential_context_email: { context: authContext, normalizedEmail: finalEmail } },
        select: { userId: true, emailVerifiedAt: true, user: { select: { id: true, email: true, status: true } } },
      });
      const sessionIdentity = sessionCredential?.user ?? await findExistingUserForInvite(finalEmail);
      if (!sessionIdentity || sessionIdentity.id !== authenticatedUserId) return response(403, { error: 'A sessão não corresponde ao e-mail desta identidade.' });
      if (String(sessionIdentity.status).toUpperCase() !== 'ATIVO') return response(409, { error: 'Esta conta está desativada.', code: 'ACCOUNT_INACTIVE' });
      if (!sessionCredential || args.sessionAuthContext !== authContext) return response(409, { error: 'Entre pelo contexto de acesso do convite.', code: 'AUTH_CONTEXT_REQUIRED' });
      if (!sessionCredential.emailVerifiedAt) {
        await prisma.authCredential.update({
          where: { uq_auth_credential_context_email: { context: authContext, normalizedEmail: finalEmail } },
          data: { emailVerifiedAt: new Date() },
        });
      }
    } else {
      if (!finalPassword) return response(400, { error: 'Informe sua senha para continuar.' });
      const realmCredential = await prisma.authCredential.findUnique({
        where: { uq_auth_credential_context_email: { context: authContext, normalizedEmail: finalEmail } },
        select: { passwordHash: true, user: { select: { id: true, email: true, status: true } }, emailVerifiedAt: true },
      });
      const existingUser = realmCredential?.user ?? await findExistingUserForInvite(finalEmail);
      if (existingUser && String(existingUser.status).toUpperCase() !== 'ATIVO') {
        return response(409, { error: 'Esta conta está desativada. Solicite a um administrador a reativação antes de aceitar o convite.', code: 'ACCOUNT_INACTIVE' });
      }
      if (existingUser) {
        if (realmCredential && !(await comparePassword(finalPassword, realmCredential.passwordHash))) return response(401, { error: 'E-mail ou senha inválidos.', code: 'INVALID_CREDENTIALS' });
        identityUserId = existingUser.id;
        if (!realmCredential) {
          const passwordHash = await hashPassword(finalPassword);
          try {
            await prisma.authCredential.create({ data: { context: authContext, normalizedEmail: finalEmail, userId: existingUser.id, passwordHash } });
          } catch (error) {
            const isUniqueConflict = typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
            if (!isUniqueConflict) throw error;
            const concurrentCredential = await prisma.authCredential.findUnique({
              where: { uq_auth_credential_context_email: { context: authContext, normalizedEmail: finalEmail } },
              select: { passwordHash: true, emailVerifiedAt: true },
            });
            // Concurrent acceptance may have created the same context credential.
            // Reuse it only if this request proves the same password; never replace it.
            if (!concurrentCredential || !(await comparePassword(finalPassword, concurrentCredential.passwordHash))) {
              return response(401, { error: 'E-mail ou senha inválidos.', code: 'INVALID_CREDENTIALS' });
            }
            if (!concurrentCredential.emailVerifiedAt) {
              await prisma.authCredential.update({
                where: { uq_auth_credential_context_email: { context: authContext, normalizedEmail: finalEmail } },
                data: { emailVerifiedAt: new Date() },
              });
            }
          }
        }
        const activeCredential = realmCredential ?? await prisma.authCredential.findUnique({ where: { uq_auth_credential_context_user: { context: authContext, userId: existingUser.id } }, select: { emailVerifiedAt: true } });
        if (!activeCredential?.emailVerifiedAt) {
          await prisma.authCredential.update({
            where: { uq_auth_credential_context_user: { context: authContext, userId: existingUser.id } },
            data: { emailVerifiedAt: new Date() },
          });
        }
      } else {
        if (!finalName) return response(400, { error: 'Nome é obrigatório para criar sua conta.' });
        let senhaHash: string;
        try { senhaHash = await hashPassword(finalPassword); }
        catch (error) { return response(400, { error: error instanceof Error ? error.message : passwordPolicyMessage }); }
        let user: Awaited<ReturnType<typeof InviteUserService.prepareInviteIdentity>>;
        try {
          user = await InviteUserService.prepareInviteIdentity(token, finalName, senhaHash, finalEmail);
        } catch (error) {
          if (!(error instanceof InviteUserService.InvalidInviteError)) throw error;
          // A concurrent request may have finished accepting this same token
          // after this request's initial read. The service's replay path checks
          // acceptedByUserId, verified context credential, and active membership.
          const concurrentIdentity = await findExistingUserForInvite(finalEmail);
          if (!concurrentIdentity) throw error;
          const accepted = await InviteUserService.acceptInvite(token, finalEmail, concurrentIdentity.id);
          return response(200, {
            message: 'Convite aceito com sucesso', verificationEmailSent: false, verificationRequired: false,
            user: { id: accepted.id, email: accepted.email, role: accepted.role, contaId: accepted.contaId, emailVerified: true },
          });
        }
        identityUserId = user.id;
        await prisma.authCredential.upsert({
          where: { uq_auth_credential_context_user: { context: authContext, userId: user.id } },
          create: { context: authContext, normalizedEmail: finalEmail, userId: user.id, passwordHash: senhaHash, emailVerifiedAt: new Date() },
          update: { emailVerifiedAt: new Date() },
        });
      }
    }

    if (!identityUserId) return response(401, { error: 'Identidade não autenticada.' });
    if (!authenticatedUserId && !finalPassword) return response(400, { error: 'Informe sua senha para continuar.' });
    const user = await InviteUserService.acceptInvite(token, finalEmail, identityUserId);
    return response(200, {
      message: 'Convite aceito com sucesso', verificationEmailSent: false, verificationRequired: false,
      // The invite token is bound to this address and is the verification
      // proof for the invite's independent authentication context.
      user: { id: user.id, email: user.email, role: user.role, contaId: user.contaId, emailVerified: true },
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
