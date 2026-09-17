import prisma from '@/lib/prisma';

export async function userOwnsLegacyAvatar(input: {
  userId: string;
  contaId: string;
  url: string;
}) {
  const record = await prisma.usuario.findFirst({
    where: { id: input.userId, contaId: input.contaId, foto: input.url },
    select: { id: true },
  });
  return Boolean(record);
}

export async function canReadStorageKey(input: {
  key: string;
  userId: string;
  contaId: string;
}) {
  const { key, userId, contaId } = input;
  const url = `/api/files/${encodeURI(key.replace(/^\/+/, ''))}`;
  const filename = key.split('/').pop() ?? '';
  const avatarMatch = /^uploads\/(alunos|responsaveis|colaboradores)\/([^/]+)\/([^/]+)\/avatar\.[a-z0-9]+$/i.exec(key);
  if (avatarMatch) {
    const [, folder, keyContaId, entityId] = avatarMatch;
    if (keyContaId !== contaId) return false;
    if (folder === 'alunos') return Boolean(await prisma.aluno.findFirst({ where: { id: entityId, contaId, foto: url }, select: { id: true } }));
    if (folder === 'responsaveis') return Boolean(await prisma.responsavel.findFirst({ where: { id: entityId, contaId, foto: url }, select: { id: true } }));
    return Boolean(await prisma.colaborador.findFirst({ where: { id: entityId, contaId, foto: url }, select: { id: true } }));
  }
  if (key.startsWith('uploads/avatars/')) {
    if (filename.startsWith(`${contaId}-${userId}-`)) return true;
    return userOwnsLegacyAvatar({ userId, contaId, url });
  }
  if (key.startsWith('uploads/produtos/')) {
    if (await prisma.productImage.findFirst({ where: { url, product: { contaId } }, select: { id: true } })) return true;
    return Boolean(await prisma.productVariant.findFirst({ where: { imageUrl: url, product: { contaId } }, select: { id: true } }));
  }
  if (key.startsWith('uploads/cobrancas/')) {
    if (await prisma.arquivoCobranca.findFirst({ where: { url, cobranca: { contaId } }, select: { id: true } })) return true;
    const arquivoChargeClient = (prisma as typeof prisma & { arquivoCharge?: { findFirst: (args: { where: { url: string; charge: { contaId: string } }; select: { id: true } }) => Promise<{ id: string } | null> } }).arquivoCharge;
    if (!arquivoChargeClient) return false;
    return Boolean(await arquivoChargeClient.findFirst({ where: { url, charge: { contaId } }, select: { id: true } }));
  }
  if (key.startsWith('uploads/contratos/')) {
    if (filename.startsWith(`${contaId}-${userId}-`)) return true;
    if (await prisma.contrato.findFirst({ where: { arquivoPdfUrl: url, matricula: { contaId } }, select: { id: true } })) return true;
    return Boolean(await prisma.contratoModelo.findFirst({ where: { contaId, OR: [{ arquivoPdfUrl: url }, { arquivoOriginalUrl: url }] }, select: { id: true } }));
  }
  return false;
}
