import { getServerSession } from 'next-auth';
import { authOptions } from '../auth-options';
import { prisma } from '@/prisma/client';

export type SessionUser = {
  id: string;
  role: 'ADMIN' | 'RECEPCAO' | string;
  contaId: string;
};

async function ensureTestSessionUser(): Promise<SessionUser> {
  const contaCpfCnpj = '00000000000000';

  const conta =
    (await prisma.conta.findFirst({
      where: { cpfCnpj: contaCpfCnpj },
      select: { id: true, ownerUserId: true },
    })) ||
    (await prisma.conta.create({
      data: {
        nome: 'Conta Test',
        cpfCnpj: contaCpfCnpj,
      },
      select: { id: true, ownerUserId: true },
    }));

  const usuario = await prisma.usuario.upsert({
    where: { email: 'admin-e2e@example.com' },
    update: {
      contaId: conta.id,
      role: 'ADMIN',
      status: 'ATIVO',
    },
    create: {
      contaId: conta.id,
      nome: 'Admin Test',
      email: 'admin-e2e@example.com',
      telefone: null,
      foto: null,
      bio: null,
      senhaHash: 'test',
      role: 'ADMIN',
      status: 'ATIVO',
      locale: 'pt-BR',
      theme: 'system',
    },
    select: { id: true, contaId: true, role: true },
  });

  if (conta.ownerUserId !== usuario.id) {
    await prisma.conta.update({ where: { id: conta.id }, data: { ownerUserId: usuario.id } });
  }

  await prisma.usuarioConta.upsert({
    where: { usuarioId_contaId: { usuarioId: usuario.id, contaId: conta.id } },
    update: { role: 'ADMIN', status: 'ATIVO' },
    create: {
      usuarioId: usuario.id,
      contaId: conta.id,
      role: 'ADMIN',
      status: 'ATIVO',
    },
  });

  return { id: usuario.id, role: usuario.role, contaId: usuario.contaId };
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = (await getServerSession(authOptions)) as unknown as { user?: { id?: string; role?: string; contaId?: string } };
  const user = session?.user;
  if (!user?.id || !user?.role) {
    if (process.env.NODE_ENV !== 'production' && process.env.TEST_ROUTES_ENABLED === 'true') {
      return ensureTestSessionUser();
    }
    return null;
  }

  if (!user.contaId) {
    return null;
  }

  return {
    id: String(user.id),
    role: user.role as 'ADMIN' | 'RECEPCAO' | string,
    contaId: String(user.contaId),
  };
}
