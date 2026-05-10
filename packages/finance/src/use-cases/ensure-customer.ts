import { loadAsaasCredentials, prisma } from '@alusa/database';
import type { Result } from '@alusa/shared';
import { err, ok } from '@alusa/shared';
import type { CustomerPayerType, Prisma } from '@prisma/client';
import { AsaasHttpError, getCustomer } from '@alusa/asaas';

import { createAsaasCustomer, syncAsaasCustomerContact } from './create-customer';
import { syncCustomerNotificationChannels } from '../services/customer-notification.service';

export type EnsureCustomerPayerRef =
  | { type: 'RESPONSAVEL'; id: string }
  | { type: 'ALUNO'; id: string };

export type EnsureCustomerInput = {
  contaId: string;
  payer: EnsureCustomerPayerRef;
};

export type EnsureCustomerOutput = {
  customerId: string;
  localCustomerId: string;
  externalReference: string;
};

export type EnsureCustomerError =
  | 'PAGADOR_NAO_ENCONTRADO'
  | 'PAGADOR_SEM_CPF'
  | 'ASAAS_CUSTOMER_INVALIDO'
  | 'CREDENCIAIS_ASAAS_NAO_CONFIGURADAS'
  | 'ASAAS_CUSTOMER_EM_USO_POR_OUTRO_PAGADOR'
  | 'ERRO_AO_CRIAR_CUSTOMER';

function buildCustomerExternalReference(params: {
  contaId: string;
  payerType: CustomerPayerType;
  payerId: string;
}): string {
  return `customer:${params.contaId}:${params.payerType}:${params.payerId}`;
}

async function resolveActiveAsaasCustomer(params: {
  apiKey: string;
  customerId: string;
}): Promise<{ id: string } | null> {
  try {
    const customer = await getCustomer({ apiKey: params.apiKey, customerId: params.customerId });
    if (customer.deleted) return null;
    return { id: customer.id };
  } catch (error) {
    if (error instanceof AsaasHttpError && error.status === 404) return null;
    throw error;
  }
}

async function syncExistingAsaasCustomerContact(input: {
  contaId: string;
  customerId: string;
  externalReference: string;
  payerData: {
    nome: string;
    cpf: string | null;
    email: string | null;
    telefone: string | null;
  };
}): Promise<void> {
  if (!input.payerData.cpf) return;

  const result = await syncAsaasCustomerContact({
    contaId: input.contaId,
    customerId: input.customerId,
    name: input.payerData.nome,
    cpfCnpj: input.payerData.cpf,
    email: input.payerData.email ?? undefined,
    phone: input.payerData.telefone ?? undefined,
    externalReference: input.externalReference,
  });

  if (!result.success) {
    console.warn('[ensureCustomer] Aviso ao atualizar dados do customer:', {
      customerId: input.customerId,
      error: result.error,
    });
  }
}

function isMockPaymentsMode() {
  return (
    process.env.PAYMENTS_PROVIDER_MODE === 'mock' ||
    process.env.PLAYWRIGHT_TEST === 'true' ||
    process.env.NODE_ENV === 'test'
  );
}

/**
 * Atualiza o Customer local com o asaasCustomerId, tratando conflitos de constraint única
 * apenas dentro do mesmo tenant. Se o asaasCustomerId já existir em outro Customer órfão
 * do mesmo tenant (payerId inexistente), limpa o Customer órfão antes de atualizar.
 */
async function updateCustomerAsaasId(params: {
  contaId: string;
  payerType: CustomerPayerType;
  payerId: string;
  asaasCustomerId: string;
}): Promise<boolean> {
  const { contaId, payerType, payerId, asaasCustomerId } = params;

  try {
    await prisma.customer.update({
      where: {
        contaId_payerType_payerId: { contaId, payerType, payerId },
      },
      data: { asaasCustomerId },
    });
    return true;
  } catch (error) {
    // Trata violação de constraint única em asaasCustomerId
    if ((error as Prisma.PrismaClientKnownRequestError)?.code === 'P2002') {
      // Verifica se existe um Customer órfão com esse asaasCustomerId no mesmo tenant.
      const existingCustomer = await prisma.customer.findFirst({
        where: { contaId, asaasCustomerId },
        select: { id: true, payerType: true, payerId: true },
      });

      if (existingCustomer) {
        // Verifica se o payer do Customer existente ainda existe
        const payerExists =
          existingCustomer.payerType === 'ALUNO'
            ? await prisma.aluno.findUnique({
                where: { id: existingCustomer.payerId },
                select: { id: true },
              })
            : await prisma.responsavel.findUnique({
                where: { id: existingCustomer.payerId },
                select: { id: true },
              });

        if (!payerExists) {
          // Customer órfão encontrado - remove e tenta novamente
          console.warn('[ensureCustomer] Removendo Customer órfão:', {
            orphanCustomerId: existingCustomer.id,
            asaasCustomerId,
            newPayerId: payerId,
          });

          await prisma.customer.delete({ where: { id: existingCustomer.id } });

          // Tenta novamente o update
          await prisma.customer.update({
            where: {
              contaId_payerType_payerId: { contaId, payerType, payerId },
            },
            data: { asaasCustomerId },
          });
          return true;
        }
      }

      // Se não é um Customer órfão, loga e propaga o erro
      console.error('[ensureCustomer] Conflito de asaasCustomerId não resolvido:', {
        asaasCustomerId,
        payerType,
        payerId,
        existingCustomer,
      });
      return false;
    }
    throw error;
  }
}

export async function ensureCustomer(
  input: EnsureCustomerInput,
): Promise<Result<EnsureCustomerOutput, EnsureCustomerError>> {
  const payerType: CustomerPayerType = input.payer.type;

  const externalReference = buildCustomerExternalReference({
    contaId: input.contaId,
    payerType,
    payerId: input.payer.id,
  });

  const internalCustomer = await prisma.customer.upsert({
    where: {
      contaId_payerType_payerId: {
        contaId: input.contaId,
        payerType,
        payerId: input.payer.id,
      },
    },
    update: { externalReference },
    create: {
      contaId: input.contaId,
      payerType,
      payerId: input.payer.id,
      externalReference,
    },
    select: { id: true, asaasCustomerId: true, externalReference: true },
  });

  // Buscar dados do pagador conforme o tipo
  let payerData: {
    id: string;
    nome: string;
    cpf: string | null;
    email: string | null;
    telefone: string | null;
    asaasCustomerId: string | null;
  } | null = null;

  if (payerType === 'ALUNO') {
    const aluno = await prisma.aluno.findFirst({
      where: { id: input.payer.id, contaId: input.contaId },
      select: {
        id: true,
        nome: true,
        cpf: true,
        email: true,
        telefone: true,
        asaasCustomerId: true,
      },
    });
    if (aluno) {
      payerData = aluno;
    }
  } else {
    const responsavel = await prisma.responsavel.findFirst({
      where: { id: input.payer.id, contaId: input.contaId },
      select: {
        id: true,
        nome: true,
        cpf: true,
        email: true,
        telefone: true,
        asaasCustomerId: true,
      },
    });
    if (responsavel) {
      payerData = responsavel;
    }
  }

  if (!payerData) return err('PAGADOR_NAO_ENCONTRADO');

  if (!payerData.cpf) return err('PAGADOR_SEM_CPF');

  if (isMockPaymentsMode()) {
    const existingMockId = internalCustomer.asaasCustomerId ?? payerData.asaasCustomerId;
    const mockId = existingMockId ?? `mock_${payerType.toLowerCase()}_${payerData.id}`;

    if (!existingMockId) {
      if (payerType === 'ALUNO') {
        await prisma.aluno.update({
          where: { id: payerData.id },
          data: { asaasCustomerId: mockId },
        });
      } else {
        await prisma.responsavel.update({
          where: { id: payerData.id },
          data: { asaasCustomerId: mockId },
        });
      }

      const linked = await updateCustomerAsaasId({
        contaId: input.contaId,
        payerType,
        payerId: payerData.id,
        asaasCustomerId: mockId,
      });
      if (!linked) return err('ASAAS_CUSTOMER_EM_USO_POR_OUTRO_PAGADOR');
    }

    return ok({ customerId: mockId, localCustomerId: internalCustomer.id, externalReference });
  }

  const creds = await loadAsaasCredentials(input.contaId);
  if (!creds) return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');

  if (internalCustomer.asaasCustomerId) {
    try {
      const active = await resolveActiveAsaasCustomer({
        apiKey: creds.apiKey,
        customerId: internalCustomer.asaasCustomerId,
      });

      if (active) {
        await syncExistingAsaasCustomerContact({
          contaId: input.contaId,
          customerId: internalCustomer.asaasCustomerId,
          externalReference: internalCustomer.externalReference,
          payerData,
        });
        await syncCustomerNotificationChannelsFromTenant(
          input.contaId,
          internalCustomer.asaasCustomerId,
        );

        return ok({
          customerId: internalCustomer.asaasCustomerId,
          localCustomerId: internalCustomer.id,
          externalReference: internalCustomer.externalReference,
        });
      }
    } catch {
      return err('ASAAS_CUSTOMER_INVALIDO');
    }

    await prisma.customer.update({
      where: { id: internalCustomer.id },
      data: { asaasCustomerId: null },
    });
  }

  // Verificar se já existe customer no Asaas (via entidade original)
  if (payerData.asaasCustomerId) {
    try {
      const active = await resolveActiveAsaasCustomer({
        apiKey: creds.apiKey,
        customerId: payerData.asaasCustomerId,
      });

      if (active) {
        const linked = await updateCustomerAsaasId({
          contaId: input.contaId,
          payerType,
          payerId: payerData.id,
          asaasCustomerId: payerData.asaasCustomerId,
        });
        if (!linked) return err('ASAAS_CUSTOMER_EM_USO_POR_OUTRO_PAGADOR');

        await syncExistingAsaasCustomerContact({
          contaId: input.contaId,
          customerId: payerData.asaasCustomerId,
          externalReference,
          payerData,
        });
        await syncCustomerNotificationChannelsFromTenant(input.contaId, payerData.asaasCustomerId);

        return ok({
          customerId: payerData.asaasCustomerId,
          localCustomerId: internalCustomer.id,
          externalReference,
        });
      }
    } catch {
      return err('ASAAS_CUSTOMER_INVALIDO');
    }

    // Customer deletado no Asaas, limpar referência local
    if (payerType === 'ALUNO') {
      await prisma.aluno.update({ where: { id: payerData.id }, data: { asaasCustomerId: null } });
    } else {
      await prisma.responsavel.update({
        where: { id: payerData.id },
        data: { asaasCustomerId: null },
      });
    }
    await prisma.customer.update({
      where: { id: internalCustomer.id },
      data: { asaasCustomerId: null },
    });
  }

  const cpfCnpj = payerData.cpf;
  if (!cpfCnpj) return err('PAGADOR_SEM_CPF');

  const created = await createAsaasCustomer({
    contaId: input.contaId,
    name: payerData.nome,
    cpfCnpj,
    email: payerData.email ?? undefined,
    phone: payerData.telefone ?? undefined,
    externalReference,
  });

  if (!created.success) {
    if (created.error === 'Credenciais Asaas não configuradas')
      return err('CREDENCIAIS_ASAAS_NAO_CONFIGURADAS');
    return err('ERRO_AO_CRIAR_CUSTOMER');
  }

  if (!created.data.id) return err('ASAAS_CUSTOMER_INVALIDO');

  const linked = await updateCustomerAsaasId({
    contaId: input.contaId,
    payerType,
    payerId: payerData.id,
    asaasCustomerId: created.data.id,
  });
  if (!linked) return err('ASAAS_CUSTOMER_EM_USO_POR_OUTRO_PAGADOR');

  // Persistir asaasCustomerId na entidade original
  if (payerType === 'ALUNO') {
    await prisma.aluno.update({
      where: { id: payerData.id },
      data: { asaasCustomerId: created.data.id },
    });
  } else {
    await prisma.responsavel.update({
      where: { id: payerData.id },
      data: { asaasCustomerId: created.data.id },
    });
  }

  // FASE 6: Sincronizar preferências de notificação do tenant para o novo customer
  await syncCustomerNotificationChannelsFromTenant(input.contaId, created.data.id);

  return ok({
    customerId: created.data.id,
    localCustomerId: internalCustomer.id,
    externalReference,
  });
}

/**
 * Sincroniza preferências de notificação do tenant para um customer específico.
 * Best-effort: não bloqueia fluxo principal se falhar.
 */
async function syncCustomerNotificationChannelsFromTenant(
  contaId: string,
  asaasCustomerId: string,
): Promise<void> {
  try {
    // Buscar preferências do tenant
    const preferences = await prisma.asaasNotificationPreference.findMany({
      where: { contaId },
      select: {
        event: true,
        scheduleOffset: true,
        enabled: true,
        emailEnabledForProvider: true,
        smsEnabledForProvider: true,
        emailEnabledForCustomer: true,
        smsEnabledForCustomer: true,
        whatsappEnabledForCustomer: true,
        phoneCallEnabledForCustomer: true,
      },
    });

    if (preferences.length === 0) {
      // Sem preferências configuradas, usar defaults
      return;
    }

    // Agregar preferências (qualquer evento habilitado = canal habilitado)
    const channelPrefs = {
      email: preferences.some((p) => p.emailEnabledForCustomer),
      sms: preferences.some((p) => p.smsEnabledForCustomer),
      whatsapp: preferences.some((p) => p.whatsappEnabledForCustomer),
    };

    const result = await syncCustomerNotificationChannels(contaId, asaasCustomerId, channelPrefs, {
      eventPreferences: preferences,
    });

    if (result.warnings.length > 0) {
      console.warn('[ensureCustomer] Avisos ao sincronizar notificações:', {
        asaasCustomerId,
        warnings: result.warnings,
      });
    }
  } catch (error) {
    // Best-effort: log e continua
    console.error('[ensureCustomer] Erro ao sincronizar notificações (não crítico):', {
      contaId,
      asaasCustomerId,
      error: error instanceof Error ? error.message : error,
    });
  }
}
