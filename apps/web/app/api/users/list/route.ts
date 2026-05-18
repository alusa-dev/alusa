import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import type { Prisma } from '@prisma/client';
import { listUsersResultDTOSchema } from '@/features/users/dtos';
import { mapListUserRecordToDTO } from '@/features/users/mappers';
import { jsonNoStore } from '@/lib/http-security';
import { isRemovedUserEmail } from '@/features/users/managed-user-access';

export async function GET() {
  try {
    const session = await getServerSession(authOptions);
    const isTest =
      process.env.NODE_ENV === 'test' ||
      (process.env.NODE_ENV !== 'production' && process.env.TEST_ROUTES_ENABLED === 'true');
    const sessionUser = session?.user as { id?: string; role?: string; contaId?: string | null } | undefined;
    const sessionRole = String(sessionUser?.role ?? '').toUpperCase();

    let contaId: string | null = null;
    let userId: string | null = sessionUser?.id ?? null;

    if (sessionUser && sessionRole !== 'ADMIN') {
      return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
    }

    if (!userId && isTest) {
      // Fallback de teste: garante conta e admin
      const conta = await prisma.conta.upsert({
        where: { id: 'conta-default' },
        update: {},
        create: {
          id: 'conta-default',
          nome: 'Alusa Demo',
          cpfCnpj: '00000000000191',
          status: 'ATIVO',
        } as Prisma.ContaUncheckedCreateInput,
      });
      const owner = await prisma.usuario.upsert({
        where: { email: 'owner+users-list@example.com' },
        update: {},
        create: {
          id: 'owner-users-list',
          contaId: conta.id,
          nome: 'Owner Users List',
          email: 'owner+users-list@example.com',
          senhaHash: 'x',
          role: 'ADMIN',
          status: 'ATIVO',
        },
      });
      if (conta.ownerUserId !== owner.id) {
        await prisma.conta.update({ where: { id: conta.id }, data: { ownerUserId: owner.id } });
      }
      let admin = await prisma.usuario.findUnique({ where: { email: 'admin@example.com' } });
      if (!admin) {
        admin = await prisma.usuario.create({
          data: {
            contaId: conta.id,
            nome: 'Admin Test',
            email: 'admin@example.com',
            telefone: null,
            foto: null,
            senhaHash: 'test',
            role: 'ADMIN',
            status: 'ATIVO',
          },
        });
      }
      userId = admin.id;
    }

    if (!userId) {
      return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });
    }

    const user = await prisma.usuario.findUnique({
      where: { id: userId },
      select: { contaId: true },
    });
    contaId = sessionUser?.contaId ?? user?.contaId ?? null;
    if (!contaId) {
      return jsonNoStore({ error: 'Conta não localizada' }, { status: 400 });
    }

    const conta = await prisma.conta.findUnique({
      where: { id: contaId },
      select: { ownerUserId: true },
    });

    const membershipClient = (prisma as unknown as {
      usuarioConta?: {
        findMany: (_args: unknown) => Promise<
          Array<{
            usuarioId: string;
            role: string;
            status: string;
            createdAt: Date;
            usuario: { id: string; nome: string; email: string; status: string; createdAt: Date };
          }>
        >;
      };
    }).usuarioConta;

    const memberships = membershipClient?.findMany
      ? await membershipClient.findMany({
          where: { contaId },
          select: {
            usuarioId: true,
            role: true,
            status: true,
            createdAt: true,
            usuario: {
              select: { id: true, nome: true, email: true, status: true, createdAt: true },
            },
          },
          orderBy: { createdAt: 'desc' },
        })
      : [];
    const membershipUserIds = new Set(memberships.map((item) => item.usuarioId));

    // Buscar usuários legados da mesma conta que ainda não tenham vínculo backfilled.
    const usuariosLegados = await prisma.usuario.findMany({
      where: { contaId },
      select: { id: true, nome: true, email: true, role: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });

    const usuarios = [
      ...memberships.map((membership) => ({
        id: membership.usuario.id,
        nome: membership.usuario.nome,
        email: membership.usuario.email,
        role: membership.role,
        status:
          membership.status === 'ATIVO' && membership.usuario.status === 'ATIVO'
            ? 'ATIVO'
            : 'INATIVO',
        createdAt: membership.createdAt ?? membership.usuario.createdAt,
      })),
      ...usuariosLegados.filter((usuario) => !membershipUserIds.has(usuario.id)),
    ];

    const visibleUsuarios = usuarios.filter((usuario) => !isRemovedUserEmail(usuario.email));

    // Buscar convites ACEITOS desta conta (para identificar quem veio por link)
    const invites = await prisma.invite.findMany({
      where: { contaId, status: 'ACCEPTED', acceptedByUserId: { not: null } },
      select: { acceptedByUserId: true },
    });
    const acceptedUserIds = new Set(
      invites
        .map((invite) => invite.acceptedByUserId)
        .filter((acceptedByUserId): acceptedByUserId is string => Boolean(acceptedByUserId)),
    );

    const items = visibleUsuarios.map((u) => {
      const isCurrentUser = u.id === userId;
      const isOwner = conta?.ownerUserId === u.id;

      return {
      id: u.id,
      name: u.nome,
      email: u.email,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
        createdVia: acceptedUserIds.has(u.id) ? 'INVITE' : 'DIRECT',
        isCurrentUser,
        isOwner,
        permissions: {
          canEdit: !isOwner,
          canToggleStatus: !isOwner && !isCurrentUser,
          canDelete: !isOwner && !isCurrentUser,
        },
      };
    });

    return jsonNoStore(
      listUsersResultDTOSchema.parse({
        items: items.map((item) => mapListUserRecordToDTO(item)),
      }),
    );
  } catch (error) {
    console.error('Error listing users:', error);
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}
