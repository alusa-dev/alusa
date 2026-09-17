import { NextResponse } from 'next/server';
import { z } from 'zod';
import { revokeUserSessions } from '@/lib/auth-service';
import { removeManagedUserAccess } from '@/features/users/managed-user-access';
import {
  deleteManagedUserInputDTOSchema,
  updateManagedUserInputDTOSchema,
} from '@/features/users/dtos';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  findManagedUser,
  getManagedUserOwnerId,
  recordManagedUserAudit,
  updateManagedUser,
} from '@/src/server/users/user-management.service';

const updateManagedUserResultSchema = z.object({
  user: z.object({ id: z.string(), name: z.string(), email: z.string().email(), role: z.string(), status: z.string() }),
});
const deleteManagedUserResultSchema = z.object({ ok: z.literal(true), id: z.string(), hard: z.boolean() });

function jsonError(error: string, status: number) {
  return NextResponse.json({ error }, { status });
}

function mapManagedUser(record: { id: string; nome: string; email: string; role: string; status: string }) {
  return { id: record.id, name: record.nome, email: record.email, role: record.role, status: record.status };
}

async function requireAdmin() {
  const auth = await resolveTenantSession();
  if (!auth.ok) return { error: 'Unauthorized', status: 401 } as const;
  if (String(auth.role ?? '').toUpperCase() !== 'ADMIN') return { error: 'Forbidden', status: 403 } as const;
  return { contaId: auth.contaId, currentUserId: auth.userId } as const;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rawParams = await params;
  try {
    const auth = await requireAdmin();
    if ('error' in auth) return jsonError(auth.error ?? 'Unauthorized', auth.status ?? 403);
    const parsed = updateManagedUserInputDTOSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonError(JSON.stringify(parsed.error.flatten()), 400);

    const exists = await findManagedUser({ userId: rawParams.id, contaId: auth.contaId });
    if (!exists) return jsonError('Usuário não encontrado', 404);
    const shouldRevokeSessions = parsed.data.status === 'INATIVO' && exists.status !== 'INATIVO';
    if (rawParams.id === auth.currentUserId && typeof parsed.data.status !== 'undefined' && parsed.data.status !== exists.status) {
      return jsonError('Você não pode alterar o próprio status por esta tela.', 400);
    }
    if ((await getManagedUserOwnerId(auth.contaId)) === rawParams.id) {
      console.warn(`[AUDIT] Tentativa de alterar role/status do Owner por ${auth.currentUserId}`);
      return jsonError('Alterações no usuário Owner não são permitidas.', 403);
    }

    const data: Parameters<typeof updateManagedUser>[0]['data'] = {};
    if (typeof parsed.data.name !== 'undefined') data.nome = parsed.data.name;
    if (typeof parsed.data.status !== 'undefined') data.status = parsed.data.status;
    if (Object.keys(data).length === 0) return jsonError('Nada para atualizar', 400);
    const updated = await updateManagedUser({
      userId: rawParams.id,
      contaId: auth.contaId,
      viaMembership: exists.viaMembership,
      data,
      name: parsed.data.name,
      status: parsed.data.status,
    });
    if (!updated) return jsonError('Usuário não encontrado', 404);
    if (shouldRevokeSessions) await revokeUserSessions(rawParams.id);

    const current = await findManagedUser({ userId: rawParams.id, contaId: auth.contaId });
    if (!current) return jsonError('Usuário não encontrado', 404);
    await recordManagedUserAudit({
      contaId: auth.contaId,
      actorId: auth.currentUserId,
      userId: current.id,
      previousName: exists.nome,
      nextName: current.nome,
      previousStatus: exists.status,
      nextStatus: current.status,
    });
    return NextResponse.json(updateManagedUserResultSchema.parse({ user: mapManagedUser(current) }));
  } catch (error) {
    console.error('Error updating user:', error);
    return jsonError('Internal server error', 500);
  }
}

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const rawParams = await params;
  try {
    const auth = await requireAdmin();
    if ('error' in auth) return jsonError(auth.error ?? 'Unauthorized', auth.status ?? 403);
    if (rawParams.id === auth.currentUserId) return jsonError('Você não pode remover o próprio acesso.', 400);
    const exists = await findManagedUser({ userId: rawParams.id, contaId: auth.contaId });
    if (!exists) return jsonError('Usuário não encontrado', 404);
    if ((await getManagedUserOwnerId(auth.contaId)) === rawParams.id) {
      console.warn(`[AUDIT] Tentativa de excluir Owner por ${auth.currentUserId}`);
      return jsonError('Exclusão do usuário Owner não é permitida.', 403);
    }
    const parsed = deleteManagedUserInputDTOSchema.safeParse(await req.json().catch(() => ({})));
    if (!parsed.success) return jsonError(JSON.stringify(parsed.error.flatten()), 400);
    const removal = await removeManagedUserAccess({
      userId: rawParams.id,
      contaId: auth.contaId,
      actorId: auth.currentUserId,
      reason: parsed.data.reason,
    });
    if (!removal) return jsonError('Usuário não encontrado', 404);
    return NextResponse.json(deleteManagedUserResultSchema.parse({ ok: true, id: removal.id, hard: removal.hard }));
  } catch (error) {
    console.error('Error deleting user:', error);
    return jsonError('Internal server error', 500);
  }
}
