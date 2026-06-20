import { ExternalAsaasOnboardingStatus, FinanceIntegrationMode, Role, type Usuario } from '@prisma/client';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { asaasGetMyAccount, asaasListSubaccounts } from '@alusa/finance';
import { isValidCpfCnpjDigits, normalizeCpfCnpjDigits } from '@alusa/lib/cpf-cnpj';
import {
  isAtLeastAgeYears,
  isValidDateOnly,
  parseDateOnlyToUtcDate,
} from '@alusa/lib/date-only';
import { hashPassword, passwordPolicyMessage, passwordPolicyRegex } from '@/lib/auth-password';
import prisma from '@/lib/prisma';
import type { LegalDocumentType } from '@/lib/privacy/legal-versions';

export interface FirstUserInput {
  escolaNome: string;

  cpfCnpj?: string;
  nome: string;
  email: string;
  financeIntegrationMode?: FinanceIntegrationMode;
  birthDate?: string;
  senha: string;
  legalAcceptance?: {
    accepted: true;
    locale?: string;
    source?: 'REGISTER' | 'ONBOARDING' | 'REACCEPTANCE';
    documents: Array<{
      documentType: LegalDocumentType;
      documentVersion: string;
    }>;
  };
  legalAcceptanceEvidence?: {
    ipHash?: string | null;
    userAgentHash?: string | null;
  };
}

export class EmailInUseError extends Error { constructor() { super('E-mail já está em uso.'); } }
export class InactiveAccountEmailError extends Error {
  constructor(
    public readonly userId: string,
    public readonly email: string,
  ) {
    super('Já existe uma conta desativada vinculada a este e-mail.');
  }
}
export class CpfCnpjInUseError extends Error { constructor() { super('Já existe uma escola registrada com este CPF/CNPJ.'); } }
export class PasswordPolicyError extends Error { constructor() { super(passwordPolicyMessage); } }

export type FirstUserRegistrationAvailability =
  | { available: true }
  | { available: false; reason: 'LOCAL_ACTIVE' }
  | { available: false; reason: 'LOCAL_DEACTIVATED'; userId: string; email: string }
  | { available: false; reason: 'ASAAS_EMAIL_IN_USE' }
  | { available: false; reason: 'ASAAS_UNAVAILABLE' };

function normalizeEmail(value: string | null | undefined): string {
  return String(value ?? '').trim().toLowerCase();
}

function parseEnvFileValue(filePath: string, key: string): string | null {
  if (!existsSync(filePath)) return null;

  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`^${escapedKey}=(.*)$`, 'm');
  const match = readFileSync(filePath, 'utf8').match(pattern);
  if (!match) return null;

  let value = match[1]?.trim() ?? '';
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }

  return value.replace(/^\\(?=\$aact_)/, '').trim() || null;
}

function getMasterApiKeyForFirstRegister(): string | null {
  const fromEnv = process.env.ASAAS_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  if (process.env.NODE_ENV !== 'development') return null;

  const cwd = process.cwd();
  const candidateFiles = [
    resolve(cwd, '.env.local'),
    resolve(cwd, '../../.env.local'),
  ];

  for (const filePath of candidateFiles) {
    const value = parseEnvFileValue(filePath, 'ASAAS_API_KEY');
    if (value) return value;
  }

  return null;
}

function isAccountDeactivated(status: string | null | undefined, deletedAt: Date | null | undefined): boolean {
  return Boolean(deletedAt) || (typeof status === 'string' && status.toUpperCase() !== 'ATIVO');
}

async function findUserByEmail(email: string) {
  return prisma.usuario.findFirst({
    where: { email: { equals: email, mode: 'insensitive' } },
    select: {
      id: true,
      email: true,
      conta: {
        select: {
          status: true,
          deletedAt: true,
        },
      },
    },
  });
}

export async function checkFirstUserRegistrationAvailability(input: {
  email: string;
  financeIntegrationMode?: FinanceIntegrationMode;
}): Promise<FirstUserRegistrationAvailability> {
  const financeIntegrationMode = input.financeIntegrationMode ?? FinanceIntegrationMode.WHITELABEL_BAAS;
  const normalizedEmail = input.email.trim();

  const existingEmail = await findUserByEmail(normalizedEmail);
  if (existingEmail) {
    if (isAccountDeactivated(existingEmail.conta?.status, existingEmail.conta?.deletedAt)) {
      return {
        available: false,
        reason: 'LOCAL_DEACTIVATED',
        userId: existingEmail.id,
        email: existingEmail.email,
      };
    }

    return { available: false, reason: 'LOCAL_ACTIVE' };
  }

  if (financeIntegrationMode === FinanceIntegrationMode.EXTERNAL_ASAAS_ACCOUNT) {
    return { available: true };
  }

  const masterApiKey = getMasterApiKeyForFirstRegister();
  if (!masterApiKey) {
    return { available: false, reason: 'ASAAS_UNAVAILABLE' };
  }

  try {
    const masterAccount = await asaasGetMyAccount({ apiKey: masterApiKey });
    if (normalizeEmail(masterAccount.email) === normalizeEmail(normalizedEmail)) {
      return { available: false, reason: 'ASAAS_EMAIL_IN_USE' };
    }

    const response = await asaasListSubaccounts({
      apiKey: masterApiKey,
      email: normalizedEmail,
      limit: 1,
      offset: 0,
    });

    if ((response.data?.length ?? 0) > 0) {
      return { available: false, reason: 'ASAAS_EMAIL_IN_USE' };
    }
  } catch (error) {
    console.error('[auth.first-register] Falha ao validar e-mail no Asaas', {
      message: error instanceof Error ? error.message : String(error),
    });
    return { available: false, reason: 'ASAAS_UNAVAILABLE' };
  }

  return { available: true };
}

export async function createFirstUser(data: FirstUserInput): Promise<Usuario> {
  const financeIntegrationMode = data.financeIntegrationMode ?? 'WHITELABEL_BAAS';
  const cpfCnpjDigits = data.cpfCnpj ? normalizeCpfCnpjDigits(data.cpfCnpj) : undefined;
  if (cpfCnpjDigits && !isValidCpfCnpjDigits(cpfCnpjDigits)) {
    throw new Error('CPF/CNPJ inválido.');
  }

  if (data.birthDate && (!isValidDateOnly(data.birthDate) || !isAtLeastAgeYears(data.birthDate, 18))) {
    throw new Error('birthDate inválido.');
  }
  const birthDate = data.birthDate ? parseDateOnlyToUtcDate(data.birthDate) : undefined;

  // Política de senha
  if (!passwordPolicyRegex.test(data.senha)) throw new PasswordPolicyError();
  // Unicidade email
  const existingEmail = await findUserByEmail(data.email);
  if (existingEmail) {
    if (isAccountDeactivated(existingEmail.conta?.status, existingEmail.conta?.deletedAt)) {
      throw new InactiveAccountEmailError(existingEmail.id, existingEmail.email);
    }
    throw new EmailInUseError();
  }
  // Unicidade CPF/CNPJ para Conta (apenas se fornecido)
  if (cpfCnpjDigits) {
    const existingConta = await prisma.conta.findFirst({ where: { cpfCnpj: cpfCnpjDigits } });
    if (existingConta) throw new CpfCnpjInUseError();
  }
  // Criar conta e usuário ADMIN e marcar como owner em uma transação
  const senhaHash = await hashPassword(data.senha);
  try {
    const result = await prisma.$transaction(async (tx) => {
      const conta = await tx.conta.create({
        data: {
          id: randomUUID(),
          nome: data.escolaNome,
          cpfCnpj: cpfCnpjDigits ?? null,
          financeIntegrationMode,
          externalAsaasOnboardingStatus:
            financeIntegrationMode === 'EXTERNAL_ASAAS_ACCOUNT'
              ? ExternalAsaasOnboardingStatus.PENDING_CONFIGURATION
              : ExternalAsaasOnboardingStatus.NOT_STARTED,
        },
        select: { id: true },
      });
      const user = await tx.usuario.create({
        data: {
          contaId: conta.id,
          nome: data.nome,
          email: data.email,
          birthDate,
          senhaHash,
          role: Role.ADMIN,
          status: 'ATIVO',
        },
      });
      await tx.usuarioConta.create({
        data: {
          usuarioId: user.id,
          contaId: conta.id,
          role: Role.ADMIN,
          status: 'ATIVO',
          lastAccessedAt: new Date(),
        },
      });
      await tx.conta.update({ where: { id: conta.id }, data: { ownerUserId: user.id } });

      if (data.legalAcceptance) {
        await tx.legalAcceptance.createMany({
          data: data.legalAcceptance.documents.map((document) => ({
            contaId: conta.id,
            userId: user.id,
            documentType: document.documentType,
            documentVersion: document.documentVersion,
            locale: data.legalAcceptance?.locale ?? 'pt-BR',
            source: data.legalAcceptance?.source ?? 'REGISTER',
            ipHash: data.legalAcceptanceEvidence?.ipHash ?? null,
            userAgentHash: data.legalAcceptanceEvidence?.userAgentHash ?? null,
            metadata: {
              financeIntegrationMode,
              flow: 'first-register',
            },
          })),
        });
      }

      if (financeIntegrationMode === FinanceIntegrationMode.EXTERNAL_ASAAS_ACCOUNT) {
        await tx.tenantFeatureFlags.upsert({
          where: { contaId: conta.id },
          create: {
            contaId: conta.id,
            enableExternalAsaasOnboarding: true,
          },
          update: {
            enableExternalAsaasOnboarding: true,
          },
        });
      }

      return user;
    });
    return result;
  } catch (e: unknown) {
    if (typeof e === 'object' && e !== null && 'code' in e) {
      const code = String((e as { code?: unknown }).code || '');
      if (code === 'P2002') {
        // Violação de unicidade: pode ser email ou cpfCnpj (se corrida entre checagem e criação) => traduzir genericamente
        // Já validamos antes, mas em condição de corrida garantimos mensagem correta
        throw new EmailInUseError();
      }
      // P2003: deixamos propagar para facilitar diagnóstico (erro de integridade inesperado)
    }
    throw e;
  }
}
