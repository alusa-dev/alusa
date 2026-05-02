import { describe, expect, it, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

const { prismaMock, r2Mock, sessionMock } = vi.hoisted(() => ({
  prismaMock: {
    arquivoCobranca: { findFirst: vi.fn() },
    arquivoCharge: { findFirst: vi.fn() },
    contrato: { findFirst: vi.fn() },
    contratoModelo: { findFirst: vi.fn() },
    productImage: { findFirst: vi.fn() },
    productVariant: { findFirst: vi.fn() },
    usuario: { findFirst: vi.fn() },
    aluno: { findFirst: vi.fn() },
    professor: { findFirst: vi.fn() },
    colaborador: { findFirst: vi.fn() },
  },
  r2Mock: {
    isR2Configured: vi.fn(),
    isAllowedStorageKey: vi.fn((key: string) =>
      Boolean(key && !key.startsWith('/') && !key.includes('..') && !key.includes('//') && key.startsWith('uploads/')),
    ),
    storageUrlForKey: vi.fn((key: string) => `/api/files/${encodeURI(key.replace(/^\/+/, ''))}`),
    getStorageObject: vi.fn(),
  },
  sessionMock: vi.fn(),
}));
const fsMock = vi.hoisted(() => ({
  readFile: vi.fn(),
}));

vi.mock('@/lib/prisma', () => ({
  prisma: prismaMock,
}));

vi.mock('@/lib/safe-server-session', () => ({
  safeGetServerSession: sessionMock,
}));

vi.mock('@/lib/r2-storage', () => r2Mock);

vi.mock('fs', () => ({
  default: { promises: fsMock },
  promises: fsMock,
}));

import { GET } from '@/app/api/files/[...key]/route';

function requestFor(key: string, query = '') {
  return new NextRequest(`http://localhost/api/files/${key}${query}`);
}

function contextFor(key: string) {
  return { params: { key: key.split('/') } };
}

function mockStorage(bytes = 'ok') {
  r2Mock.getStorageObject.mockResolvedValue({
    Body: {
      transformToByteArray: vi.fn(async () => new TextEncoder().encode(bytes)),
    },
    ContentType: 'application/pdf',
    ContentLength: bytes.length,
  });
}

describe('GET /api/files/[...key]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    r2Mock.isR2Configured.mockReturnValue(true);
    fsMock.readFile.mockResolvedValue(Buffer.from('local'));
    mockStorage();
    Object.values(prismaMock).forEach((delegate) => {
      delegate.findFirst.mockResolvedValue(null);
    });
  });

  it('retorna 401 para arquivo privado sem sessão', async () => {
    sessionMock.mockResolvedValue(null);
    const key = 'uploads/cobrancas/arquivo.pdf';

    const response = await GET(requestFor(key), contextFor(key));

    expect(response.status).toBe(401);
    expect(r2Mock.getStorageObject).not.toHaveBeenCalled();
  });

  it('retorna 404 quando o arquivo não pertence à conta do usuário', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', contaId: 'conta-2' } });
    const key = 'uploads/cobrancas/arquivo.pdf';

    const response = await GET(requestFor(key), contextFor(key));

    expect(response.status).toBe(404);
    expect(r2Mock.getStorageObject).not.toHaveBeenCalled();
  });

  it('serve arquivo de cobrança pertencente à conta do usuário', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', contaId: 'conta-1' } });
    prismaMock.arquivoCobranca.findFirst.mockResolvedValueOnce({ id: 'arquivo-1' });
    const key = 'uploads/cobrancas/arquivo.pdf';

    const response = await GET(requestFor(key), contextFor(key));

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(await response.text()).toBe('ok');
    expect(prismaMock.arquivoCobranca.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { nomeArquivo: 'arquivo.pdf' },
            {
              url: {
                in: [
                  '/api/files/uploads/cobrancas/arquivo.pdf',
                  '/uploads/cobrancas/arquivo.pdf',
                ],
              },
            },
          ],
          cobranca: { matricula: { aluno: { contaId: 'conta-1' } } },
        }),
      }),
    );
  });

  it('rejeita key com tentativa de path traversal', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', contaId: 'conta-1' } });
    const key = 'uploads/../secret.pdf';

    const response = await GET(requestFor('uploads/%2E%2E/secret.pdf'), contextFor(key));

    expect(response.status).toBe(400);
    expect(r2Mock.getStorageObject).not.toHaveBeenCalled();
  });

  it('permite contrato público somente com token válido para a key', async () => {
    sessionMock.mockResolvedValue(null);
    prismaMock.contrato.findFirst.mockResolvedValueOnce({
      tokenExpiraEm: new Date(Date.now() + 60_000),
    });
    const key = 'uploads/contratos/contrato.pdf';

    const response = await GET(requestFor(key, '?contratoToken=token-1'), contextFor(key));

    expect(response.status).toBe(200);
    expect(sessionMock).not.toHaveBeenCalled();
    expect(prismaMock.contrato.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tokenPublico: 'token-1',
          arquivoPdfUrl: {
            in: ['/api/files/uploads/contratos/contrato.pdf', '/uploads/contratos/contrato.pdf'],
          },
        }),
      }),
    );
  });

  it('serve fallback local autorizado quando R2 não está configurado', async () => {
    r2Mock.isR2Configured.mockReturnValue(false);
    sessionMock.mockResolvedValue({ user: { id: 'u1', contaId: 'conta-1' } });
    prismaMock.arquivoCobranca.findFirst.mockResolvedValueOnce({ id: 'arquivo-1' });
    const key = 'uploads/cobrancas/local.pdf';

    const response = await GET(requestFor(key), contextFor(key));

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('local');
    expect(response.headers.get('content-type')).toBe('application/pdf');
    expect(fsMock.readFile).toHaveBeenCalledWith(
      expect.stringContaining('public/uploads/cobrancas/local.pdf'),
    );
    expect(r2Mock.getStorageObject).not.toHaveBeenCalled();
  });

  it('não registra key completa em erro inesperado do storage', async () => {
    sessionMock.mockResolvedValue({ user: { id: 'u1', contaId: 'conta-1' } });
    prismaMock.arquivoCobranca.findFirst.mockResolvedValueOnce({ id: 'arquivo-1' });
    r2Mock.getStorageObject.mockRejectedValueOnce(new Error('storage down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const key = 'uploads/cobrancas/segredo-financeiro.pdf';

    try {
      const response = await GET(requestFor(key), contextFor(key));
      expect(response.status).toBe(500);
      expect(JSON.stringify(errorSpy.mock.calls)).not.toContain('segredo-financeiro.pdf');
    } finally {
      errorSpy.mockRestore();
    }
  });
});
