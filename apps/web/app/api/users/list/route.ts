import { listUsersResultDTOSchema } from '@/features/users/dtos';
import { mapListUserRecordToDTO } from '@/features/users/mappers';
import { isRemovedUserEmail } from '@/features/users/managed-user-access';
import { jsonNoStore } from '@/lib/http-security';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import { listManagedUsers } from '@/src/server/users/user-management.service';

export async function GET() {
  try {
    const isTest = process.env.NODE_ENV === 'test' ||
      (process.env.NODE_ENV !== 'production' && process.env.TEST_ROUTES_ENABLED === 'true');
    const auth = await resolveTenantSession();
    const sessionUser = auth.ok
      ? { id: auth.userId, role: auth.role, contaId: auth.contaId }
      : null;
    if (sessionUser && String(sessionUser.role ?? '').toUpperCase() !== 'ADMIN') {
      return jsonNoStore({ error: 'Forbidden' }, { status: 403 });
    }
    if (!sessionUser && !isTest) return jsonNoStore({ error: 'Unauthorized' }, { status: 401 });

    const context = await listManagedUsers({
      sessionUserId: sessionUser?.id ?? null,
      sessionContaId: sessionUser?.contaId ?? null,
      isTest,
    });
    if (!context) return jsonNoStore({ error: 'Conta não localizada' }, { status: 400 });

    const users = [
      ...context.memberships.map((membership) => ({
        id: membership.usuario.id,
        nome: membership.usuario.nome,
        email: membership.usuario.email,
        role: membership.role,
        status: membership.status === 'ATIVO' && membership.usuario.status === 'ATIVO' ? 'ATIVO' : 'INATIVO',
        createdAt: membership.createdAt ?? membership.usuario.createdAt,
      })),
      ...context.legacyUsers,
    ].filter((user) => !isRemovedUserEmail(user.email));

    const items = users.map((user) => ({
      id: user.id,
      name: user.nome,
      email: user.email,
      role: user.role,
      status: user.status,
      createdAt: user.createdAt,
      createdVia: context.acceptedUserIds.has(user.id) ? 'INVITE' : 'DIRECT',
      isCurrentUser: user.id === context.currentUserId,
      isOwner: context.ownerUserId === user.id,
      permissions: {
        canEdit: context.ownerUserId !== user.id,
        canToggleStatus: context.ownerUserId !== user.id && user.id !== context.currentUserId,
        canDelete: context.ownerUserId !== user.id && user.id !== context.currentUserId,
      },
    }));

    return jsonNoStore(listUsersResultDTOSchema.parse({
      items: items.map((item) => mapListUserRecordToDTO(item)),
    }));
  } catch (error) {
    console.error('Error listing users:', error);
    return jsonNoStore({ error: 'Internal server error' }, { status: 500 });
  }
}
