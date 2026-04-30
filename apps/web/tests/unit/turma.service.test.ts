import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@alusa/lib';
import { createTurma } from '@alusa/lib';

const contaId = 'conta-test-turma';
let modalidadeId: string;
let salaId: string;

beforeAll(async () => {
  await prisma.conta.upsert({
    where: { id: contaId },
    update: { nome: 'Conta Teste CRUD Turma', cpfCnpj: '12345678900011' },
    create: { id: contaId, nome: 'Conta Teste CRUD Turma', cpfCnpj: '12345678900011' },
  });
  let mod = await prisma.modalidade.findFirst({ where: { contaId, nome: 'Teste' } });
  if (mod) {
    mod = await prisma.modalidade.update({ where: { id: mod.id }, data: { status: 'ATIVO' } });
  } else {
    mod = await prisma.modalidade.create({ data: { contaId, nome: 'Teste', status: 'ATIVO' } });
  }
  let sala = await prisma.sala.findFirst({ where: { contaId, nome: 'Sala T1' } });
  if (sala) {
    sala = await prisma.sala.update({
      where: { id: sala.id },
      data: { status: 'ATIVO', capacidade: sala.capacidade || 10 },
    });
  } else {
    sala = await prisma.sala.create({
      data: { contaId, nome: 'Sala T1', status: 'ATIVO', capacidade: 10 },
    });
  }
  modalidadeId = mod.id;
  salaId = sala.id;
  await prisma.turma.deleteMany({ where: { contaId } });
});

function base() {
  return {
    contaId,
    nome: 'Turma Alpha',
    modalidadeId,
    salaId,
    diasSemana: ['SEG'] as ('SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB')[],
    horaInicio: '08:00',
    horaFim: '09:00',
    capacidade: 10,
    status: 'ATIVO' as const,
  } as const;
}

describe('turma.service createTurma', () => {
  it('cria caso feliz', async () => {
    const t = await createTurma({ ...base(), nome: 'Turma Feliz', diasSemana: ['SEG', 'QUA'] });
    expect(t.id).toBeTruthy();
  });
  it('rejeita nome duplicado na mesma conta', async () => {
    await createTurma({ ...base(), nome: 'Duplicada', horaInicio: '12:00', horaFim: '13:00' });
    await expect(
      createTurma({ ...base(), nome: 'Duplicada', horaInicio: '14:00', horaFim: '15:00' }),
    ).rejects.toThrow(/já existe/i);
  });
  it('rejeita conflito de horário na mesma sala e dia', async () => {
    await createTurma({
      ...base(),
      nome: 'Manha1',
      horaInicio: '10:00',
      horaFim: '11:00',
      diasSemana: ['TER'],
    });
    await expect(
      createTurma({
        ...base(),
        nome: 'Manha2',
        horaInicio: '10:30',
        horaFim: '11:30',
        diasSemana: ['TER'],
      }),
    ).rejects.toThrow(/Conflito/);
  });
  it('rejeita hora inicio >= fim', async () => {
    await expect(
      createTurma({ ...base(), nome: 'HorarioInvalido', horaInicio: '09:00', horaFim: '09:00' }),
    ).rejects.toThrow(/início.*antes/i);
  });
  it('aceita idadeMin <= idadeMax e rejeita inverso', async () => {
    const ok = await createTurma({
      ...base(),
      nome: 'FaixaEtaria',
      idadeMin: 5,
      idadeMax: 10,
      horaInicio: '16:00',
      horaFim: '17:00',
    });
    expect(ok.id).toBeTruthy();
    await expect(
      createTurma({
        ...base(),
        nome: 'FaixaErrada',
        idadeMin: 12,
        idadeMax: 10,
        horaInicio: '18:00',
        horaFim: '19:00',
      }),
    ).rejects.toThrow();
  });
});
