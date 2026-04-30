import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { z } from 'zod';
import { authOptions } from '@/lib/auth-options';
import prisma from '@/lib/prisma';
import { removeManagedUserAccess } from '@/features/users/managed-user-access';

const updateManagedUserInputSchema = z.object({
  name: z.string().min(2, 'Nome muito curto').optional(),
  status: z.enum(['ATIVO', 'INATIVO']).optional(),
});

const updateManagedUserResultSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    role: z.string(),
    status: z.string(),
  }),
});

const deleteManagedUserResultSchema = z.object({
  ok: z.literal(true),
  id: z.string(),
  hard: z.boolean(),
});

function mapManagedUser(record: {
  id: string;
  nome: string;
  email: string;
  role: string;
  status: string;
}) {
  return {
    id: record.id,
    name: record.nome,
    email: record.email,
    role: record.role,
    status: record.status,
  };
}

async function requireAdminAndGetContaId() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return { error: 'Unauthorized', status: 401 } as const;
  const role = String((session.user as { role?: string }).role || '').toUpperCase();
  if (role !== 'ADMIN') return { error: 'Forbidden', status: 403 } as const;
  const userId = (session.user as { id?: string }).id;
  const sessionContaId = (session.user as { contaId?: string | null }).contaId ?? null;
  if (!userId) return { error: 'Unauthorized', status: 401 } as const;
  const me = await prisma.usuario.findUnique({ where: { id: userId }, select: { contaId: true, id: true } });
  const contaId = sessionContaId || me?.contaId;
  if (!contaId || !me) return { error: 'Conta não localizada', status: 400 } as const;
  return { contaId, currentUserId: me.id } as const;
}

async function findManagedUser(userId: string, contaId: string) {
  const membershipClient = (prisma as unknown as {
    usuarioConta?: {
      findUnique: (_args: unknown) => Promise<{
        role: string;
        status: string;
        usuario: { id: string; nome: string; email: string; status: string };
      } | null>;
    };
  }).usuarioConta;

  const membership = membershipClient?.findUnique
    ? await membershipClient.findUnique({
        where: { usuarioId_contaId: { usuarioId: userId, contaId } },
        select: {
          role: true,
          status: true,
          usuario: { select: { id: true, nome: true, email: true, status: true } },
        },
      })
    : null;

  if (membership) {
    return {
      id: membership.usuario.id,
      nome: membership.usuario.nome,
      email: membership.usuario.email,
      role: membership.role,
      status:
        membership.status === 'ATIVO' && membership.usuario.status === 'ATIVO'
          ? 'ATIVO'
          : 'INATIVO',
      viaMembership: true,
    };
  }

  const legacy = await prisma.usuario.findFirst({
    where: { id: userId, contaId },
    select: { id: true, nome: true, email: true, role: true, status: true },
  });

  return legacy ? { ...legacy, viaMembership: false } : null;
}

export async function PATCH(_req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdminAndGetContaId();
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const body = await _req.json().catch(() => ({}));
    const parsed = updateManagedUserInputSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const exists = await findManagedUser(params.id, auth.contaId);
    if (!exists) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

    if (
      params.id === auth.currentUserId &&
      typeof parsed.data.status !== 'undefined' &&
      parsed.data.status !== exists.status
    ) {
      return NextResponse.json({ error: 'Você não pode alterar o próprio status por esta tela.' }, { status: 400 });
    }

    // Bloquear mudanças de role/status do Owner
    const conta = await prisma.conta.findUnique({ where: { id: auth.contaId }, select: { ownerUserId: true } });
    if (conta && conta.ownerUserId === params.id) {
      // auditoria de tentativa
      console.warn(`[AUDIT] Tentativa de alterar role/status do Owner por ${auth.currentUserId}`);
      return NextResponse.json({ error: 'Alterações no usuário Owner não são permitidas.' }, { status: 403 });
    }

    const data: Record<string, unknown> = {};
    if (typeof parsed.data.name !== 'undefined') data.nome = parsed.data.name;
    if (typeof parsed.data.status !== 'undefined') data.status = parsed.data.status;
    if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nada para atualizar' }, { status: 400 });

    const membershipClient = (prisma as unknown as {
      usuarioConta?: {
        updateMany: (_args: unknown) => Promise<{ count: number }>;
      };
    }).usuarioConta;

    if (exists.viaMembership) {
      if (typeof parsed.data.name !== 'undefined') {
        await prisma.usuario.update({ where: { id: params.id }, data: { nome: parsed.data.name } });
      }
      if (typeof parsed.data.status !== 'undefined' && membershipClient?.updateMany) {
        const updateResult = await membershipClient.updateMany({
          where: { usuarioId: params.id, contaId: auth.contaId },
          data: { status: parsed.data.status },
        });
        if (updateResult.count === 0) {
          return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
        }
      }
    } else {
      // Multi-tenant legado: usar updateMany para garantir atomicidade com contaId
      const updateResult = await prisma.usuario.updateMany({
        where: { id: params.id, contaId: auth.contaId },
        data,
      });
      if (updateResult.count === 0) {
        return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
      }
    }
    const updated = await findManagedUser(params.id, auth.contaId);
    if (!updated) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

    await prisma.auditLog.create({
      data: {
        contaId: auth.contaId,
        actorType: 'USER',
        actorId: auth.currentUserId,
        action: 'USER_MANAGED_UPDATED',
        entityType: 'Usuario',
        entityId: updated.id,
        metadata: {
          previousName: exists.nome,
          nextName: updated.nome,
          previousStatus: exists.status,
          nextStatus: updated.status,
        },
      },
    });

    return NextResponse.json(
      updateManagedUserResultSchema.parse({
        user: mapManagedUser(updated),
      }),
    );
  } catch (e) {
    console.error('Error updating user:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    const auth = await requireAdminAndGetContaId();
    if ('error' in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    if (params.id === auth.currentUserId) {
      return NextResponse.json({ error: 'Você não pode remover o próprio acesso.' }, { status: 400 });
    }

    const exists = await findManagedUser(params.id, auth.contaId);
    if (!exists) return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });

    // Bloquear exclusão do Owner
    const conta = await prisma.conta.findUnique({ where: { id: auth.contaId }, select: { ownerUserId: true } });
    if (conta && conta.ownerUserId === params.id) {
      console.warn(`[AUDIT] Tentativa de excluir Owner por ${auth.currentUserId}`);
      return NextResponse.json({ error: 'Exclusão do usuário Owner não é permitida.' }, { status: 403 });
    }

    const body = await _req.json().catch(() => ({}));
    const reason =
      body && typeof body === 'object' && typeof (body as { reason?: unknown }).reason === 'string'
        ? (body as { reason: string }).reason
        : undefined;

    const removal = await removeManagedUserAccess({
      userId: params.id,
      contaId: auth.contaId,
      actorId: auth.currentUserId,
      reason,
    });

    if (!removal) {
      return NextResponse.json({ error: 'Usuário não encontrado' }, { status: 404 });
    }

    return NextResponse.json(
      deleteManagedUserResultSchema.parse({ ok: true, id: removal.id, hard: true }),
    );
  } catch (e) {
    console.error('Error deleting user:', e);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
