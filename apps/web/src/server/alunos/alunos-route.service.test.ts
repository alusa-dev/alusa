import { describe, expect, it } from 'vitest';

import { prepareAlunoCreateInput } from './alunos-route.service';

describe('alunos route input normalization', () => {
  it('converte tags digitadas no wizard em uma lista normalizada', () => {
    const input = prepareAlunoCreateInput(
      {
        nome: 'Aluno E2E',
        dataNasc: '2000-01-01',
        cpf: '52998224725',
        email: 'aluno@example.com',
        telefone: '11988887777',
        tags: ' bolsista, potencial indicação, bolsista ',
      },
      'conta-e2e',
    );

    expect(input.tags).toEqual(['bolsista', 'potencial indicação', 'bolsista']);
  });

  it('preserva payloads de integração que já enviam tags como array', () => {
    const input = prepareAlunoCreateInput(
      {
        nome: 'Aluno API',
        dataNasc: '2000-01-01',
        cpf: '52998224725',
        email: 'aluno-api@example.com',
        telefone: '11988887777',
        tags: [' bolsista ', '  indicação'],
      },
      'conta-e2e',
    );

    expect(input.tags).toEqual(['bolsista', 'indicação']);
  });
});
