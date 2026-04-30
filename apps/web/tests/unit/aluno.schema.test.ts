import { describe, it, expect } from 'vitest';
import { alunoCreateSchema, formatZodErrors } from '@alusa/lib';

describe('Aluno Schema Validation', () => {
  const contaId = 'conta-test';

  describe('Menor de idade (< 18 anos)', () => {
    it('valida aluno menor SEM CPF quando responsável está completo', () => {
      const data = {
        contaId,
        nome: 'Aluno Menor',
        dataNasc: new Date('2015-05-15'), // < 18 anos
        // CPF do aluno ausente
        responsavel: {
          nome: 'Responsável Completo',
          cpf: '52998224725',
          email: 'resp@example.com',
          telefone: '11999999999',
        },
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejeita aluno menor SEM responsável', () => {
      const data = {
        contaId,
        nome: 'Aluno Menor',
        dataNasc: new Date('2015-05-15'), // < 18 anos
        // Sem responsável
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = formatZodErrors(result.error.issues);
        const respError = errors.find(e => e.field === 'responsavel');
        expect(respError).toBeDefined();
        expect(respError?.message).toContain('obrigatório');
      }
    });

    it('rejeita aluno menor com responsável SEM CPF', () => {
      const data = {
        contaId,
        nome: 'Aluno Menor',
        dataNasc: new Date('2015-05-15'), // < 18 anos
        responsavel: {
          nome: 'Responsável Sem CPF',
          // CPF ausente
          email: 'resp@example.com',
          telefone: '11999999999',
        },
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = formatZodErrors(result.error.issues);
        const cpfError = errors.find(e => e.field.includes('responsavel') && e.field.includes('cpf'));
        expect(cpfError).toBeDefined();
      }
    });

    it('rejeita aluno menor com responsável SEM email', () => {
      const data = {
        contaId,
        nome: 'Aluno Menor',
        dataNasc: new Date('2015-05-15'),
        responsavel: {
          nome: 'Responsável Sem Email',
          cpf: '52998224725',
          // email ausente
          telefone: '11999999999',
        },
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejeita aluno menor com responsável SEM telefone', () => {
      const data = {
        contaId,
        nome: 'Aluno Menor',
        dataNasc: new Date('2015-05-15'),
        responsavel: {
          nome: 'Responsável Sem Tel',
          cpf: '52998224725',
          email: 'resp@example.com',
          // telefone ausente
        },
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });
  });

  describe('Maior de idade (>= 18 anos)', () => {
    it('valida aluno maior COM CPF (sem responsável)', () => {
      const data = {
        contaId,
        nome: 'Aluno Maior',
        cpf: '52998224725',
        dataNasc: new Date('2000-01-01'), // >= 18 anos
        // Responsável opcional
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('rejeita aluno maior SEM CPF', () => {
      const data = {
        contaId,
        nome: 'Aluno Maior',
        dataNasc: new Date('2000-01-01'), // >= 18 anos
        // CPF ausente
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
      if (!result.success) {
        const errors = formatZodErrors(result.error.issues);
        const cpfError = errors.find(e => e.field === 'cpf');
        expect(cpfError).toBeDefined();
        expect(cpfError?.message).toContain('CPF obrigatório');
      }
    });

    it('valida aluno maior COM responsável opcional', () => {
      const data = {
        contaId,
        nome: 'Aluno Maior',
        cpf: '52998224725',
        dataNasc: new Date('2000-01-01'), // >= 18 anos
        responsavel: {
          nome: 'Responsável Opcional',
          cpf: '11144477735',
          email: 'resp@example.com',
          telefone: '11988888888',
        },
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('Endereço opcional', () => {
    it('valida aluno SEM endereço', () => {
      const data = {
        contaId,
        nome: 'Aluno Sem Endereco',
        cpf: '52998224725',
        dataNasc: new Date('2000-01-01'),
        // endereco ausente
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('valida aluno com endereço parcial', () => {
      const data = {
        contaId,
        nome: 'Aluno End Parcial',
        cpf: '52998224725',
        dataNasc: new Date('2000-01-01'),
        endereco: {
          cep: '01001000',
          // outros campos ausentes
        },
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });

    it('valida aluno com endereço completo', () => {
      const data = {
        contaId,
        nome: 'Aluno End Completo',
        cpf: '52998224725',
        dataNasc: new Date('2000-01-01'),
        endereco: {
          cep: '01001000',
          logradouro: 'Praça da Sé',
          numero: '123',
          bairro: 'Sé',
          cidade: 'São Paulo',
          uf: 'SP',
        },
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });

  describe('Normalização de inputs', () => {
    it('normaliza CPF com máscara para apenas dígitos', () => {
      const data = {
        contaId,
        nome: 'Aluno CPF Mascarado',
        cpf: '529.982.247-25', // com máscara
        dataNasc: new Date('2000-01-01'),
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.cpf).toBe('52998224725');
      }
    });

    it('normaliza telefone com máscara para apenas dígitos', () => {
      const data = {
        contaId,
        nome: 'Aluno Tel Mascarado',
        cpf: '52998224725',
        dataNasc: new Date('2000-01-01'),
        telefone: '(11) 99999-9999', // com máscara
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.telefone).toBe('11999999999');
      }
    });

    it('converte string vazia para undefined', () => {
      const data = {
        contaId,
        nome: 'Aluno Vazio',
        cpf: '52998224725',
        dataNasc: new Date('2000-01-01'),
        nomeSocial: '', // string vazia
        observacao: '', // string vazia
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.nomeSocial).toBeUndefined();
        expect(result.data.observacao).toBeUndefined();
      }
    });
  });

  describe('Validação de CPF', () => {
    it('rejeita CPF inválido (dígitos verificadores incorretos)', () => {
      const data = {
        contaId,
        nome: 'Aluno CPF Invalido',
        cpf: '12345678900', // CPF inválido
        dataNasc: new Date('2000-01-01'),
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('rejeita CPF com sequência repetida', () => {
      const data = {
        contaId,
        nome: 'Aluno CPF Repetido',
        cpf: '11111111111', // Sequência repetida
        dataNasc: new Date('2000-01-01'),
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(false);
    });

    it('aceita CPF válido', () => {
      const data = {
        contaId,
        nome: 'Aluno CPF Valido',
        cpf: '52998224725', // CPF válido
        dataNasc: new Date('2000-01-01'),
      };

      const result = alunoCreateSchema.safeParse(data);
      expect(result.success).toBe(true);
    });
  });
});
