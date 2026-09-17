import prisma from '@/lib/prisma';
import { Prisma } from '@prisma/client';
import { comparePassword, hashPassword } from '@/lib/auth-password';
import { revokeUserSessions } from '@/lib/auth-service';

const schoolSummarySelect = {
  id: true,
  nome: true,
  cpfCnpj: true,
  status: true,
  ownerUserId: true,
  timezone: true,
} as const;

const schoolAddressSelect = {
  enderecoLogradouro: true,
  enderecoNumero: true,
  enderecoBairro: true,
  enderecoCidade: true,
  enderecoUf: true,
  enderecoCep: true,
} as const;

const profileSelect = {
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

const profileWithSchoolSelect = {
  ...profileSelect,
  conta: {
    select: {
      id: true,
      nome: true,
      cpfCnpj: true,
      status: true,
      ownerUserId: true,
      timezone: true,
      ...schoolAddressSelect,
    },
  },
} as const;

export async function getCurrentUserProfile(userId: string) {
  return prisma.usuario.findUnique({
    where: { id: userId },
    select: profileWithSchoolSelect,
  });
}

export async function updateCurrentUserProfile(input: {
  userId: string;
  name?: string;
  telefone?: string | null;
  foto?: string | null;
  bio?: string | null;
  locale?: string;
  theme?: string;
}) {
  const data: Prisma.UsuarioUpdateInput = {};

  if (typeof input.name !== 'undefined') data.nome = input.name;
  if (typeof input.telefone !== 'undefined') data.telefone = input.telefone;
  if (typeof input.foto !== 'undefined') data.foto = input.foto;
  if (typeof input.bio !== 'undefined') data.bio = input.bio;
  if (typeof input.locale !== 'undefined') data.locale = input.locale;
  if (typeof input.theme !== 'undefined') data.theme = input.theme;

  return prisma.usuario.update({
    where: { id: input.userId },
    data,
    select: profileSelect,
  });
}

export async function changeUserEmail(input: {
  userId: string;
  newEmail: string;
  currentPassword: string;
}) {
  const user = await prisma.usuario.findUnique({
    where: { id: input.userId },
    select: { email: true, senhaHash: true },
  });
  if (!user) return { status: 'NOT_FOUND' as const };
  if (user.email.toLowerCase() === input.newEmail) return { status: 'SAME_EMAIL' as const };

  const emailInUse = await prisma.usuario.findUnique({
    where: { email: input.newEmail },
    select: { id: true },
  });
  if (emailInUse && emailInUse.id !== input.userId) return { status: 'EMAIL_IN_USE' as const };

  if (!(await comparePassword(input.currentPassword, user.senhaHash))) {
    return { status: 'INVALID_PASSWORD' as const };
  }

  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: input.userId }, data: { email: input.newEmail } });
    await revokeUserSessions(input.userId, tx);
  });
  return { status: 'UPDATED' as const, email: input.newEmail };
}

export async function changeUserPassword(input: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}) {
  const user = await prisma.usuario.findUnique({
    where: { id: input.userId },
    select: { senhaHash: true, contaId: true },
  });
  if (!user?.senhaHash) return { status: 'NOT_FOUND' as const };

  if (!(await comparePassword(input.currentPassword, user.senhaHash))) {
    return { status: 'INVALID_PASSWORD' as const, contaId: user.contaId };
  }

  const newHash = await hashPassword(input.newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({
      where: { id: input.userId },
      data: { senhaHash: newHash, passwordChangedAt: new Date() },
    });
    await revokeUserSessions(input.userId, tx);
  });
  return { status: 'UPDATED' as const, contaId: user.contaId };
}

export async function updateUserNotificationPreferences(input: {
  userId: string;
  emailProduct: boolean;
  emailSecurity: boolean;
  emailMarketing: boolean;
  whatsapp: boolean;
  sms: boolean;
}) {
  const user = await prisma.usuario.update({
    where: { id: input.userId },
    data: {
      notifyEmailProduct: input.emailProduct,
      notifyEmailSecurity: input.emailSecurity,
      notifyEmailMarketing: input.emailMarketing,
      notifyWhatsapp: input.whatsapp,
      notifySms: input.sms,
    },
    select: {
      notifyEmailProduct: true,
      notifyEmailSecurity: true,
      notifyEmailMarketing: true,
      notifyWhatsapp: true,
      notifySms: true,
    },
  });

  return {
    emailProduct: Boolean(user.notifyEmailProduct),
    emailSecurity: Boolean(user.notifyEmailSecurity),
    emailMarketing: Boolean(user.notifyEmailMarketing),
    whatsapp: Boolean(user.notifyWhatsapp),
    sms: Boolean(user.notifySms),
  };
}

export async function getWelcomeWizardStatus(userId: string) {
  return prisma.usuario.findUnique({
    where: { id: userId },
    select: { welcomeWizardSeenAt: true },
  });
}

export async function markWelcomeWizardSeen(userId: string) {
  return prisma.usuario.update({
    where: { id: userId },
    data: { welcomeWizardSeenAt: new Date() },
    select: { welcomeWizardSeenAt: true },
  });
}

export async function getSchoolAddress(contaId: string) {
  return prisma.conta.findUnique({ where: { id: contaId }, select: schoolAddressSelect });
}

export async function updateSchoolAddress(input: {
  contaId: string;
  street?: string | null;
  number?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  cep?: string | null;
}) {
  return prisma.conta.update({
    where: { id: input.contaId },
    data: {
      enderecoLogradouro: input.street,
      enderecoNumero: input.number,
      enderecoBairro: input.district,
      enderecoCidade: input.city,
      enderecoUf: input.state?.toUpperCase(),
      enderecoCep: input.cep?.replace(/\D/g, ''),
    },
    select: schoolAddressSelect,
  });
}

export async function updateSchool(input: {
  contaId: string;
  name?: string | null;
  cpfCnpj?: string | null;
  timezone?: string | null;
}) {
  const data: Prisma.ContaUpdateInput = {};
  if (typeof input.name === 'string') data.nome = input.name;
  if (typeof input.cpfCnpj === 'string') data.cpfCnpj = input.cpfCnpj.replace(/\D/g, '');
  if (typeof input.timezone === 'string') data.timezone = input.timezone;

  return prisma.conta.update({
    where: { id: input.contaId },
    data,
    select: schoolSummarySelect,
  });
}

export async function countUsersForTestRoute() {
  return prisma.usuario.count();
}
