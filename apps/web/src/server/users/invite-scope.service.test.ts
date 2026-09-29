import { afterEach, describe, expect, it, vi } from 'vitest';
import prisma from '@/lib/prisma';
import { findStudentsInContaForInvite } from './invite-scope.service';

describe('findStudentsInContaForInvite', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('limits the invite validation query to the active school and requested students', async () => {
    const findMany = vi.spyOn(prisma.aluno, 'findMany').mockResolvedValue([{ id: 'student-1' }] as never);

    await expect(findStudentsInContaForInvite('school-a', ['student-1'])).resolves.toEqual([
      { id: 'student-1' },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { contaId: 'school-a', id: { in: ['student-1'] } },
      select: { id: true },
    });
  });
});
