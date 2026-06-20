import { prisma } from '@alusa/database';
import { loadAsaasCredentials } from '@alusa/database';

import {
  evaluatePayerAddressFiscalReadiness,
  payerAddressFromRecord,
} from '@alusa/lib';
import { syncResponsavelAsaasCustomer } from '../fiscal/payer-fiscal-readiness';

export type ReconcileResponsavelCustomerAddressesInput = {
  contaId?: string;
  limit?: number;
  maxAccounts?: number;
};

export type ReconcileResponsavelCustomerAddressesResult = {
  scanned: number;
  synced: number;
  skipped: number;
  failed: number;
  errors: Array<{ contaId: string; responsavelId: string; message: string }>;
};

function clampInt(value: number | undefined, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(value as number)));
}

export async function reconcileResponsavelCustomerAddresses(
  input: ReconcileResponsavelCustomerAddressesInput = {},
): Promise<ReconcileResponsavelCustomerAddressesResult> {
  const limit = clampInt(input.limit, 50, 1, 200);
  const maxAccounts = clampInt(input.maxAccounts, 20, 1, 100);

  const contaIds = input.contaId
    ? [input.contaId]
    : (
        await prisma.financeProfile.findMany({
          where: {
            asaasAccount: { apiKeyStatus: 'CONNECTED' },
          },
          select: { contaId: true },
          take: maxAccounts,
        })
      ).map((row) => row.contaId);

  const result: ReconcileResponsavelCustomerAddressesResult = {
    scanned: 0,
    synced: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  };

  for (const contaId of contaIds) {
    const creds = await loadAsaasCredentials(contaId);
    if (!creds) {
      continue;
    }

    const responsaveis = await prisma.responsavel.findMany({
      where: {
        contaId,
        financeiro: true,
        OR: [
          { enderecoCep: { not: null } },
          { enderecoNumero: { not: null } },
          { enderecoLogradouro: { not: null } },
        ],
      },
      select: {
        id: true,
        enderecoCep: true,
        enderecoLogradouro: true,
        enderecoNumero: true,
        enderecoComplemento: true,
        enderecoBairro: true,
        enderecoCidade: true,
        enderecoUf: true,
      },
      take: limit,
      orderBy: { id: 'desc' },
    });

    for (const responsavel of responsaveis) {
      result.scanned += 1;
      const readiness = evaluatePayerAddressFiscalReadiness(payerAddressFromRecord(responsavel));
      if (!readiness.ready) {
        result.skipped += 1;
        continue;
      }

      const synced = await syncResponsavelAsaasCustomer({
        contaId,
        responsavelId: responsavel.id,
        requireFiscalAddress: true,
        notificationSyncMode: 'skip',
      });

      if (!synced.ok) {
        result.failed += 1;
        result.errors.push({
          contaId,
          responsavelId: responsavel.id,
          message: synced.message,
        });
        continue;
      }

      result.synced += 1;
    }
  }

  return result;
}
