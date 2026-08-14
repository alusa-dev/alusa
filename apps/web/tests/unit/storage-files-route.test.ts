import { beforeEach, describe, expect, it, vi } from 'vitest';

const sessionMock = vi.hoisted(() => vi.fn());
const prismaMock = vi.hoisted(() => ({
  aluno: { findFirst: vi.fn() },
  usuario: { findFirst: vi.fn() },
  productImage: { findFirst: vi.fn() },
  productVariant: { findFirst: vi.fn() },
  arquivoCobranca: { findFirst: vi.fn() },
  contrato: { findFirst: vi.fn() },
  contratoModelo: { findFirst: vi.fn() },
}));
const storageMock = vi.hoisted(() => ({
  getStorageObject: vi.fn(),
  isR2Configured: vi.fn(),
}));

vi.mock('next-auth', () => ({ getServerSession: sessionMock }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/lib/prisma', () => ({ default: prismaMock }));
vi.mock('@/lib/r2-storage', () => ({
  getStorageObject: storageMock.getStorageObject,
  isAllowedStorageKey: (key: string) => key.startsWith('uploads/'),
  isR2Configured: storageMock.isR2Configured,
}));

import { GET } from '@/app/api/files/[...key]/route';

describe('/api/files/[...key]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storageMock.isR2Configured.mockReturnValue(true);
    sessionMock.mockResolvedValue({ user: { id: 'user-1', contaId: 'conta-1' } });
    storageMock.getStorageObject.mockResolvedValue({
      Body: { transformToByteArray: async () => Uint8Array.from([1, 2, 3]) },
      ContentType: 'image/jpeg',
      ContentLength: 3,
    });
  });

  it('serve avatar de aluno somente quando o registro pertence à conta ativa', async () => {
    prismaMock.aluno.findFirst.mockResolvedValue({ id: 'aluno-1' });

    const response = await GET(
      new Request('http://localhost/api/files/uploads/alunos/conta-1/aluno-1/avatar.jpg') as never,
      { params: Promise.resolve({ key: ['uploads', 'alunos', 'conta-1', 'aluno-1', 'avatar.jpg'] }) },
    );

    expect(response.status).toBe(200);
    expect(prismaMock.aluno.findFirst).toHaveBeenCalledWith({
      where: {
        id: 'aluno-1',
        contaId: 'conta-1',
        foto: '/api/files/uploads/alunos/conta-1/aluno-1/avatar.jpg',
      },
      select: { id: true },
    });
  });

  it('nega avatar de outra conta', async () => {
    prismaMock.aluno.findFirst.mockResolvedValue(null);

    const response = await GET(
      new Request('http://localhost/api/files/uploads/alunos/conta-2/aluno-2/avatar.jpg') as never,
      { params: Promise.resolve({ key: ['uploads', 'alunos', 'conta-2', 'aluno-2', 'avatar.jpg'] }) },
    );

    expect(response.status).toBe(404);
    expect(storageMock.getStorageObject).not.toHaveBeenCalled();
  });

  it('serve PDF de contrato pendente somente para o usuário que iniciou o upload', async () => {
    const key = 'uploads/contratos/conta-1-user-1-upload-1.pdf';
    const response = await GET(
      new Request(`http://localhost/api/files/${key}`) as never,
      { params: Promise.resolve({ key: key.split('/') }) },
    );

    expect(response.status).toBe(200);
    expect(storageMock.getStorageObject).toHaveBeenCalledWith(key);
    expect(prismaMock.contratoModelo.findFirst).not.toHaveBeenCalled();
  });

  it('nega PDF de contrato pendente de outro usuário', async () => {
    const key = 'uploads/contratos/conta-1-user-2-upload-1.pdf';
    const response = await GET(
      new Request(`http://localhost/api/files/${key}`) as never,
      { params: Promise.resolve({ key: key.split('/') }) },
    );

    expect(response.status).toBe(404);
    expect(storageMock.getStorageObject).not.toHaveBeenCalled();
  });
});
