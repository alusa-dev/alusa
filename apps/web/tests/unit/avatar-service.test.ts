import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  usuarioConta: { findFirst: vi.fn() },
  usuario: { updateMany: vi.fn() },
}));

const storageMock = vi.hoisted(() => ({
  putStorageObject: vi.fn(),
  deleteStorageObject: vi.fn(),
}));

const imageSizeMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('image-size', () => ({ imageSize: imageSizeMock }));
vi.mock('@/lib/r2-storage', () => ({
  isR2Configured: () => true,
  putStorageObject: storageMock.putStorageObject,
  deleteStorageObject: storageMock.deleteStorageObject,
  storageUrlForKey: (key: string) => `/api/files/${key}`,
  storageKeyFromUrl: (url: string) => url.startsWith('/api/files/') ? url.slice('/api/files/'.length) : null,
}));

import {
  AvatarServiceError,
  prepareAvatarFile,
  replaceCurrentAvatar,
} from '@/features/account/server/avatar-service';

function validJpegFile() {
  const bytes = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb]);
  return {
    name: 'avatar.jpg',
    type: 'image/jpeg',
    size: bytes.byteLength,
    arrayBuffer: async () => bytes.buffer,
  } as File;
}

describe('avatar-service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageSizeMock.mockReturnValue({ width: 512, height: 512, type: 'jpg' });
    prismaMock.usuarioConta.findFirst.mockResolvedValue({ usuario: { foto: null } });
    prismaMock.usuario.updateMany.mockResolvedValue({ count: 1 });
    storageMock.putStorageObject.mockResolvedValue(undefined);
    storageMock.deleteStorageObject.mockResolvedValue(undefined);
  });

  it('aceita somente o avatar processado em 512 por 512 pixels', async () => {
    const avatar = await prepareAvatarFile(validJpegFile());

    expect(avatar.mimeType).toBe('image/jpeg');
    expect(avatar.extension).toBe('.jpg');

    imageSizeMock.mockReturnValueOnce({ width: 640, height: 480, type: 'jpg' });
    await expect(prepareAvatarFile(validJpegFile())).rejects.toMatchObject({
      status: 400,
      code: 'INVALID_DIMENSIONS',
    });
  });

  it('valida o vínculo ativo usando usuarioId e contaId antes de gravar', async () => {
    const avatar = await prepareAvatarFile(validJpegFile());
    await replaceCurrentAvatar(
      { userId: 'user-1', contaId: 'conta-1' },
      avatar,
      'correlation-1',
    );

    expect(prismaMock.usuarioConta.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        usuarioId: 'user-1',
        contaId: 'conta-1',
        status: 'ATIVO',
      }),
    }));
    expect(prismaMock.usuario.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1', foto: null },
    }));
  });

  it('não grava arquivo quando o usuário não pertence à conta ativa', async () => {
    prismaMock.usuarioConta.findFirst.mockResolvedValueOnce(null);
    const avatar = await prepareAvatarFile(validJpegFile());

    await expect(replaceCurrentAvatar(
      { userId: 'user-1', contaId: 'conta-2' },
      avatar,
      'correlation-2',
    )).rejects.toBeInstanceOf(AvatarServiceError);
    expect(storageMock.putStorageObject).not.toHaveBeenCalled();
    expect(prismaMock.usuario.updateMany).not.toHaveBeenCalled();
  });

  it('remove o arquivo novo quando uma atualização concorrente impede o vínculo no banco', async () => {
    prismaMock.usuario.updateMany.mockResolvedValueOnce({ count: 0 });
    const avatar = await prepareAvatarFile(validJpegFile());

    await expect(replaceCurrentAvatar(
      { userId: 'user-1', contaId: 'conta-1' },
      avatar,
      'correlation-3',
    )).rejects.toMatchObject({ status: 409, code: 'CONCURRENT_UPDATE' });

    const storedKey = storageMock.putStorageObject.mock.calls[0]?.[0]?.key as string;
    expect(storedKey).toContain('uploads/avatars/conta-1-user-1-');
    expect(storageMock.deleteStorageObject).toHaveBeenCalledWith(storedKey);
  });

  it('remove a foto anterior somente depois de atualizar o usuário', async () => {
    const previousKey = 'uploads/avatars/conta-1-user-1-old.jpg';
    prismaMock.usuarioConta.findFirst.mockResolvedValueOnce({
      usuario: { foto: `/api/files/${previousKey}` },
    });
    const avatar = await prepareAvatarFile(validJpegFile());

    await replaceCurrentAvatar(
      { userId: 'user-1', contaId: 'conta-1' },
      avatar,
      'correlation-4',
    );

    expect(prismaMock.usuario.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'user-1', foto: `/api/files/${previousKey}` },
    }));
    expect(storageMock.deleteStorageObject).toHaveBeenCalledWith(previousKey);
    expect(storageMock.putStorageObject.mock.invocationCallOrder[0])
      .toBeLessThan(prismaMock.usuario.updateMany.mock.invocationCallOrder[0]);
    expect(prismaMock.usuario.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(storageMock.deleteStorageObject.mock.invocationCallOrder[0]);
  });
});
