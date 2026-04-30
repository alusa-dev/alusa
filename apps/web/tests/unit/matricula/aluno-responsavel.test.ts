import { describe, it, expect } from 'vitest';
import { calcularIdade, alunoResponsavelSchema } from '@/lib/validations/aluno-responsavel.schema';

describe('Validações Aluno/Responsável', () => {
  describe('calcularIdade', () => {
    it('calcula idade correta para maior de idade', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 20;
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];
      const idade = calcularIdade(dataNasc!);
      expect(idade).toBe(20);
    });

    it('calcula idade correta para menor de idade', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 15;
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];
      const idade = calcularIdade(dataNasc!);
      expect(idade).toBe(15);
    });

    it('ajusta idade se aniversário ainda não chegou no ano', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 18;
      const mes = dataHoje.getMonth() + 2; // 2 meses à frente
      const dia = dataHoje.getDate();
      const dataNasc = new Date(ano, mes, dia).toISOString().split('T')[0];
      const idade = calcularIdade(dataNasc!);
      expect(idade).toBe(17); // ainda não fez 18
    });
  });

  describe('Schema de validação', () => {
    it('aceita aluno maior de idade sem responsável (com CPF)', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 20;
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = alunoResponsavelSchema.safeParse({
        aluno: {
          nome: 'João Silva',
          dataNasc,
          email: 'joao@example.com',
          cpf: '390.533.447-05', // CPF válido obrigatório para maior
        },
        adicionarResponsavel: false,
      });

      expect(result.success).toBe(true);
    });

    it('rejeita aluno maior de idade sem CPF', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 20;
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = alunoResponsavelSchema.safeParse({
        aluno: {
          nome: 'João Silva',
          dataNasc,
          email: 'joao@example.com',
          // Sem CPF
        },
        adicionarResponsavel: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some(i => i.message.includes('CPF'))).toBe(true);
      }
    });

    it('rejeita aluno menor de idade sem responsável', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 15;
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = alunoResponsavelSchema.safeParse({
        aluno: {
          nome: 'Maria Silva',
          dataNasc,
        },
        adicionarResponsavel: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('Responsável obrigatório');
      }
    });

    it('aceita aluno menor de idade com responsável válido', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 15;
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = alunoResponsavelSchema.safeParse({
        aluno: {
          nome: 'Maria Silva',
          dataNasc,
        },
        responsavel: {
          nome: 'José Silva',
          cpf: '390.533.447-05',
          telefone: '(11) 98765-4321',
          financeiro: true,
        },
        adicionarResponsavel: false,
      });

      expect(result.success).toBe(true);
    });

    it('rejeita CPF inválido do aluno', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 20;
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = alunoResponsavelSchema.safeParse({
        aluno: {
          nome: 'João Silva',
          dataNasc,
          cpf: '111.111.111-11', // CPF inválido
        },
        adicionarResponsavel: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message === 'CPF inválido')).toBe(true);
      }
    });

    it('aceita CPF válido do aluno', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 20;
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = alunoResponsavelSchema.safeParse({
        aluno: {
          nome: 'João Silva',
          dataNasc,
          cpf: '390.533.447-05', // CPF válido
        },
        adicionarResponsavel: false,
      });

      expect(result.success).toBe(true);
    });

    it('rejeita nome muito curto', () => {
      const dataHoje = new Date();
      const ano = dataHoje.getFullYear() - 20;
      const dataNasc = new Date(ano, 0, 1).toISOString().split('T')[0];

      const result = alunoResponsavelSchema.safeParse({
        aluno: {
          nome: 'AB', // menos de 3 caracteres
          dataNasc,
        },
        adicionarResponsavel: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toContain('pelo menos 3 caracteres');
      }
    });

    it('rejeita data de nascimento futura', () => {
      const futuro = new Date();
      futuro.setFullYear(futuro.getFullYear() + 1);
      const dataNasc = futuro.toISOString().split('T')[0];

      const result = alunoResponsavelSchema.safeParse({
        aluno: {
          nome: 'João Silva',
          dataNasc,
        },
        adicionarResponsavel: false,
      });

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues.some((i) => i.message === 'Data não pode ser futura')).toBe(
          true,
        );
      }
    });
  });
});
