import { prisma } from '@/lib/prisma';
import type { AvatarEntity } from '@/lib/media/avatar-url';

type AvatarRecord = {
  foto: string | null;
};

export async function loadAvatarRecord(params: {
  entity: AvatarEntity;
  id: string;
  contaId: string;
}): Promise<AvatarRecord | null> {
  const { entity, id, contaId } = params;

  switch (entity) {
    case 'aluno':
      return prisma.aluno.findFirst({
        where: { id, contaId },
        select: { foto: true },
      });
    case 'responsavel':
      return prisma.responsavel.findFirst({
        where: { id, contaId },
        select: { foto: true },
      });
    case 'colaborador':
      return prisma.colaborador.findFirst({
        where: { id, contaId },
        select: { foto: true },
      });
    case 'user': {
      const usuario = await prisma.usuario.findFirst({
        where: {
          id,
          OR: [{ contaId }, { acessosConta: { some: { contaId } } }],
        },
        select: { foto: true },
      });
      return usuario;
    }
    default:
      return null;
  }
}

export function parseDataImagePayload(
  value: string,
): { mime: string; buffer: Buffer } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(value.trim());
  if (!match) return null;

  try {
    const buffer = Buffer.from(match[2], 'base64');
    if (!buffer.length) return null;
    return { mime: match[1], buffer };
  } catch {
    return null;
  }
}
