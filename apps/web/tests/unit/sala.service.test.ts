import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@alusa/lib';
import type { Sala } from '@prisma/client';

let createSala: (_: {
  contaId: string;
  nome: string;
  descricao?: string;
  capacidade: number;
  status?: 'ATIVO' | 'INATIVO';
}) => Promise<Sala>;
let updateSala: (_: {
  id: string;
  contaId: string;
  nome?: string;
  descricao?: string;
  capacidade?: number;
  status?: 'ATIVO' | 'INATIVO';
}) => Promise<Sala>;
let listSalas: (
  _contaId: string,
  _opts?: { page?: number; pageSize?: number; q?: string; status?: 'ATIVO' | 'INATIVO' },
) => Promise<{ data: Sala[]; page: number; pageSize: number; total: number }>;
let deleteSala: (_id: string, _contaId: string) => Promise<Sala>;

const contaId = 'conta-default';

describe('sala.service', () => {
  beforeAll(async () => {
    await prisma.conta.upsert({
      where: { id: contaId },
      update: { nome: 'Conta Teste', cpfCnpj: '11111111111111' },
      create: { id: contaId, nome: 'Conta Teste', cpfCnpj: '11111111111111' },
    });
    const mod = await import('@alusa/lib');
    createSala = mod.createSala;
    updateSala = mod.updateSala;
    listSalas = mod.listSalas;
    deleteSala = mod.deleteSala;
  });

  it('cria sala', async () => {
    const sala = await createSala({ contaId, nome: 'Sala Teste ' + Date.now(), capacidade: 10 });
    expect(sala.id).toBeTruthy();
    expect(sala.capacidade).toBe(10);
  });

  it('erro nome duplicado', async () => {
    const nome = 'Sala Duplicada ' + Date.now();
    await createSala({ contaId, nome, capacidade: 5 });
    await expect(createSala({ contaId, nome, capacidade: 8 })).rejects.toThrow(
      'Já existe uma sala',
    );
  });

  it('erro capacidade inválida', async () => {
    await expect(
      createSala({ contaId, nome: 'Sala Cap Invalida ' + Date.now(), capacidade: 0 }),
    ).rejects.toThrow();
  });

  it('atualiza sala', async () => {
    const base = await createSala({ contaId, nome: 'Sala Update ' + Date.now(), capacidade: 10 });
    const upd = await updateSala({
      id: base.id,
      contaId,
      nome: base.nome + ' X',
      capacidade: 20,
      status: 'INATIVO',
    });
    expect(upd.capacidade).toBe(20);
    expect(upd.status).toBe('INATIVO');
  });

  it('hard delete remove registro', async () => {
    const s = await createSala({ contaId, nome: 'Sala Delete ' + Date.now(), capacidade: 5 });
    const previous = await deleteSala(s.id, contaId);
    expect(previous.id).toBe(s.id);
    const check = await prisma.sala.findUnique({ where: { id: s.id } });
    expect(check).toBeNull();
  });

  it('lista com paginação', async () => {
    const result = await listSalas(contaId, { page: 1, pageSize: 5 });
    expect(result.page).toBe(1);
    expect(result.pageSize).toBe(5);
    expect(Array.isArray(result.data)).toBe(true);
  });
});
