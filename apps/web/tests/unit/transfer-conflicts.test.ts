import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { isTransferOriginUniqueConflict } from '@/src/server/enrollments/transfer-conflicts';

function uniqueViolation(target: string | string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

describe('isTransferOriginUniqueConflict', () => {
  it('identifies only a duplicate formal transfer origin', () => {
    expect(isTransferOriginUniqueConflict(uniqueViolation(['contaId', 'origemVinculoId']))).toBe(true);
    expect(isTransferOriginUniqueConflict(uniqueViolation('uq_transferencia_academica_origem'))).toBe(true);
    expect(isTransferOriginUniqueConflict(uniqueViolation(['contaId', 'uiRequestId']))).toBe(false);
    expect(isTransferOriginUniqueConflict({ code: 'P2002', meta: { target: ['origemVinculoId'] } })).toBe(false);
  });
});
