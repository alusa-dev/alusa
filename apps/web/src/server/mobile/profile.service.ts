import { prisma } from '@/lib/prisma';
import type { Prisma } from '@prisma/client';

export type MobileActor = { userId: string; contaId: string };

export async function getMobileProfile(actor: MobileActor) {
  const membership = await prisma.usuarioConta.findFirst({
    where: {
      usuarioId: actor.userId,
      contaId: actor.contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: {
      role: true,
      usuario: {
        select: { nome: true, email: true, telefone: true, birthDate: true, bio: true, locale: true, theme: true },
      },
      conta: {
        select: {
          id: true,
          nome: true,
          cpfCnpj: true,
          status: true,
          timezone: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoBairro: true,
          enderecoCidade: true,
          enderecoUf: true,
        },
      },
    },
  });
  if (!membership) return null;

  return {
    personal: {
      name: membership.usuario.nome,
      email: membership.usuario.email,
      telefone: membership.usuario.telefone ?? null,
      birthDate: membership.usuario.birthDate?.toISOString() ?? null,
      bio: membership.usuario.bio ?? null,
      locale: membership.usuario.locale,
      theme: membership.usuario.theme,
    },
    school: {
      id: membership.conta.id,
      name: membership.conta.nome,
      cpfCnpj: membership.conta.cpfCnpj ?? null,
      status: membership.conta.status,
      timezone: membership.conta.timezone,
      role: membership.role,
      address: {
        cep: membership.conta.enderecoCep ?? null,
        street: membership.conta.enderecoLogradouro ?? null,
        number: membership.conta.enderecoNumero ?? null,
        neighborhood: membership.conta.enderecoBairro ?? null,
        city: membership.conta.enderecoCidade ?? null,
        state: membership.conta.enderecoUf ?? null,
      },
    },
    permissions: {
      canEditPersonal: true,
      canEditSchool: membership.role === 'ADMIN',
      canEditSchoolLegalIdentity: false,
    },
  };
}

export async function getActiveMobileMembership(actor: MobileActor) {
  return prisma.usuarioConta.findFirst({
    where: {
      usuarioId: actor.userId,
      contaId: actor.contaId,
      status: 'ATIVO',
      usuario: { status: 'ATIVO' },
      conta: { status: 'ATIVO', deletedAt: null },
    },
    select: { id: true, role: true },
  });
}

export async function updateLegacyMobileProfile(actor: MobileActor, name: string) {
  const updated = await prisma.usuario.updateMany({
    where: { id: actor.userId, acessosConta: { some: { contaId: actor.contaId, status: 'ATIVO' } } },
    data: { nome: name },
  });
  if (updated.count !== 1) return null;
  const user = await prisma.usuario.findUnique({ where: { id: actor.userId }, select: { foto: true } });
  return { name, foto: user?.foto ?? null };
}

export async function updateMobileProfile(input: {
  actor: MobileActor;
  userData: Prisma.UsuarioUpdateManyMutationInput;
  schoolData: Prisma.ContaUpdateInput;
}) {
  await prisma.$transaction(async (transaction) => {
    if (Object.keys(input.userData).length > 0) {
      const result = await transaction.usuario.updateMany({
        where: { id: input.actor.userId, acessosConta: { some: { contaId: input.actor.contaId, status: 'ATIVO' } } },
        data: input.userData,
      });
      if (result.count !== 1) throw new Error('PROFILE_MEMBERSHIP_NOT_FOUND');
    }
    if (Object.keys(input.schoolData).length > 0) {
      await transaction.conta.updateMany({
        where: { id: input.actor.contaId },
        data: input.schoolData,
      });
    }
  });
  return getMobileProfile(input.actor);
}
