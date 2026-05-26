import {
  AsaasHttpError,
  createCustomer,
  getCustomer,
  listCustomers,
  updateCustomer,
  restoreCustomer,
  type AsaasCustomer,
  type CreateCustomerInput,
} from '@alusa/asaas';

import { prisma } from '@alusa/database';
import type { Prisma } from '@prisma/client';
import { decryptSecret } from '@alusa/database';
import { isValidCpfCnpjDigits } from '@alusa/lib/cpf-cnpj';
import { syncCustomerNotificationChannelsFromTenantPreferences } from '../services/customer-notification-bridge';
import {
  AsaasCustomerEnsureError,
  type EnsureAsaasCustomerError,
} from '../errors/asaas-customer-ensure-error';

function digits(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).replace(/\D/g, '');
  return s.length > 0 ? s : undefined;
}

function nullifyEmpty<T extends string | null | undefined>(v: T): string | null | undefined {
  if (v == null || v === '') return null;
  return v;
}

export type EnsureAsaasCustomerPayer = {
  type: 'ALUNO' | 'RESPONSAVEL';
  id?: string;
  name: string;
  cpfCnpj: string;
  email?: string | null;
  phone?: string | null;
  mobilePhone?: string | null;
  address?: string | null;
  postalCode?: string | null;
  addressNumber?: string | null;
  complement?: string | null;
  province?: string | null;
  asaasCustomerId?: string | null;
};

export type EnsureAsaasCustomerResult =
  | {
      ok: true;
      customerId: string;
      externalReference: string;
      reused: boolean;
    }
  | {
      ok: false;
      error: EnsureAsaasCustomerError;
      message: string;
      status?: number;
    };

export { AsaasCustomerEnsureError, type EnsureAsaasCustomerError } from '../errors/asaas-customer-ensure-error';

type EnsureStep =
  | 'GET_LOCAL_CUSTOMER'
  | 'LIST_EXTERNAL_REFERENCE'
  | 'LIST_CPF'
  | 'UPDATE_EXISTING'
  | 'CREATE_CUSTOMER';

function normalizeString(value?: string | null): string | undefined {
  const normalized = nullifyEmpty(value ?? undefined);
  if (normalized === null || normalized === undefined) return undefined;
  const trimmed = String(normalized).trim();
  return trimmed.length ? trimmed : undefined;
}

function normalizeEmail(value?: string | null): string | undefined {
  const trimmed = normalizeString(value);
  return trimmed ? trimmed.toLowerCase() : undefined;
}

function maskCpfCnpj(value?: string | null): string {
  if (!value) return '***';
  const digitsOnly = digits(value) ?? '';
  if (digitsOnly.length <= 4) return '***';
  return `${digitsOnly.slice(0, 3)}***${digitsOnly.slice(-2)}`;
}

function compact<T extends Record<string, unknown>>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === 'string' && value.trim().length === 0) return false;
      return true;
    }),
  ) as Partial<T>;
}

function buildExternalReference(contaId: string, payer: EnsureAsaasCustomerPayer): string {
  if (!payer.id) {
    throw new AsaasCustomerEnsureError('PAYER_INVALID', 'Pagador sem identificador interno.');
  }
  const type = payer.type.toLowerCase();
  // Formato simples e estável, sem caracteres exóticos
  return `alusa_${contaId}_${type}_${payer.id}`;
}

/**
 * Monta endereço conforme recomendação Asaas:
 * - Se tiver postalCode + addressNumber, envia esses dois (Asaas completa via CEP)
 * - address, province, complement só se o usuário preencheu de verdade
 * - Nunca usa placeholders ("Endereco", "Bairro", "S/N")
 */
function buildCustomerAddress(payer: EnsureAsaasCustomerPayer): Partial<CreateCustomerInput> {
  const postalCode = digits(payer.postalCode);
  const addressNumber = normalizeString(payer.addressNumber);

  // Sem CEP válido, não manda endereço nenhum
  if (!postalCode || postalCode.length < 8) return {};

  // Sem número real, não manda endereço (evita placeholders)
  if (!addressNumber) return {};

  return compact({
    postalCode,
    addressNumber,
    address: normalizeString(payer.address),
    province: normalizeString(payer.province),
    complement: normalizeString(payer.complement),
  });
}

/**
 * Monta telefones conforme formato Asaas (somente dígitos):
 * - phone: 10 dígitos (fixo)
 * - mobilePhone: 11 dígitos (celular)
 */
function buildCustomerPhones(payer: EnsureAsaasCustomerPayer): { phone?: string; mobilePhone?: string } {
  const phoneDigits = digits(payer.phone);
  const mobileDigits = digits(payer.mobilePhone);

  let phone: string | undefined;
  let mobilePhone: string | undefined;

  // Fixo: 10 dígitos
  if (phoneDigits && phoneDigits.length === 10) {
    phone = phoneDigits;
  }

  // Celular: 11 dígitos
  if (mobileDigits && mobileDigits.length === 11) {
    mobilePhone = mobileDigits;
  }

  // Fallback: se phone tem 11 dígitos, é celular
  if (!mobilePhone && phoneDigits && phoneDigits.length === 11) {
    mobilePhone = phoneDigits;
  }

  // Fallback: se mobile tem 10 dígitos, é fixo
  if (!phone && mobileDigits && mobileDigits.length === 10) {
    phone = mobileDigits;
  }

  return compact({ phone, mobilePhone });
}

function extractAsaasErrorDescription(response: unknown): string | null {
  if (typeof response === 'string') {
    return response.trim() ? response : null;
  }
  if (!response || typeof response !== 'object') return null;
  const payload = response as { errors?: Array<{ description?: string }>; message?: string; error?: string };
  if (Array.isArray(payload.errors) && payload.errors[0]?.description) {
    return String(payload.errors[0].description);
  }
  if (typeof payload.message === 'string') return payload.message;
  if (typeof payload.error === 'string') return payload.error;
  return null;
}

function isPayerValidationError(description: string | null): boolean {
  if (!description) return false;
  return /(cpf|cnpj|nome|name|email|telefone|phone|mobile|address|postal|cep)/i.test(description);
}

export type LoadKeyResult =
  | {
      ok: true;
      apiKey: string;
      source: 'ASAAS_ACCOUNT' | 'ASAAS_CREDENTIAL';
      asaasAccountId?: string | null;
    }
  | {
      ok: false;
      code: EnsureAsaasCustomerError;
      message: string;
      asaasAccountId?: string | null;
    };

async function updateApiKeyStatus(
  asaasAccountId: string | null | undefined,
  status: 'CONNECTED' | 'REVOKED',
) {
  if (!asaasAccountId) return;
  await prisma.asaasAccount.update({
    where: { id: asaasAccountId },
    data: { apiKeyStatus: status },
  });
}

async function applyGlobalNotificationPreferencesSafe(contaId: string, customerId: string) {
  await syncCustomerNotificationChannelsFromTenantPreferences(contaId, customerId);
}

function deferGlobalNotificationPreferences(contaId: string, customerId: string) {
  void applyGlobalNotificationPreferencesSafe(contaId, customerId);
}

export async function loadAndValidateSubaccountKey(contaId: string): Promise<LoadKeyResult> {
  const profile = await prisma.financeProfile.findUnique({
    where: { contaId },
    select: {
      id: true,
      asaasCredential: { select: { apiKeyEncrypted: true } },
      asaasAccount: { select: { id: true, apiKeyStatus: true, apiKeyEncrypted: true } },
    },
  });

  const encrypted =
    profile?.asaasAccount?.apiKeyEncrypted ??
    profile?.asaasCredential?.apiKeyEncrypted ??
    null;

  if (!encrypted) {
    return {
      ok: false,
      code: 'MISSING_KEY',
      message: 'Chave da subconta não configurada.',
      asaasAccountId: profile?.asaasAccount?.id ?? null,
    };
  }

  let apiKey: string | null = null;
  try {
    apiKey = decryptSecret(encrypted);
  } catch {
    apiKey = null;
  }

  if (!apiKey) {
    return {
      ok: false,
      code: 'DECRYPT_FAILED',
      message: 'Falha ao descriptografar a chave da subconta.',
      asaasAccountId: profile?.asaasAccount?.id ?? null,
    };
  }

  const apiKeyStatus = profile?.asaasAccount?.apiKeyStatus ?? 'MISSING';

  if (apiKeyStatus !== 'CONNECTED') {
    try {
      await listCustomers({ apiKey, limit: 1 });
      await updateApiKeyStatus(profile?.asaasAccount?.id ?? null, 'CONNECTED');
    } catch (error) {
      if (error instanceof AsaasHttpError && (error.status === 401 || error.status === 403)) {
        await updateApiKeyStatus(profile?.asaasAccount?.id ?? null, 'REVOKED');
        return {
          ok: false,
          code: 'INVALID_KEY',
          message: 'Chave da subconta inválida ou sem permissão.',
          asaasAccountId: profile?.asaasAccount?.id ?? null,
        };
      }
      return {
        ok: false,
        code: 'TEMPORARY_ERROR',
        message: 'Não foi possível validar a chave agora.',
        asaasAccountId: profile?.asaasAccount?.id ?? null,
      };
    }
  }

  return {
    ok: true,
    apiKey,
    source: profile?.asaasAccount?.apiKeyEncrypted
      ? 'ASAAS_ACCOUNT'
      : 'ASAAS_CREDENTIAL',
    asaasAccountId: profile?.asaasAccount?.id ?? null,
  };
}

function pickExistingCustomer(list: AsaasCustomer[]): AsaasCustomer | null {
  if (!list.length) return null;
  const active = list.find((customer) => !customer.deleted);
  return active ?? list[0] ?? null;
}

async function persistCustomerId(
  payer: EnsureAsaasCustomerPayer,
  customerId: string,
  externalReference: string,
) {
  if (!payer.id) {
    throw new AsaasCustomerEnsureError('PAYER_INVALID', 'Pagador sem identificador interno.');
  }
  if (payer.type === 'ALUNO') {
    type AlunoUpdateWithExternalReference = Prisma.AlunoUpdateInput & {
      asaasCustomerExternalReference?: string | null;
    };
    const data: AlunoUpdateWithExternalReference = {
      asaasCustomerId: customerId,
      asaasCustomerExternalReference: externalReference,
    };
    await prisma.aluno.update({
      where: { id: payer.id },
      data,
    });
    return;
  }

  type ResponsavelUpdateWithExternalReference = Prisma.ResponsavelUpdateInput & {
    asaasCustomerExternalReference?: string | null;
  };
  const responsavelData: ResponsavelUpdateWithExternalReference = {
    asaasCustomerId: customerId,
    asaasCustomerExternalReference: externalReference,
  };
  await prisma.responsavel.update({
    where: { id: payer.id },
    data: responsavelData,
  });
}

export async function ensureAsaasCustomerForPayer(
  input: {
    contaId: string;
    payer: EnsureAsaasCustomerPayer;
    persist?: boolean;
    notificationSyncMode?: 'blocking' | 'deferred' | 'skip';
  },
): Promise<EnsureAsaasCustomerResult> {
  let step: EnsureStep = 'GET_LOCAL_CUSTOMER';
  const keyResult = await loadAndValidateSubaccountKey(input.contaId);
  if (!keyResult.ok) {
    return {
      ok: false,
      error: keyResult.code,
      message: keyResult.message,
    };
  }
  const apiKey = keyResult.apiKey;

  const cpfCnpj = digits(input.payer.cpfCnpj);
  const name = normalizeString(input.payer.name);

  if (!cpfCnpj || !name) {
    return {
      ok: false,
      error: 'PAYER_INVALID',
      message: 'Pagador sem CPF/CNPJ ou nome válido.',
    };
  }

  if (!isValidCpfCnpjDigits(cpfCnpj)) {
    return {
      ok: false,
      error: 'PAYER_INVALID',
      message: 'CPF/CNPJ inválido.',
    };
  }

  if (!input.payer.id) {
    return {
      ok: false,
      error: 'PAYER_INVALID',
      message: 'Pagador sem identificador interno.',
    };
  }

  const externalReference = buildExternalReference(input.contaId, input.payer);
  const notificationSyncMode = input.notificationSyncMode ?? 'blocking';

  // Montar payload completo conforme doc Asaas (não usar placeholders)
  const phones = buildCustomerPhones(input.payer);
  const address = buildCustomerAddress(input.payer);

  const payload: CreateCustomerInput = compact({
    name,
    cpfCnpj,
    email: normalizeEmail(input.payer.email),
    ...phones,
    ...address,
    externalReference,
    notificationDisabled: true,
  }) as CreateCustomerInput;

  try {
    const localCustomerId = normalizeString(input.payer.asaasCustomerId);

    if (localCustomerId) {
      step = 'GET_LOCAL_CUSTOMER';
      try {
        const localCustomer = await getCustomer({
          apiKey,
          customerId: localCustomerId,
        });

        if (localCustomer.id && !localCustomer.deleted) {
          if (input.persist !== false) {
            await persistCustomerId(input.payer, localCustomer.id, externalReference);
          }

          if (notificationSyncMode === 'blocking') {
            await applyGlobalNotificationPreferencesSafe(input.contaId, localCustomer.id);
          } else if (notificationSyncMode === 'deferred') {
            deferGlobalNotificationPreferences(input.contaId, localCustomer.id);
          }

          return {
            ok: true,
            customerId: localCustomer.id,
            externalReference,
            reused: true,
          };
        }
      } catch (error) {
        if (error instanceof AsaasHttpError && (error.status === 404 || error.status === 410)) {
          // Referência local inválida/deletada no provedor: segue para resolução por externalReference/CPF.
        } else {
          throw error;
        }
      }
    }

    // 1) Buscar por externalReference primeiro (mais específico)
    let existingCustomer: AsaasCustomer | null = null;

    try {
      step = 'LIST_EXTERNAL_REFERENCE';
      const byExternalReference = await listCustomers({
        apiKey,
        externalReference,
        limit: 1,
      });
      existingCustomer = pickExistingCustomer(byExternalReference.data ?? []);
    } catch (error) {
      // Se externalReference der 400, é inválido - retornar erro claro
      if (error instanceof AsaasHttpError && error.status === 400) {
        const description = extractAsaasErrorDescription(error.responseBody ?? error.response);
        console.error('[ensureAsaasCustomerForPayer] externalReference inválido', {
          contaId: input.contaId,
          payerType: input.payer.type,
          payerId: input.payer.id,
          externalReference,
          step,
          response: error.responseBody ?? error.response,
        });
        return {
          ok: false,
          error: 'PAYER_INVALID',
          message: description ?? 'externalReference inválido.',
          status: 400,
        };
      }
      throw error;
    }

    // 2) Se não achou por externalReference, buscar por CPF/CNPJ
    if (!existingCustomer) {
      step = 'LIST_CPF';
      const byCpfCnpj = await listCustomers({
        apiKey,
        cpfCnpj,
        limit: 5,
      });
      existingCustomer = pickExistingCustomer(byCpfCnpj.data ?? []);
    }

    // 3) Se encontrou, atualizar via PUT
    if (existingCustomer?.id) {
      step = 'UPDATE_EXISTING';

      if (existingCustomer.deleted) {
        try {
          await restoreCustomer({
            apiKey,
            customerId: existingCustomer.id,
          });
        } catch (restoreError) {
          if (restoreError instanceof AsaasHttpError) {
            const description = extractAsaasErrorDescription(
              restoreError.responseBody ?? restoreError.response,
            );
            return {
              ok: false,
              error: 'ASAAS_ERROR',
              message: description ?? 'Falha ao restaurar customer removido no Asaas.',
              status: restoreError.status,
            };
          }
          return {
            ok: false,
            error: 'ASAAS_ERROR',
            message: 'Falha ao restaurar customer removido no Asaas.',
          };
        }
      }

      try {
        await updateCustomer({
          apiKey,
          customerId: existingCustomer.id,
          data: payload,
        });
      } catch (updateError) {
        // Log warning mas não falhar (customer já existe)
        if (updateError instanceof AsaasHttpError && updateError.status === 400) {
          console.warn('[ensureAsaasCustomerForPayer] Atualização rejeitada pelo provedor', {
            contaId: input.contaId,
            payerType: input.payer.type,
            payerId: input.payer.id,
            cpfCnpj: maskCpfCnpj(cpfCnpj),
            step,
            message: updateError.message,
            response: updateError.responseBody ?? updateError.response,
          });
        } else {
          throw updateError;
        }
      }

      if (input.persist !== false) {
        await persistCustomerId(input.payer, existingCustomer.id, externalReference);
      }

      if (notificationSyncMode === 'blocking') {
        await applyGlobalNotificationPreferencesSafe(input.contaId, existingCustomer.id);
      } else if (notificationSyncMode === 'deferred') {
        deferGlobalNotificationPreferences(input.contaId, existingCustomer.id);
      }

      return {
        ok: true,
        customerId: existingCustomer.id,
        externalReference,
        reused: true,
      };
    }

    // 4) Se não existe, criar via POST único (sem minimal + update)
    step = 'CREATE_CUSTOMER';
    const created = await createCustomer({
      apiKey,
      data: payload,
    });

    if (!created?.id) {
      return {
        ok: false,
        error: 'ASAAS_ERROR',
        message: 'Customer não retornou ID válido.',
      };
    }

    if (input.persist !== false) {
      await persistCustomerId(input.payer, created.id, externalReference);
    }

    if (notificationSyncMode === 'blocking') {
      await applyGlobalNotificationPreferencesSafe(input.contaId, created.id);
    } else if (notificationSyncMode === 'deferred') {
      deferGlobalNotificationPreferences(input.contaId, created.id);
    }

    return {
      ok: true,
      customerId: created.id,
      externalReference,
      reused: false,
    };
  } catch (error) {
    if (error instanceof AsaasHttpError && (error.status === 401 || error.status === 403)) {
      await updateApiKeyStatus(keyResult.asaasAccountId ?? null, 'REVOKED');
      return {
        ok: false,
        error: 'INVALID_KEY',
        message: 'Chave da subconta inválida ou sem permissão.',
      };
    }

    if (error instanceof AsaasHttpError && error.status === 400) {
      const response = error.responseBody ?? error.response;
      const description = extractAsaasErrorDescription(response);
      const isEmptyBody = typeof response === 'object' && response && '_emptyBody' in response;

      console.error('[ensureAsaasCustomerForPayer] 400 ao criar/atualizar customer', {
        contaId: input.contaId,
        payerType: input.payer.type,
        payerId: input.payer.id,
        cpfCnpj: maskCpfCnpj(cpfCnpj),
        step,
        response,
        payloadKeys: Object.keys(payload),
      });

      // Body vazio = problema de infra, não validação de payer
      if (isEmptyBody) {
        return {
          ok: false,
          error: 'TEMPORARY_ERROR',
          message: 'Resposta inesperada do provedor de pagamentos.',
          status: error.status,
        };
      }

      if (isPayerValidationError(description)) {
        return {
          ok: false,
          error: 'PAYER_INVALID',
          message: description ?? 'Dados inválidos para criação do pagador.',
          status: error.status,
        };
      }

      return {
        ok: false,
        error: 'ASAAS_ERROR',
        message: description ?? 'Requisição rejeitada pelo Asaas (400). Ver logs.',
        status: error.status,
      };
    }

    console.error('[ensureAsaasCustomerForPayer] Falha ao sincronizar customer', {
      contaId: input.contaId,
      payerType: input.payer.type,
      payerId: input.payer.id,
      cpfCnpj: maskCpfCnpj(cpfCnpj),
      message: error instanceof Error ? error.message : String(error),
    });

    return {
      ok: false,
      error: 'TEMPORARY_ERROR',
      message: 'Não foi possível sincronizar o customer com o provedor.',
    };
  }
}
