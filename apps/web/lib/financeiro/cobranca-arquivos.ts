import {
  listCobrancaArquivosResultDTOSchema,
  uploadCobrancaArquivoResultDTOSchema,
} from '@/features/financeiro/cobrancas/dtos';
import { mapCobrancaArquivoToDTO } from '@/features/financeiro/cobrancas/mappers';
import type { TenantTransactionClient } from '@/lib/prisma-tenant';

export type CobrancaRef =
  | { kind: 'cobranca'; id: string }
  | { kind: 'charge'; id: string };

export async function resolveCobrancaRef(
  tx: TenantTransactionClient,
  contaId: string,
  id: string,
): Promise<CobrancaRef | null> {
  const cobranca = await tx.cobranca.findFirst({
    where: { id, contaId },
    select: { id: true },
  });
  if (cobranca) {
    return { kind: 'cobranca', id: cobranca.id };
  }

  const charge = await tx.charge.findFirst({
    where: { id, contaId },
    select: { id: true },
  });
  if (charge) {
    return { kind: 'charge', id: charge.id };
  }

  return null;
}

export async function listArquivosForCobranca(tx: TenantTransactionClient, ref: CobrancaRef) {
  const rows =
    ref.kind === 'cobranca'
      ? await tx.arquivoCobranca.findMany({
          where: { cobrancaId: ref.id },
          orderBy: { createdAt: 'desc' },
        })
      : await tx.arquivoCharge.findMany({
          where: { chargeId: ref.id },
          orderBy: { createdAt: 'desc' },
        });

  return listCobrancaArquivosResultDTOSchema.parse({
    arquivos: rows.map((row) => mapCobrancaArquivoToDTO(row as unknown as Record<string, unknown>)),
  });
}

export type CreateArquivoInput = {
  nomeOriginal: string;
  nomeArquivo: string;
  mimetype: string;
  tamanho: number;
  url: string;
  uploadPor: string;
};

export async function createArquivoForCobranca(
  tx: TenantTransactionClient,
  ref: CobrancaRef,
  data: CreateArquivoInput,
) {
  const row =
    ref.kind === 'cobranca'
      ? await tx.arquivoCobranca.create({
          data: {
            cobrancaId: ref.id,
            ...data,
          },
        })
      : await tx.arquivoCharge.create({
          data: {
            chargeId: ref.id,
            ...data,
          },
        });

  return uploadCobrancaArquivoResultDTOSchema.parse({
    arquivo: mapCobrancaArquivoToDTO(row as unknown as Record<string, unknown>),
  });
}

export async function findArquivoForCobranca(
  tx: TenantTransactionClient,
  contaId: string,
  cobrancaId: string,
  arquivoId: string,
) {
  const arquivoCobranca = await tx.arquivoCobranca.findFirst({
    where: {
      id: arquivoId,
      cobrancaId,
      cobranca: { contaId },
    },
  });
  if (arquivoCobranca) {
    return { kind: 'cobranca' as const, row: arquivoCobranca };
  }

  const arquivoCharge = await tx.arquivoCharge.findFirst({
    where: {
      id: arquivoId,
      chargeId: cobrancaId,
      charge: { contaId },
    },
  });
  if (arquivoCharge) {
    return { kind: 'charge' as const, row: arquivoCharge };
  }

  return null;
}

export async function deleteArquivoForCobranca(
  tx: TenantTransactionClient,
  arquivoId: string,
  kind: 'cobranca' | 'charge',
) {
  if (kind === 'cobranca') {
    await tx.arquivoCobranca.delete({ where: { id: arquivoId } });
    return;
  }
  await tx.arquivoCharge.delete({ where: { id: arquivoId } });
}
