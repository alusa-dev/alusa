// Removido bloco duplicado acima. Mantido apenas a versão abaixo.

import type { Prisma } from '@prisma/client';

import prisma from '@/lib/prisma';
import {
  PROFILE_LOCALE_VALUES,
  PROFILE_THEME_VALUES,
  type ProfileLocale,
  type ProfileTheme,
} from '@/lib/profile-preferences';

export const profileSelect = {
  id: true,
  nome: true,
  email: true,
  role: true,
  telefone: true,
  foto: true,
  bio: true,
  locale: true,
  theme: true,
  notifyEmailProduct: true,
  notifyEmailSecurity: true,
  notifyEmailMarketing: true,
  notifyWhatsapp: true,
  notifySms: true,
} as const;

export const profileWithContaSelect = {
  ...profileSelect,
  conta: {
    select: {
      id: true,
      nome: true,
      cpfCnpj: true,
      status: true,
      ownerUserId: true,
      timezone: true,
    },
  },
} as const;

export type ProfileEntity = Prisma.UsuarioGetPayload<{ select: typeof profileSelect }>;
export type ProfileWithContaEntity = any;

export function mapUser(user: ProfileEntity) {
  const localeCandidate = user.locale ?? 'pt-BR';
  const themeCandidate = user.theme ?? 'system';
  const locale = PROFILE_LOCALE_VALUES.includes(localeCandidate as ProfileLocale)
    ? (localeCandidate as ProfileLocale)
    : PROFILE_LOCALE_VALUES[0];
  const theme = PROFILE_THEME_VALUES.includes(themeCandidate as ProfileTheme)
    ? (themeCandidate as ProfileTheme)
    : PROFILE_THEME_VALUES[0];

  return {
    id: user.id,
    name: user.nome,
    email: user.email,
    role: user.role,
    telefone: user.telefone ?? null,
    foto: user.foto ?? null,
    bio: user.bio ?? null,
    locale,
    theme,
    notifications: {
      emailProduct: Boolean(user.notifyEmailProduct),
      emailSecurity: Boolean(user.notifyEmailSecurity),
      emailMarketing: Boolean(user.notifyEmailMarketing),
      whatsapp: Boolean(user.notifyWhatsapp),
      sms: Boolean(user.notifySms),
    },
  };
}

export function mapUserWithConta(user: ProfileWithContaEntity) {
  const canSeeOwnerUserId = String(user.role ?? '').toUpperCase() === 'ADMIN';
  return {
    ...mapUser(user),
    school: user.conta
      ? {
          id: user.conta.id,
          name: user.conta.nome,
          cpfCnpj: user.conta.cpfCnpj,
          status: user.conta.status,
          ownerUserId: canSeeOwnerUserId ? user.conta.ownerUserId : null,
          timezone: user.conta.timezone ?? 'America/Sao_Paulo',
          address: (user as any)?.conta
            ? {
                street: (user as any).conta.enderecoLogradouro ?? '',
                number: (user as any).conta.enderecoNumero ?? '',
                district: (user as any).conta.enderecoBairro ?? '',
                city: (user as any).conta.enderecoCidade ?? '',
                state: (user as any).conta.enderecoUf ?? '',
                cep: (user as any).conta.enderecoCep ?? '',
              }
            : undefined,
        }
      : null,
  };
}

async function ensureTestUserId() {
  const conta = await prisma.conta.upsert({
    where: { id: 'conta-default' },
    update: {},
    create: {
      id: 'conta-default',
      nome: 'Alusa Demo',
      cpfCnpj: '00000000000191',
      status: 'ATIVO',
    } as Prisma.ContaUncheckedCreateInput,
  });

  const owner = await prisma.usuario.upsert({
    where: { email: 'owner+users-me@example.com' },
    update: {},
    create: {
      id: 'owner-users-me',
      contaId: conta.id,
      nome: 'Owner Users Me',
      email: 'owner+users-me@example.com',
      senhaHash: 'x',
      role: 'ADMIN',
      status: 'ATIVO',
      locale: PROFILE_LOCALE_VALUES[0],
      theme: PROFILE_THEME_VALUES[0],
    },
    select: { id: true },
  });

  if (conta.ownerUserId !== owner.id) {
    await prisma.conta.update({ where: { id: conta.id }, data: { ownerUserId: owner.id } });
  }

  const admin = await prisma.usuario.upsert({
    where: { email: 'admin@example.com' },
    update: {},
    create: {
      contaId: conta.id,
      nome: 'Admin Test',
      email: 'admin@example.com',
      telefone: null,
      foto: null,
      bio: null,
      senhaHash: 'test',
      role: 'ADMIN',
      status: 'ATIVO',
      locale: PROFILE_LOCALE_VALUES[0],
      theme: PROFILE_THEME_VALUES[0],
    },
    select: { id: true },
  });

  return admin.id;
}

export async function resolveUserId(sessionUserId: string | undefined) {
  if (sessionUserId) return sessionUserId;
  if (process.env.NODE_ENV !== 'production' && process.env.TEST_ROUTES_ENABLED === 'true') {
    return ensureTestUserId();
  }
  return null;
}
