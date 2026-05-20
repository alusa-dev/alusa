import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { randomUUID } from 'crypto';
import {
  testCreateInviteInputDTOSchema,
  testCreateInviteResultDTOSchema,
} from '@/features/system/dtos';
import { mapTestCreateInviteResultToDTO } from '@/features/system/mappers';
import { isTestRouteEnabled } from '@/lib/security/runtime-guards';

export async function POST(req: Request) {
  try {
    if (!isTestRouteEnabled()) {
      return NextResponse.json({ error: 'Not Found' }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const parsed = testCreateInviteInputDTOSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: 'invalid' }, { status: 400 });
    const { email, role } = parsed.data;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);
    
    // Multi-tenant: sempre usar conta-default para testes e filtrar convites pela conta
    const contaId = 'conta-default';
    const existing = await prisma.invite.findFirst({ 
      where: { 
        email: email.toLowerCase(), 
        status: 'PENDING',
        contaId, // Filtrar por contaId
      } 
    });
    if (existing) {
      return NextResponse.json(
        testCreateInviteResultDTOSchema.parse(
          mapTestCreateInviteResultToDTO({
            token: existing.token,
            email: existing.email,
            role: existing.role,
          }),
        ),
      );
    }

    // criar conta e usuario admin básico se necessário
    // cria/garante um owner para cumprir o schema (ownerUserId obrigatório)
    const owner = await prisma.usuario.upsert({
      where: { email: 'owner+test-invite@example.com' },
      update: {},
      create: {
        id: 'owner-test-invite',
        contaId: 'conta-default',
        nome: 'Owner Test Invite',
        email: 'owner+test-invite@example.com',
        senhaHash: 'x',
        role: 'ADMIN',
        status: 'ATIVO',
      },
    });
    const conta = await prisma.conta.upsert({
      where: { id: 'conta-default' },
      update: { ownerUserId: owner.id },
      create: { id: 'conta-default', nome: 'Alusa Demo', cpfCnpj: '00000000000191', status: 'ATIVO', ownerUserId: owner.id },
    });
    const admin = await prisma.usuario.upsert({
      where: { email: 'admin@example.com' },
      update: {},
      create: {
        contaId: conta.id,
        nome: 'Admin Test',
        email: 'admin@example.com',
        senhaHash: 'test',
        role: 'ADMIN',
        status: 'ATIVO',
      },
    });

    const token = randomUUID();
    const invite = await prisma.invite.create({
      data: { email: email.toLowerCase(), role, token, invitedById: admin.id, status: 'PENDING', expiresAt },
    });
    return NextResponse.json(
      testCreateInviteResultDTOSchema.parse(
        mapTestCreateInviteResultToDTO({
          token: invite.token,
          email: invite.email,
          role: invite.role,
        }),
      ),
    );
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
