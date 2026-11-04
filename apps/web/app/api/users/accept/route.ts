import { NextResponse } from 'next/server';
import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { comparePassword, hashPassword, passwordPolicyMessage } from '@/lib/auth-password';
import { sendEmailVerificationForUser } from '@/lib/auth-email-flow';
import {
  acceptInviteInputDTOSchema,
  acceptInviteResultDTOSchema,
  validateInviteQueryDTOSchema,
  validateInviteResultDTOSchema,
} from '@/features/users/dtos';
import {
  findExistingUserForInvite,
  findInviteForAcceptance,
  findPendingInviteForAcceptance,
} from '@/src/server/users/invite-acceptance.service';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import { getRequestId, logApiOperationalEvent } from '@/lib/observability/api-logger';

export async function GET(req: Request) {
  try {
    // Rate limit: 60 reqs / 15 min por IP (consulta de token)
    const ip = ipFromRequest(req);
    const rl = rateLimit(`accept-invite:validate:${ip}`, 60, 15 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
    const { searchParams } = new URL(req.url);
    const token = searchParams.get('token') || '';
    const parsed = validateInviteQueryDTOSchema.safeParse({ token });
    if (!parsed.success) {
      return NextResponse.json({ error: 'Token ausente' }, { status: 400 });
    }

    const invite = await findPendingInviteForAcceptance(token, {
      email: true,
      role: true,
      status: true,
      expiresAt: true,
    });
    if (!invite || invite.status !== 'PENDING') {
      return NextResponse.json({ error: 'Convite inválido' }, { status: 404 });
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      await InviteUserService.expirePendingInvite(token);
      return NextResponse.json({ error: 'Convite expirado' }, { status: 410 });
    }
    return NextResponse.json(
      validateInviteResultDTOSchema.parse({ email: invite.email, role: invite.role }),
    );
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/accept', method: 'GET', requestId: getRequestId(req), error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    // Rate limit: 20 reqs / 15 min por IP
    const ip = ipFromRequest(req);
    const rl = rateLimit(`accept-invite:${ip}`, 20, 15 * 60 * 1000);
    if (!rl.ok) return NextResponse.json({ error: 'Muitas tentativas. Tente novamente mais tarde.' }, { status: 429 });
    const body: unknown = await req.json();
    const parsed = acceptInviteInputDTOSchema.safeParse(body);
    
    if (!parsed.success) {
      return NextResponse.json(
        { error: 'Dados inválidos', details: parsed.error.errors },
        { status: 400 }
      );
    }

    // Compatibilidade: aceita 'password' ou 'senha', 'name' ou 'nome'
    const { token, password, name, senha, nome } = parsed.data;
    const finalPassword = senha || password;
    const finalName = nome || name;
    const invite = await findInviteForAcceptance(token);
    if (!invite || (invite.status !== 'PENDING' && invite.status !== 'ACCEPTED')) {
      return NextResponse.json({ error: 'Convite inválido' }, { status: 404 });
    }
    if (invite.status === 'PENDING' && invite.expiresAt.getTime() <= Date.now()) {
      await InviteUserService.expirePendingInvite(token);
      return NextResponse.json({ error: 'Convite expirado' }, { status: 410 });
    }
    if (invite.status === 'PENDING') {
      const validPendingInvite = await findPendingInviteForAcceptance(token);
      if (!validPendingInvite) return NextResponse.json({ error: 'Convite inválido' }, { status: 404 });
    }

    try {
      const session = await getServerSession(authOptions);
      const authenticatedUserId = session?.user?.id || undefined;
      const finalEmail = (session?.user?.email ?? parsed.data.email ?? invite.email)?.trim().toLowerCase();
      if (!finalEmail) {
        return NextResponse.json({ error: 'Informe o e-mail que deseja usar na conta.' }, { status: 400 });
      }
      if (invite.email && finalEmail !== invite.email.trim().toLowerCase()) {
        return NextResponse.json({ error: 'Entre com o e-mail destinatário do convite.' }, { status: 403 });
      }

      let identityUserId = authenticatedUserId;
      if (authenticatedUserId) {
        const sessionIdentity = await findExistingUserForInvite(finalEmail);
        if (!sessionIdentity || sessionIdentity.id !== authenticatedUserId) {
          return NextResponse.json({ error: 'A sessão não corresponde ao e-mail desta identidade.' }, { status: 403 });
        }
        if (String(sessionIdentity.status).toUpperCase() !== 'ATIVO') {
          return NextResponse.json({ error: 'Esta conta está desativada.', code: 'ACCOUNT_INACTIVE' }, { status: 409 });
        }
        if (!sessionIdentity.emailVerifiedAt) {
          let verificationEmailSent = true;
          try {
            await sendEmailVerificationForUser(sessionIdentity.id, { ip, userAgent: req.headers.get('user-agent') }, {
              callbackUrl: `/auth/login?callbackUrl=${encodeURIComponent(`/auth/register?token=${encodeURIComponent(token)}`)}`,
            });
          } catch (error) {
            verificationEmailSent = false;
            logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.invite.delivery.failed', route: '/api/users/accept', method: 'POST', requestId: getRequestId(req), error });
          }
          return NextResponse.json({
            message: verificationEmailSent ? 'Confirme seu e-mail para concluir o convite.' : 'Não foi possível enviar a confirmação. Tente novamente.',
            verificationRequired: true,
            verificationEmailSent,
            user: { id: sessionIdentity.id, email: sessionIdentity.email, role: invite.role, contaId: null, emailVerified: false },
          }, { status: 202 });
        }
      } else {
        if (!finalPassword) return NextResponse.json({ error: 'Informe sua senha para continuar.' }, { status: 400 });
        const existingUser = await findExistingUserForInvite(finalEmail);
        if (existingUser && String(existingUser.status).toUpperCase() !== 'ATIVO') {
          return NextResponse.json({ error: 'Esta conta está desativada. Solicite a um administrador a reativação antes de aceitar o convite.', code: 'ACCOUNT_INACTIVE' }, { status: 409 });
        }
        if (existingUser) {
          const passwordMatches = await comparePassword(finalPassword, existingUser.senhaHash);
          if (!passwordMatches) return NextResponse.json({ error: 'E-mail ou senha inválidos.', code: 'INVALID_CREDENTIALS' }, { status: 401 });
          identityUserId = existingUser.id;
          if (!existingUser.emailVerifiedAt) {
            let verificationEmailSent = true;
            try {
              await sendEmailVerificationForUser(existingUser.id, { ip, userAgent: req.headers.get('user-agent') }, {
                callbackUrl: `/auth/login?callbackUrl=${encodeURIComponent(`/auth/register?token=${encodeURIComponent(token)}`)}`,
              });
            } catch (error) {
              verificationEmailSent = false;
              logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.invite.delivery.failed', route: '/api/users/accept', method: 'POST', requestId: getRequestId(req), error });
            }
            return NextResponse.json({
              message: verificationEmailSent ? 'Confirme seu e-mail para concluir o convite.' : 'Não foi possível enviar a confirmação. Tente novamente para reenviar.',
              verificationRequired: true,
              verificationEmailSent,
              user: { id: existingUser.id, email: existingUser.email, role: invite.role, contaId: null, emailVerified: false },
            }, { status: 202 });
          }
        } else {
          if (!finalName) return NextResponse.json({ error: 'Nome é obrigatório para criar sua conta.' }, { status: 400 });
          let senhaHash: string;
          try {
            senhaHash = await hashPassword(finalPassword);
          } catch (error) {
            const message = error instanceof Error ? error.message : passwordPolicyMessage;
            return NextResponse.json({ error: message }, { status: 400 });
          }
          const user = await InviteUserService.prepareInviteIdentity(token, finalName, senhaHash, finalEmail);
          let verificationEmailSent = true;
          try {
            await sendEmailVerificationForUser(user.id, { ip, userAgent: req.headers.get('user-agent') }, {
              callbackUrl: `/auth/login?callbackUrl=${encodeURIComponent(`/auth/register?token=${encodeURIComponent(token)}`)}`,
            });
          } catch (error) {
            verificationEmailSent = false;
            logApiOperationalEvent({ severity: 'warn', eventName: 'api.users.invite.delivery.failed', route: '/api/users/accept', method: 'POST', requestId: getRequestId(req), error });
          }
          return NextResponse.json({
            message: verificationEmailSent ? 'Confirme seu e-mail para concluir o convite.' : 'Não foi possível enviar a confirmação. Tente novamente para reenviar.',
            verificationRequired: true,
            verificationEmailSent,
            user: { id: user.id, email: user.email, role: invite.role, contaId: null, emailVerified: false },
          }, { status: 202 });
        }
      }

      if (!identityUserId) return NextResponse.json({ error: 'Identidade não autenticada.' }, { status: 401 });
      if (!authenticatedUserId && !finalPassword) {
        return NextResponse.json({ error: 'Informe sua senha para continuar.' }, { status: 400 });
      }
      const user = await InviteUserService.acceptInvite(token, finalEmail, identityUserId);

      return NextResponse.json(
        acceptInviteResultDTOSchema.parse({
          message: 'Convite aceito com sucesso',
          verificationEmailSent: true,
          verificationRequired: false,
          user: {
            id: user.id,
            email: user.email,
            role: user.role,
            contaId: user.contaId,
            emailVerified: Boolean(user.emailVerifiedAt),
          },
        }),
        { status: 200 },
      );
    } catch (e: unknown) {
      if (e instanceof InviteUserService.ExpiredInviteError) return NextResponse.json({ error: 'Convite expirado' }, { status: 410 });
      if (e instanceof InviteUserService.InvalidInviteError) return NextResponse.json({ error: 'Convite inválido' }, { status: 404 });
      if (e instanceof InviteUserService.InvalidInviteTargetError) return NextResponse.json({ error: 'Cadastro do convite indisponível nesta escola.' }, { status: 404 });
      if (e instanceof InviteUserService.MissingInviteEmailError) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof InviteUserService.InviteEmailNotVerifiedError) return NextResponse.json({ error: e.message, code: 'EMAIL_NOT_VERIFIED' }, { status: 409 });
      if (e instanceof InviteUserService.UserAlreadyLinkedError) {
        return NextResponse.json({
          error: 'Esta conta já está vinculada a esta escola. Fale com o administrador.',
          code: 'USER_ALREADY_LINKED',
        }, { status: 409 });
      }
      if (e instanceof InviteUserService.StudentAlreadyLinkedError || e instanceof InviteUserService.GuardianProfileConflictError) {
        return NextResponse.json({ error: e.message, code: e instanceof InviteUserService.StudentAlreadyLinkedError ? 'STUDENT_ALREADY_LINKED' : 'GUARDIAN_PROFILE_CONFLICT' }, { status: 409 });
      }
      if (e instanceof InviteUserService.DuplicateInviteError || e instanceof InviteUserService.InviteStateConflictError) return NextResponse.json({ error: e.message, code: 'INVITE_CONFLICT' }, { status: 409 });
      if (e instanceof InviteUserService.ExistingAccountAuthenticationRequiredError) return NextResponse.json({ error: 'Entre na sua conta para aceitar este convite.', code: 'ACCOUNT_EXISTS' }, { status: 409 });
      if (e instanceof InviteUserService.MissingGuardianRecordError || e instanceof InviteUserService.InvalidGuardianStudentsError) return NextResponse.json({ error: e.message }, { status: 422 });
      if (e instanceof InviteUserService.UserInactiveError) return NextResponse.json({ error: e.message, code: 'ACCOUNT_INACTIVE' }, { status: 409 });
      throw e;
    }
  } catch (error) {
    logApiOperationalEvent({ severity: 'error', eventName: 'api.users.request.failed', route: '/api/users/accept', method: 'POST', requestId: getRequestId(req), error });
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
