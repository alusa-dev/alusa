/**
 * @vitest-environment node
 */

import { describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';

import { AulasError } from '@/src/server/aulas/aulas-error';
import { handleAulasRouteError, json } from '@/src/server/aulas/route-utils';

describe('AulasError', () => {
  it('mapeia código para status HTTP correto', () => {
    const notFound = new AulasError('EVENTO_NAO_ENCONTRADO', 'not found');
    expect(notFound.statusCode).toBe(404);
    expect(notFound.code).toBe('EVENTO_NAO_ENCONTRADO');

    const conflict = new AulasError('CONFLITO_SALA_PROFESSOR', 'conflict');
    expect(conflict.statusCode).toBe(409);

    const unprocessable = new AulasError('FREQUENCIA_DIA_INVALIDO', 'invalid');
    expect(unprocessable.statusCode).toBe(422);

    const expiredWindow = new AulasError('FREQUENCIA_FORA_DA_JANELA', 'expired');
    expect(expiredWindow.statusCode).toBe(422);

    const forbidden = new AulasError('PROFESSOR_NAO_VINCULADO', 'forbidden');
    expect(forbidden.statusCode).toBe(403);
  });

  it('preserva details opcionais', () => {
    const error = new AulasError('CONFLITO_SALA_PROFESSOR', 'conflict', { salaId: 's1' });
    expect(error.details).toEqual({ salaId: 's1' });
  });

  it('funciona sem details', () => {
    const error = new AulasError('TURMA_NAO_ENCONTRADA', 'turma missing');
    expect(error.details).toBeUndefined();
  });
});

describe('handleAulasRouteError', () => {
  it('retorna 422 para ZodError', async () => {
    const zodError = new ZodError([
      { code: 'invalid_type', expected: 'string', received: 'number', path: ['field'], message: 'Expected string' },
    ]);
    const response = handleAulasRouteError(zodError, 'FALLBACK');
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.error).toBe('VALIDACAO_INVALIDA');
    expect(body.details).toBeDefined();
  });

  it('retorna status correto para AulasError', async () => {
    const error = new AulasError('REPOSICAO_NAO_ENCONTRADA', 'not found');
    const response = handleAulasRouteError(error, 'FALLBACK');
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toBe('REPOSICAO_NAO_ENCONTRADA');
    expect(body.detail).toBe('not found');
  });

  it('inclui details quando AulasError possui', async () => {
    const error = new AulasError('CONFLITO_SALA_PROFESSOR', 'conflict', { salaId: 's1', professorId: 'p1' });
    const response = handleAulasRouteError(error, 'FALLBACK');
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.details).toEqual({ salaId: 's1', professorId: 'p1' });
  });

  it('retorna 500 com fallback code para erros genéricos', async () => {
    const error = new Error('something broke');
    const response = handleAulasRouteError(error, 'ERRO_INTERNO_CUSTOM');
    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toBe('ERRO_INTERNO_CUSTOM');
    expect(body.detail).toBe('something broke');
  });
});

describe('json (route-utils)', () => {
  it('retorna status e no-store cache control', async () => {
    const response = json(201, { ok: true });
    expect(response.status).toBe(201);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toEqual({ ok: true });
  });
});

describe('resolveAulasAccessScope', () => {
  it('retorna scope sem professor para role ADMIN', async () => {
    vi.mock('@/src/prisma', () => ({
      prisma: {
        professor: {
          findFirst: vi.fn(),
        },
      },
    }));

    const { resolveAulasAccessScope } = await import('@/src/server/aulas/session');

    const scope = await resolveAulasAccessScope({
      id: 'user-1',
      contaId: 'conta-1',
      role: 'ADMIN',
      email: 'admin@test.com',
    });

    expect(scope.isProfessor).toBe(false);
    expect(scope.professorId).toBeNull();
    expect(scope.professorLabel).toBeNull();
    expect(scope.contaId).toBe('conta-1');
    expect(scope.userId).toBe('user-1');
    expect(scope.role).toBe('ADMIN');
  });

  it('resolve professor pelo email quando role é PROFESSOR', async () => {
    const { prisma } = await import('@/src/prisma');
    vi.mocked(prisma.professor.findFirst).mockResolvedValueOnce({
      id: 'prof-99',
      nome: 'Prof. Teste',
    } as never);

    const { resolveAulasAccessScope } = await import('@/src/server/aulas/session');

    const scope = await resolveAulasAccessScope({
      id: 'user-2',
      contaId: 'conta-1',
      role: 'PROFESSOR',
      email: 'prof@escola.com',
    });

    expect(scope.isProfessor).toBe(true);
    expect(scope.professorId).toBe('prof-99');
    expect(scope.professorLabel).toBe('Prof. Teste');
    expect(prisma.professor.findFirst).toHaveBeenCalledWith({
      where: {
        contaId: 'conta-1',
        status: 'ATIVO',
        email: { equals: 'prof@escola.com', mode: 'insensitive' },
      },
      select: { id: true, nome: true },
    });
  });

  it('retorna professorId null quando professor não encontrado', async () => {
    const { prisma } = await import('@/src/prisma');
    vi.mocked(prisma.professor.findFirst).mockResolvedValueOnce(null);

    const { resolveAulasAccessScope } = await import('@/src/server/aulas/session');

    const scope = await resolveAulasAccessScope({
      id: 'user-3',
      contaId: 'conta-1',
      role: 'PROFESSOR',
      email: 'nobody@escola.com',
    });

    expect(scope.isProfessor).toBe(true);
    expect(scope.professorId).toBeNull();
    expect(scope.professorLabel).toBe('nobody@escola.com');
  });
});
