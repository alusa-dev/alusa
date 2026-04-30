import { Role, Prisma } from '@prisma/client';
import { prisma } from '../../prisma';
import { randomUUID } from 'crypto';

export type InviteStatus = 'PENDING' | 'CANCELED' | 'ACCEPTED';
export type InviteRole = Role;

export interface InviteDTO {
  id: string;
  email: string | null;
  role: InviteRole;
  token: string;
  invitedById: string;
  status: InviteStatus;
  expiresAt: Date;
  createdAt: Date;
}

export async function createInvite(
  email: string | undefined | null,
  role: InviteRole,
  invitedBy: string,
): Promise<InviteDTO> {
  const normalizedEmail = email ? email.trim().toLowerCase() : null;
  const now = new Date();
  // Prazo de expiração aproximado de 72h, mas tolerante a variações mínimas
  const expiresAt = new Date(now.getTime() + 72 * 60 * 60 * 1000);

  // Se já existir convite pendente para o email, retorna-o
  if (normalizedEmail) {
    const existing = await prisma.invite.findFirst({
      where: { email: normalizedEmail, status: 'PENDING' },
    });
    if (existing) return existing as unknown as InviteDTO;
  }

  const token = randomUUID();

  // Descobrir contaId do convidador; se não existir, mantém null para compatibilidade
  let contaId: string | null = null;
  try {
    const inviter = await prisma.usuario.findUnique({ where: { id: invitedBy } });
    contaId = inviter?.contaId ?? null;
  } catch {
    contaId = null;
  }

  const baseData: Prisma.InviteCreateInput = {
    email: normalizedEmail,
    role: role as Role,
    token,
    invitedById: invitedBy,
    status: 'PENDING',
    expiresAt,
  };
  // Cria SEM contaId para evitar erro caso o Prisma Client local esteja desatualizado
  // Em seguida, tentamos atualizar com contaId se disponível (best-effort)

  let created;
  try {
    created = await prisma.invite.create({
      data: baseData as unknown as Parameters<typeof prisma.invite.create>[0]['data'],
    });
  } catch (e: unknown) {
    // Se houve erro de unicidade de token (raríssimo), tenta novamente uma vez
    if (typeof e === 'object' && e && 'code' in e && (e as { code?: string }).code === 'P2002') {
      const retryData: Prisma.InviteCreateInput = { ...baseData, token: randomUUID() };
      const retry = await prisma.invite.create({
        data: retryData as unknown as Parameters<typeof prisma.invite.create>[0]['data'],
      });
      return retry as unknown as InviteDTO;
    }
    throw e;
  }

  // Best-effort: tentar hidratar contaId após criação
  if (contaId) {
    try {
      const createdId: string = (created as { id: string }).id;
      await prisma.invite.update({ where: { id: createdId }, data: { contaId } });
    } catch {
      // Ignorar se o client não tiver o campo (mantém compatibilidade)
    }
  }

  return created as unknown as InviteDTO;
}

export async function listInvites(): Promise<InviteDTO[]> {
  const rows = await prisma.invite.findMany({
    where: { status: 'PENDING' },
    orderBy: { createdAt: 'desc' },
  });
  return rows as unknown as InviteDTO[];
}

export async function getInviteById(id: string): Promise<InviteDTO | null> {
  const row = await prisma.invite.findUnique({ where: { id } });
  return row ? (row as unknown as InviteDTO) : null;
}

/**
 * Cancela (revoga) um convite PENDING por id.
 * Retorna true se atualizou; false se não encontrado ou já não está PENDING.
 */
export async function cancelInviteById(id: string): Promise<boolean> {
  try {
    const found = await prisma.invite.findUnique({ where: { id } });
    if (!found || String(found.status).toUpperCase() !== 'PENDING') return false;
    await prisma.invite.update({ where: { id }, data: { status: 'REVOKED' } });
    return true;
  } catch {
    return false;
  }
}
