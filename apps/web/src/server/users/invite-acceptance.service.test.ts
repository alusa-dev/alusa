import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { findExistingUserForInvite, findUserMembershipForInvite } from './invite-acceptance.service';

describe('invite acceptance lookups', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('finds an existing account by case-insensitive email', async () => {
    const findFirst = vi.spyOn(prisma.usuario, 'findFirst').mockResolvedValue({
      id: 'user-1', status: 'ATIVO', contaId: 'school-a',
    } as never);

    await findExistingUserForInvite('person@example.com');

    expect(findFirst).toHaveBeenCalledWith({
      where: { email: { equals: 'person@example.com', mode: 'insensitive' } },
      select: { id: true, status: true, contaId: true },
    });
  });

  it('checks membership using the compound user and school key', async () => {
    const findUnique = vi.spyOn(prisma.usuarioConta, 'findUnique').mockResolvedValue({ status: 'ATIVO' } as never);

    await findUserMembershipForInvite('user-1', 'school-a');

    expect(findUnique).toHaveBeenCalledWith({
      where: { usuarioId_contaId: { usuarioId: 'user-1', contaId: 'school-a' } },
      select: { status: true },
    });
  });
});
