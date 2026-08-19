import type { Prisma } from '@prisma/client';
import {
  EnrollmentContractModelNotFoundError,
  EnrollmentContractModelSignatureFieldsError,
  issueEnrollmentContract,
} from './issue-enrollment-contract.service';

export {
  EnrollmentContractModelNotFoundError,
  EnrollmentContractModelSignatureFieldsError,
};

export async function createPendingEnrollmentContract(
  tx: Prisma.TransactionClient,
  input: {
    contaId: string;
    matriculaId: string;
    modeloId: string;
    actorId: string;
  },
) {
  const result = await issueEnrollmentContract(tx, {
    ...input,
    source: 'ENROLLMENT',
    onExisting: 'return',
  });

  return {
    ...result.contrato,
    publicToken: result.publicToken,
    tokenExpiraEm: result.tokenExpiraEm,
  };
}
