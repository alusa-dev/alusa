import { describe, it, expect, beforeAll, vi } from 'vitest';
import { prisma } from '@alusa/lib';
vi.mock('@/prisma/client', async () => await import('../../src/prisma'));

import type { Modalidade } from '@prisma/client';
let createModalidade: (_: {
  contaId: string;
  nome: string;
  descricao?: string;
  status?: string;
}) => Promise<Modalidade>;
let updateModalidade: (_: {
  id: string;
  contaId: string;
  nome?: string;
  descricao?: string;
  status?: string;
}) => Promise<Modalidade>;
let listModalidades: (
  _contaId: string,
  _opts?: { page?: number; pageSize?: number; q?: string; status?: string },
) => Promise<{ data: Modalidade[]; page: number; pageSize: number; total: number }>;
let deleteModalidade: (_id: string, _contaId: string) => Promise<Modalidade>;

describe('modalidade.service', () => {
  const contaId = 'conta-test-modalidade';
  beforeAll(async () => {
    // garante conta
    await prisma.conta.upsert({
      where: { id: contaId },
      update: { nome: 'Conta Test Modalidade', cpfCnpj: '99999999000199' },
      create: { id: contaId, nome: 'Conta Test Modalidade', cpfCnpj: '99999999000199' },
    });
    // limpa modalidades pré-existentes dessa conta (evita conflito com seeds ou execuções anteriores)
    await prisma.modalidade.deleteMany({ where: { contaId } });
    const mod = await import('@alusa/lib');
    createModalidade = mod.createModalidade;
    updateModalidade = mod.updateModalidade;
    listModalidades = mod.listModalidades;
    deleteModalidade = mod.deleteModalidade;
  });

  it('cria modalidade', async () => {
    const m = await createModalidade({
      contaId,
      nome: 'Ballet Test',
      descricao: 'Desc',
      status: 'ATIVO',
    });
    expect(m.id).toBeTruthy();
    expect(m.nome).toBe('Ballet Test');
  });

  it('erro duplicado', async () => {
    await expect(createModalidade({ contaId, nome: 'Ballet Test' })).rejects.toThrow();
  });

  it('atualiza nome e descricao', async () => {
    const list = await listModalidades(contaId, { page: 1, pageSize: 10 });
    const first = list.data[0];
    const up = await updateModalidade({
      id: first.id,
      contaId,
      nome: 'Ballet Test 2',
      descricao: 'Nova desc',
    });
    expect(up.nome).toBe('Ballet Test 2');
  });

  it('hard delete', async () => {
    const created = await createModalidade({ contaId, nome: 'Temp Delete ' + Date.now() });
    const previous = await deleteModalidade(created.id, contaId);
    expect(previous.id).toBe(created.id);
    const check = await prisma.modalidade.findUnique({ where: { id: created.id } });
    expect(check).toBeNull();
  });
});
