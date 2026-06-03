import type { Prisma } from '@prisma/client';
import { hashCanonicalPayload } from '@alusa/domain';

type EvidenceWriter = {
  contractEvidence: {
    create: (_args: {
      data: {
        contaId: string;
        contratoId: string;
        type: string;
        actorType?: string | null;
        actorId?: string | null;
        ip?: string | null;
        userAgent?: string | null;
        payload: Prisma.InputJsonValue;
        payloadHash: string;
      };
    }) => Promise<unknown>;
  };
};

export function buildContractEvidencePayloadHash(payload: unknown): string {
  return hashCanonicalPayload(payload);
}

export async function createContractEvidence(
  db: EvidenceWriter,
  input: {
    contaId: string;
    contratoId: string;
    type: string;
    actorType?: string | null;
    actorId?: string | null;
    ip?: string | null;
    userAgent?: string | null;
    payload: Prisma.InputJsonValue;
  },
): Promise<{ payloadHash: string }> {
  const payloadHash = buildContractEvidencePayloadHash(input.payload);

  await db.contractEvidence.create({
    data: {
      contaId: input.contaId,
      contratoId: input.contratoId,
      type: input.type,
      actorType: input.actorType ?? null,
      actorId: input.actorId ?? null,
      ip: input.ip ?? null,
      userAgent: input.userAgent ?? null,
      payload: input.payload,
      payloadHash,
    },
  });

  return { payloadHash };
}
