import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import bcrypt from 'bcryptjs';
import { InviteUserService } from '@alusa/lib';
import { ipFromRequest, rateLimit } from '@/lib/rate-limit';
import { hashPassword, passwordPolicyMessage } from '@/lib/auth-password';
import { sendEmailVerificationForUser } from '@/lib/auth-email-flow';
import {
  acceptInviteInputDTOSchema,
  acceptInviteResultDTOSchema,
  validateInviteQueryDTOSchema,
  validateInviteResultDTOSchema,
} from '@/features/users/dtos';

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

    const invite = await prisma.invite.findUnique({ where: { token } });
    if (!invite || invite.status !== 'PENDING') {
      return NextResponse.json({ error: 'Convite inválido' }, { status: 404 });
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
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
    const invite = await prisma.invite.findUnique({
      where: { token },
      select: { email: true, status: true, expiresAt: true },
    });
    if (!invite || invite.status !== 'PENDING') {
      return NextResponse.json({ error: 'Convite inválido' }, { status: 404 });
    }
    if (invite.expiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Convite expirado' }, { status: 410 });
    }

    const finalEmail = (invite.email ?? parsed.data.email)?.trim().toLowerCase();
    const existingUser = finalEmail
      ? await prisma.usuario.findFirst({
          where: { email: { equals: finalEmail, mode: 'insensitive' } },
          select: { id: true, senhaHash: true },
        })
      : null;

    if (existingUser) {
      const pepper = process.env.BCRYPT_PEPPER || '';
      let passwordMatches = await bcrypt.compare(finalPassword + pepper, existingUser.senhaHash);
      if (!passwordMatches && process.env.NODE_ENV !== 'production') {
        passwordMatches = await bcrypt.compare(finalPassword, existingUser.senhaHash);
      }
      if (!passwordMatches) {
        return NextResponse.json(
          { error: 'Este e-mail já possui acesso. Informe a senha atual para aceitar o convite.' },
          { status: 403 },
        );
      }
    }

    let senhaHash: string;

    try {
      senhaHash = existingUser ? existingUser.senhaHash : await hashPassword(finalPassword);
    } catch (error) {
      const message = error instanceof Error ? error.message : passwordPolicyMessage;
      return NextResponse.json({ error: message }, { status: 400 });
    }

    try {
      // Passa o email do usuário (se fornecido) para o acceptInvite
      const user = existingUser
        ? await InviteUserService.acceptInvite(token, finalName, senhaHash, parsed.data.email, {
            reuseExistingUserId: existingUser.id,
          })
        : await InviteUserService.acceptInvite(token, finalName, senhaHash, parsed.data.email);

      if (!user.emailVerifiedAt) {
        await sendEmailVerificationForUser(user.id, {
          ip,
          userAgent: req.headers.get('user-agent'),
        }, {
          callbackUrl: user.role === 'ADMIN' ? '/finance/wizard' : '/dashboard',
        });
      }

      return NextResponse.json(
        acceptInviteResultDTOSchema.parse({
          message: 'Convite aceito com sucesso',
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
      const msg = (e instanceof Error) ? e.message : '';
      if (msg.includes('expirado')) return NextResponse.json({ error: 'Convite expirado' }, { status: 410 });
      if (msg.includes('inválido')) return NextResponse.json({ error: 'Convite inválido' }, { status: 404 });
      if (msg.includes('Email é obrigatório')) return NextResponse.json({ error: msg }, { status: 400 });
      if (msg.includes('já cadastrado') || msg.includes('em uso') || msg.includes('vinculado')) return NextResponse.json({ error: msg }, { status: 409 });
      throw e;
    }
  } catch (error) {
    console.error('Error accepting invite:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
