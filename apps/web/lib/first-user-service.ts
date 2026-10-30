import { ExternalAsaasOnboardingStatus, FinanceIntegrationMode, Role, type Usuario } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { isValidCpfCnpjDigits, normalizeCpfCnpjDigits } from '@alusa/shared/validators/cpf-cnpj';
import {
  isAtLeastAgeYears,
  isValidDateOnly,
  parseDateOnlyToUtcDate,
} from '@alusa/shared/date-only';
import { hashPassword, passwordPolicyMessage, passwordPolicyRegex } from '@/lib/auth-password';
import prisma from '@/lib/prisma';
import type { LegalDocumentType } from '@/lib/privacy/legal-versions';

export interface FirstUserInput {
  registrationSource?: 'PUBLIC_SELF_SERVICE';
  escolaNome: string;

  cpfCnpj?: string;
  nome: string;
  email: string;
  financeIntegrationMode?: FinanceIntegrationMode;
  birthDate?: string;
  senha: string;
  schoolInvitationToken?: string;
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
  readonly userId: string;
  readonly email: string;

  constructor(
    userId: string,
    email: string,
  ) {
    super('Já existe uma conta desativada vinculada a este e-mail.');
    this.userId = userId;
    this.email = email;
  }
}
export class CpfCnpjInUseError extends Error { constructor() { super('Já existe uma escola registrada com este CPF/CNPJ.'); } }
export class PasswordPolicyError extends Error { constructor() { super(passwordPolicyMessage); } }
export class SchoolInvitationInvalidError extends Error { constructor() { super('Convite comercial inválido, expirado ou não disponível.'); } }
export class SchoolInvitationEmailMismatchError extends Error { constructor() { super('Use o e-mail informado no convite comercial.'); } }

export type FirstUserRegistrationAvailability =
  | { available: true }
  | { available: false; reason: 'LOCAL_ACTIVE' }
  | { available: false; reason: 'LOCAL_DEACTIVATED'; userId: string; email: string };

export async function findSchoolInvitationByToken(token: string) {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return prisma.platformSchoolInvitation.findUnique({ where: { tokenHash } });
}

export async function findAcceptedSchoolInvitationByToken(token: string) {
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return prisma.platformSchoolInvitation.findUnique({
    where: { tokenHash },
    select: { status: true, email: true },
  });
}

function isAccountDeactivated(status: string | null | undefined, deletedAt: Date | null | undefined): boolean {
  return Boolean(deletedAt) || (typeof status === 'string' && status.toUpperCase() !== 'ATIVO');
}

async function findUserByEmail(email: string, database: typeof prisma = prisma) {
  return database.usuario.findFirst({
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
}): Promise<FirstUserRegistrationAvailability> {
  const normalizedEmail = input.email.trim();
  const existingEmail = await findUserByEmail(normalizedEmail);

  if (!existingEmail) return { available: true };
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

export async function createFirstUser(data: FirstUserInput, database: typeof prisma = prisma): Promise<Usuario> {
  const financeIntegrationMode = data.financeIntegrationMode ?? 'WHITELABEL_BAAS';
  const cpfCnpjDigits = data.cpfCnpj ? normalizeCpfCnpjDigits(data.cpfCnpj) : undefined;
  if (cpfCnpjDigits && !isValidCpfCnpjDigits(cpfCnpjDigits)) {
    throw new Error('CPF/CNPJ inválido.');
  }

  if (data.birthDate && (!isValidDateOnly(data.birthDate) || !isAtLeastAgeYears(data.birthDate, 18))) {
    throw new Error('birthDate inválido.');
  }
  const birthDate = data.birthDate ? parseDateOnlyToUtcDate(data.birthDate) : undefined;

  const invitation = data.schoolInvitationToken
    ? await database.platformSchoolInvitation.findUnique({ where: { tokenHash: createHash('sha256').update(data.schoolInvitationToken).digest('hex') } })
    : null;
  if (data.schoolInvitationToken && !invitation) throw new SchoolInvitationInvalidError();
  if (invitation && invitation.email !== data.email.trim().toLowerCase()) throw new SchoolInvitationEmailMismatchError();
  if (invitation && invitation.status === 'ACCEPTED' && invitation.acceptedContaId) {
    const acceptedUser = await prisma.usuario.findFirst({ where: { contaId: invitation.acceptedContaId, email: { equals: invitation.email, mode: 'insensitive' } } });
    if (acceptedUser) return acceptedUser;
    throw new SchoolInvitationInvalidError();
  }
  if (invitation && (invitation.status !== 'PENDING' || invitation.expiresAt <= new Date())) throw new SchoolInvitationInvalidError();

  // Política de senha
  if (!passwordPolicyRegex.test(data.senha)) throw new PasswordPolicyError();
  // Unicidade email
  const existingEmail = await findUserByEmail(data.email, database);
  if (existingEmail) {
    if (isAccountDeactivated(existingEmail.conta?.status, existingEmail.conta?.deletedAt)) {
      throw new InactiveAccountEmailError(existingEmail.id, existingEmail.email);
    }
    throw new EmailInUseError();
  }
  // Unicidade CPF/CNPJ para Conta (apenas se fornecido)
  if (cpfCnpjDigits) {
    const existingConta = await database.conta.findFirst({ where: { cpfCnpj: cpfCnpjDigits } });
    if (existingConta) throw new CpfCnpjInUseError();
  }
  // Criar conta e usuário ADMIN e marcar como owner em uma transação
  const senhaHash = await hashPassword(data.senha);
  try {
    const result = await database.$transaction(async (tx) => {
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

      if (data.registrationSource === 'PUBLIC_SELF_SERVICE' && !invitation) {
        await tx.hubSpotAccountCreatedOutbox.create({ data: { contaId: conta.id, availableAt: new Date() } });
      }

      if (invitation) {
        const claimed = await tx.platformSchoolInvitation.updateMany({
          where: { id: invitation.id, status: 'PENDING', expiresAt: { gt: new Date() } },
          data: { status: 'ACCEPTED', acceptedAt: new Date(), acceptedContaId: conta.id },
        });
        if (claimed.count !== 1) throw new SchoolInvitationInvalidError();
        await tx.platformSchoolInvitationHistory.create({
          data: {
            invitationId: invitation.id,
            actorId: invitation.createdByAdminId,
            action: 'ACCEPTED',
            before: { status: 'PENDING' },
            after: { status: 'ACCEPTED', acceptedContaId: conta.id, acceptedByUserId: user.id },
          },
        });
      }

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
