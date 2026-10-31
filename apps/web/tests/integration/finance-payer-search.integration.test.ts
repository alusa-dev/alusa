import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, describe, expect, it } from 'vitest';
import { resolvePayerFromAluno } from '@alusa/finance';
import { searchFinancePayers } from '@/features/billing/server/finance-payers-search.service';

const prisma = new PrismaClient();
afterAll(async () => prisma.$disconnect());

describe('finance payer search SQL integration', () => {
  it('normalizes accents and whitespace, matches CPF digits, ranks exact names before >50 substrings, and scopes contaId', async () => {
    const db = prisma;
    const suffix = randomUUID().replaceAll('-', '');
    const contaA = `payer_search_a_${suffix}`;
    const contaB = `payer_search_b_${suffix}`;
    await db.conta.createMany({ data: [{ id: contaA, nome: 'Payer search A' }, { id: contaB, nome: 'Payer search B' }] });
    try {
      await db.responsavel.createMany({ data: [
        { id: `parent_a_${suffix}`, contaId: contaA, nome: 'Zoë Parent', cpf: `111${suffix.slice(0, 8)}`, email: `parent-a-${suffix}@example.test`, telefone: '11999999999', financeiro: false },
        { id: `parent_b_${suffix}`, contaId: contaB, nome: 'Zoë Parent', cpf: `222${suffix.slice(0, 8)}`, email: `parent-b-${suffix}@example.test`, telefone: '11999999998', financeiro: false },
      ] });
      await db.aluno.createMany({ data: [
        ...Array.from({ length: 60 }, (_, index) => ({
          id: `substring_${suffix}_${index}`, contaId: contaA, nome: `A${index} Lexa Student`, dataNasc: new Date('2000-01-01'),
        })),
        { id: `exact_${suffix}`, contaId: contaA, nome: 'Lexa', dataNasc: new Date('2000-01-01'), cpf: '98765432100' },
        { id: `numeric_noise_${suffix}`, contaId: contaA, nome: 'Completely Different', dataNasc: new Date('2000-01-01'), cpf: '00000000002' },
        { id: `accent_${suffix}`, contaId: contaA, nome: '  Émília   Silva  ', dataNasc: new Date('2000-01-01') },
        { id: `other_${suffix}`, contaId: contaB, nome: 'Lexa', dataNasc: new Date('2000-01-01') },
        { id: `linked_a_${suffix}`, contaId: contaA, nome: 'Linked A', dataNasc: new Date('2010-01-01') },
        { id: `linked_b_${suffix}`, contaId: contaB, nome: 'Linked B', dataNasc: new Date('2010-01-01') },
        { id: `malformed_${suffix}`, contaId: contaA, nome: 'Malformed Link Student', dataNasc: new Date('2010-01-01') },
      ] });
      await db.alunoResponsavel.createMany({ data: [
        { id: `link_a_${suffix}`, contaId: contaA, alunoId: `linked_a_${suffix}`, responsavelId: `parent_a_${suffix}`, tipoVinculo: 'FINANCEIRO' },
        { id: `link_b_${suffix}`, contaId: contaB, alunoId: `linked_b_${suffix}`, responsavelId: `parent_b_${suffix}`, tipoVinculo: 'FINANCEIRO' },
        { id: `link_malformed_${suffix}`, contaId: contaA, alunoId: `malformed_${suffix}`, responsavelId: `parent_b_${suffix}`, tipoVinculo: 'FINANCEIRO' },
      ] });

      const ranked = await searchFinancePayers(contaA, 'lexa');
      expect(ranked.results[0]).toMatchObject({ id: `exact_${suffix}`, name: 'Lexa' });
      expect(ranked.results.every((item) => item.id !== `other_${suffix}`)).toBe(true);

      const accented = await searchFinancePayers(contaA, 'emilia silva');
      expect(accented.results.some((item) => item.id === `accent_${suffix}`)).toBe(true);

      const cpf = await searchFinancePayers(contaA, '54321');
      expect(cpf.results.some((item) => item.id === `exact_${suffix}`)).toBe(true);
      const mixedNameAndDigit = await searchFinancePayers(contaA, 'lexa 2');
      expect(mixedNameAndDigit.results.some((item) => item.id === `numeric_noise_${suffix}`)).toBe(false);

      const linkedResponsible = await searchFinancePayers(contaA, 'zoe parent');
      expect(linkedResponsible.results.some((item) => item.id === `parent_a_${suffix}`)).toBe(true);
      expect(linkedResponsible.results.some((item) => item.id === `parent_b_${suffix}` || item.id === `linked_b_${suffix}`)).toBe(false);

      const malformedSearch = await searchFinancePayers(contaA, 'Malformed Link', { sales: true });
      expect(malformedSearch.results).toContainEqual(expect.objectContaining({
        id: `malformed_${suffix}`, type: 'aluno', responsibleId: null,
        payerResolved: expect.objectContaining({ type: 'aluno', id: `malformed_${suffix}` }),
      }));
      const resolved = await resolvePayerFromAluno({ contaId: contaA, alunoId: `malformed_${suffix}` });
      expect(resolved).toMatchObject({ success: false, code: 'RESPONSAVEL_OBRIGATORIO_MENOR' });
    } finally {
      await db.alunoResponsavel.deleteMany({ where: { contaId: { in: [contaA, contaB] } } });
      await db.aluno.deleteMany({ where: { contaId: { in: [contaA, contaB] } } });
      await db.responsavel.deleteMany({ where: { contaId: { in: [contaA, contaB] } } });
      await db.conta.deleteMany({ where: { id: { in: [contaA, contaB] } } });
    }
  });
});
