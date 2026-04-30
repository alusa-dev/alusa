import { describe, it, expect, beforeAll } from 'vitest';
import { prisma } from '@alusa/lib';
import { createTurma } from '@alusa/lib';

const contaId = 'conta-test-turma-prof';
let modalidadeId: string;
let salaId: string;
let colaboradorProfessorId: string;
const colaboradorFoto = 'https://cdn.example.com/fotos/professor-teste.jpg';
const colaboradorEspecialidades = 'Balé Infantil,Alongamento';

beforeAll(async () => {
  await prisma.conta.upsert({
    where: { id: contaId },
    update: { nome: 'Conta Teste Turma Professores', cpfCnpj: '12345678900022' },
    create: { id: contaId, nome: 'Conta Teste Turma Professores', cpfCnpj: '12345678900022' },
  });
  let mod = await prisma.modalidade.findFirst({ where: { contaId, nome: 'ModProf' } });
  if (!mod)
    mod = await prisma.modalidade.create({ data: { contaId, nome: 'ModProf', status: 'ATIVO' } });
  let sala = await prisma.sala.findFirst({ where: { contaId, nome: 'SalaProf' } });
  if (!sala)
    sala = await prisma.sala.create({
      data: { contaId, nome: 'SalaProf', capacidade: 20, status: 'ATIVO' },
    });
  modalidadeId = mod.id;
  salaId = sala.id;
  const cpf = Math.floor(10_000_000_000 + Math.random() * 89_999_999_999)
    .toString()
    .slice(0, 11);
  const email = `prof.teste+${Math.random().toString(36).slice(2, 7)}@example.com`;
  const colaborador = await prisma.colaborador.create({
    data: {
      contaId,
      nome: 'Professor Teste',
      nomeSocial: 'Prof. Teste',
      foto: colaboradorFoto,
      dataNasc: new Date('1990-01-01'),
      cpf,
      email,
      telefone1: '11999999999',
      cargo: 'PROFESSOR',
      status: 'ATIVO',
      especialidade: colaboradorEspecialidades,
      enderecoCep: '01001000',
      enderecoLogradouro: 'Praça da Sé',
      enderecoNumero: '123',
      enderecoBairro: 'Sé',
      enderecoCidade: 'São Paulo',
      enderecoUf: 'SP',
    },
  });
  colaboradorProfessorId = colaborador.id;
});

describe('createTurma com professores', () => {
  function base(dia: 'SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB' | 'DOM' = 'SEG') {
    const randHour = 8 + Math.floor(Math.random() * 6); // 8..13
    const ini = String(randHour).padStart(2, '0') + ':00';
    const fim = String(randHour + 1).padStart(2, '0') + ':00';
    return {
      contaId,
      nome: 'TurmaProf ' + Math.random().toString(36).slice(2, 7),
      modalidadeId,
      salaId,
      diasSemana: [dia] as ('SEG' | 'TER' | 'QUA' | 'QUI' | 'SEX' | 'SAB' | 'DOM')[],
      horaInicio: ini,
      horaFim: fim,
      capacidade: 15,
      status: 'ATIVO' as const,
    };
  }
  it('cria turma com professor válido', async () => {
    const t = await createTurma({ ...base('SEG'), professoresIds: [colaboradorProfessorId] });
    expect(t.id).toBeTruthy();
    const relacoes = await prisma.turmaProfessor.findMany({ where: { turmaId: t.id } });
    expect(relacoes).toHaveLength(1);
    const professor = await prisma.professor.findUnique({
      where: { id: relacoes[0]!.professorId },
    });
    expect(professor?.contaId).toBe(contaId);
    expect(professor?.telefoneCel).toBe('11999999999');
    expect(professor?.foto).toBe(colaboradorFoto);
    expect(professor?.especialidades).toEqual(
      colaboradorEspecialidades.split(',').map((value) => value.trim()),
    );
    expect(professor?.cep).toBe('01001000');
    expect(professor?.logradouro).toBe('Praça da Sé');
    expect(professor?.numero).toBe('123');
    expect(professor?.bairro).toBe('Sé');
    expect(professor?.cidade).toBe('São Paulo');
    expect(professor?.uf).toBe('SP');
  });
  it('falha com professor inexistente (cuid válido mas não encontrado)', async () => {
    const fakeCuid = 'cl' + Math.random().toString(36).slice(2, 24); // formato aproximado
    await expect(createTurma({ ...base('TER'), professoresIds: [fakeCuid] })).rejects.toThrow(
      /Professor|inválido/,
    );
  });
});
