import { NextResponse } from 'next/server';
import * as InviteUserService from '@alusa/lib/server/services/invite-user-service';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { hashPassword, passwordPolicyMessage } from '@/lib/auth-password';
import { sendEmailVerificationForUser } from '@/lib/auth-email-flow';
import {
  acceptInviteInputDTOSchema,
  acceptInviteResultDTOSchema,
  validateInviteQueryDTOSchema,
  validateInviteResultDTOSchema,
} from '@/features/users/dtos';
import { findPendingInviteForAcceptance } from '@/src/server/users/invite-acceptance.service';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';

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
    console.error('Error validating invite:', error);
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
    const invite = await findPendingInviteForAcceptance(token);
    if (!invite || invite.status !== 'PENDING') {
      return NextResponse.json({ error: 'Convite inválido' }, { status: 404 });
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      await InviteUserService.expirePendingInvite(token);
      return NextResponse.json({ error: 'Convite expirado' }, { status: 410 });
    }

    try {
      const session = await getServerSession(authOptions);
      const authenticatedUserId = session?.user?.id || undefined;
      const finalEmail = (invite.email ?? session?.user?.email ?? parsed.data.email)?.trim().toLowerCase();
      const guardianProfile = invite.role === 'RESPONSAVEL' && parsed.data.cpf && parsed.data.telefone
        ? { cpf: parsed.data.cpf, telefone: parsed.data.telefone }
        : null;
      if (invite.role === 'RESPONSAVEL' && !guardianProfile) {
        return NextResponse.json({ error: 'Informe CPF e telefone para concluir o cadastro de responsável.' }, { status: 400 });
      }
      if (authenticatedUserId && invite.email && session?.user?.email?.trim().toLowerCase() !== invite.email.trim().toLowerCase()) {
        return NextResponse.json({ error: 'Entre com o e-mail destinatário do convite.' }, { status: 403 });
      }

      let senhaHash = '';
      if (!authenticatedUserId) {
        if (!finalEmail) {
          return NextResponse.json({ error: 'Informe o e-mail que deseja usar na conta.' }, { status: 400 });
        }
        if (finalEmail) {
          const existingUser = await prisma.usuario.findFirst({
            where: { email: { equals: finalEmail, mode: 'insensitive' } },
            select: { id: true, status: true, contaId: true },
          });
          if (existingUser && String(existingUser.status).toUpperCase() !== 'ATIVO') {
            return NextResponse.json({ error: 'Esta conta está desativada. Solicite a um administrador a reativação antes de aceitar o convite.', code: 'ACCOUNT_INACTIVE' }, { status: 409 });
          }
          if (existingUser && invite.contaId) {
            const membership = await prisma.usuarioConta.findUnique({
              where: { usuarioId_contaId: { usuarioId: existingUser.id, contaId: invite.contaId } },
              select: { status: true },
            });
            if (membership?.status === 'ATIVO' || existingUser.contaId === invite.contaId) {
              return NextResponse.json({
                error: 'Esta conta já está vinculada a esta escola. Fale com o administrador.',
                code: 'USER_ALREADY_LINKED',
              }, { status: 409 });
            }
          }
          if (existingUser) return NextResponse.json({ error: 'Entre na sua conta para aceitar este convite.', code: 'ACCOUNT_EXISTS' }, { status: 409 });
        }
        if (!finalPassword || !finalName) return NextResponse.json({ error: 'Nome e senha são obrigatórios para criar uma conta.' }, { status: 400 });
        try {
          senhaHash = await hashPassword(finalPassword);
        } catch (error) {
          const message = error instanceof Error ? error.message : passwordPolicyMessage;
          return NextResponse.json({ error: message }, { status: 400 });
        }
      }

      const user = await InviteUserService.acceptInvite(
        token,
        finalName ?? session?.user?.name ?? 'Usuário',
        senhaHash,
        finalEmail,
        authenticatedUserId,
        guardianProfile,
      );

      let verificationEmailSent = true;
      if (!authenticatedUserId && !user.emailVerifiedAt) {
        try {
          await sendEmailVerificationForUser(user.id, { ip, userAgent: req.headers.get('user-agent') }, { callbackUrl: '/dashboard' });
        } catch (error) {
          verificationEmailSent = false;
          console.error('[invite][verification-email-failed]', { userId: user.id, error });
        }
      }

      return NextResponse.json(
        acceptInviteResultDTOSchema.parse({
          message: verificationEmailSent ? 'Convite aceito com sucesso' : 'Acesso criado; não foi possível enviar o e-mail de verificação. Solicite um novo envio na tela de login.',
          verificationEmailSent,
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
      if (e instanceof InviteUserService.MissingInviteEmailError) return NextResponse.json({ error: e.message }, { status: 400 });
      if (e instanceof InviteUserService.MissingGuardianDataError) return NextResponse.json({ error: e.message }, { status: 400 });
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
    console.error('Error accepting invite:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
