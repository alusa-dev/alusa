import { describe, expect, it } from 'vitest';

import { alunoSchema } from '../../../../prisma/zod/aluno';

describe('Aluno Wizard Schema', () => {
  it('permite aluno menor sem cpf, email e telefone quando houver responsável existente', () => {
    const result = alunoSchema.safeParse({
      contaId: 'conta-test',
      nome: 'Aluno Menor',
      dataNasc: '2015-05-15',
      enderecoCep: '01001-000',
      responsavelModo: 'existente',
      responsavelExistenteId: 'resp_1',
      status: 'ATIVO',
    });

    expect(result.success).toBe(true);
  });

  it('exige email e telefone para maior de idade', () => {
    const result = alunoSchema.safeParse({
      contaId: 'conta-test',
      nome: 'Aluno Maior',
      dataNasc: '2000-05-15',
      enderecoCep: '01001-000',
      cpf: '529.982.247-25',
      status: 'ATIVO',
    });

    expect(result.success).toBe(false);

    if (!result.success) {
      const fields = result.error.issues.map((issue) => issue.path.join('.'));
      expect(fields).toContain('email');
      expect(fields).toContain('telefone');
    }
  });
});