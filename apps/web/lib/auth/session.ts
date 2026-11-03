import { prisma } from '@/prisma/client';
import { isTestRouteEnabled } from '@/lib/security/runtime-guards';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';

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

  return prisma.$transaction(async (tx) => {
    const usuario = await tx.usuario.upsert({
      where: { email: 'admin-e2e@example.com' },
      update: { contaId: conta.id, role: 'ADMIN', status: 'ATIVO' },
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
      select: { id: true },
    });
    await tx.conta.update({ where: { id: conta.id }, data: { ownerUserId: usuario.id } });
    const membership = await tx.usuarioConta.upsert({
      where: { usuarioId_contaId: { usuarioId: usuario.id, contaId: conta.id } },
      update: { role: 'ADMIN', status: 'ATIVO' },
      create: { usuarioId: usuario.id, contaId: conta.id, role: 'ADMIN', status: 'ATIVO' },
      select: { role: true },
    });
    return { id: usuario.id, role: membership.role, contaId: conta.id };
  });
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const auth = await resolveTenantSession();
  if (!auth.ok) {
    if (isTestRouteEnabled()) {
      return ensureTestSessionUser();
    }
    return null;
  }

  if (!auth.role) {
    return null;
  }

  return {
    id: auth.userId,
    role: auth.role as 'ADMIN' | 'RECEPCAO' | string,
    contaId: auth.contaId,
  };
}
