import { prisma } from '@/lib/prisma';
import type { PortalPerfilInputDTO } from '@/features/portal/dtos';

const profileSelect = {
  nome: true,
  email: true,
  telefone: true,
  cpf: true,
  enderecoCep: true,
  enderecoLogradouro: true,
  enderecoNumero: true,
  enderecoComplemento: true,
  enderecoBairro: true,
  enderecoCidade: true,
  enderecoUf: true,
} as const;

export async function getPortalProfile(input: {
  userId: string;
  contaId: string;
  role: string;
}) {
  if (input.role === 'ALUNO') {
    const profile = await prisma.aluno.findFirst({
      where: { usuario: { id: input.userId }, contaId: input.contaId },
      select: { ...profileSelect, dataNasc: true },
    });
    return profile ? { ok: true as const, tipo: 'ALUNO' as const, data: profile } : null;
  }
  if (input.role === 'RESPONSAVEL') {
    const profile = await prisma.responsavel.findFirst({
      where: { usuarioId: input.userId, contaId: input.contaId },
      select: profileSelect,
    });
    return profile ? { ok: true as const, tipo: 'RESPONSAVEL' as const, data: profile } : null;
  }
  return { ok: false as const, reason: 'INVALID_ROLE' as const };
}

export async function updatePortalProfile(input: {
  userId: string;
  contaId: string;
  role: string;
  data: PortalPerfilInputDTO;
}) {
  const { userId, contaId, role, data } = input;
  const address = {
    enderecoCep: data.enderecoCep || null,
    enderecoLogradouro: data.enderecoLogradouro || null,
    enderecoNumero: data.enderecoNumero || null,
    enderecoComplemento: data.enderecoComplemento || null,
    enderecoBairro: data.enderecoBairro || null,
    enderecoCidade: data.enderecoCidade || null,
    enderecoUf: data.enderecoUf || null,
  };

  if (role === 'ALUNO') {
    const aluno = await prisma.aluno.findFirst({
      where: { usuario: { id: userId }, contaId },
      select: { id: true },
    });
    if (!aluno) return { ok: false as const, reason: 'NOT_FOUND' as const, tipo: 'ALUNO' as const };

    const updated = await prisma.$transaction(async (tx) => {
      await tx.aluno.updateMany({
        where: { id: aluno.id, contaId },
        data: { nome: data.nome, email: data.email, telefone: data.telefone, ...address },
      });
      await tx.usuario.updateMany({ where: { id: userId, contaId }, data: { nome: data.nome } });
      return tx.aluno.findFirst({
        where: { id: aluno.id, contaId },
        select: { ...profileSelect, dataNasc: true },
      });
    });
    return updated
      ? { ok: true as const, tipo: 'ALUNO' as const, data: updated }
      : { ok: false as const, reason: 'NOT_FOUND' as const, tipo: 'ALUNO' as const };
  }

  if (role === 'RESPONSAVEL') {
    const responsavel = await prisma.responsavel.findFirst({
      where: { usuarioId: userId, contaId },
      select: { id: true },
    });
    if (!responsavel) {
      return { ok: false as const, reason: 'NOT_FOUND' as const, tipo: 'RESPONSAVEL' as const };
    }

    const updated = await prisma.$transaction(async (tx) => {
      await tx.responsavel.updateMany({
        where: { id: responsavel.id, contaId },
        data: { nome: data.nome, email: data.email, telefone: data.telefone, ...address },
      });
      await tx.usuario.updateMany({ where: { id: userId, contaId }, data: { nome: data.nome } });
      return tx.responsavel.findFirst({ where: { id: responsavel.id, contaId }, select: profileSelect });
    });
    return updated
      ? { ok: true as const, tipo: 'RESPONSAVEL' as const, data: updated }
      : { ok: false as const, reason: 'NOT_FOUND' as const, tipo: 'RESPONSAVEL' as const };
  }

  return { ok: false as const, reason: 'INVALID_ROLE' as const };
}
