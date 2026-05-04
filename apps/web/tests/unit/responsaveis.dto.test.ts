import { describe, expect, it } from 'vitest';

import {
  createResponsavelInputDTOSchema,
  linkAlunoResponsavelInputDTOSchema,
  listResponsaveisQueryDTOSchema,
} from '@/features/responsaveis/dtos';
import {
  mapCreateResponsavelDTOToData,
  mapListResponsaveisQueryToFilters,
  mapResponsavelRecordToSummaryDTO,
} from '@/features/responsaveis/mappers';

describe('responsaveis DTOs', () => {
  it('normaliza query de listagem', () => {
    const parsed = listResponsaveisQueryDTOSchema.parse({ q: '  Maria  ' });
    const filters = mapListResponsaveisQueryToFilters(parsed, 'conta-1');

    expect(filters).toEqual({
      contaId: 'conta-1',
      search: 'Maria',
      cpfDigits: undefined,
      take: 50,
    });
  });

  it('normaliza payload de criação', () => {
    const dto = createResponsavelInputDTOSchema.parse({
      nome: 'Maria Silva',
      cpf: '529.982.247-25',
      email: 'maria@example.com',
      telefone: '(92) 99999-9999',
      financeiro: true,
    });

    expect(mapCreateResponsavelDTOToData(dto, 'conta-1')).toEqual({
      contaId: 'conta-1',
      nome: 'Maria Silva',
      cpf: '52998224725',
      email: 'maria@example.com',
      telefone: '92999999999',
      financeiro: true,
    });
  });

  it('mapeia saída de responsável', () => {
    expect(
      mapResponsavelRecordToSummaryDTO({
        id: 'r1',
        nome: 'Maria Silva',
        cpf: '12345678909',
        email: 'maria@example.com',
        telefone: '92999999999',
        financeiro: true,
      }),
    ).toEqual({
      id: 'r1',
      nome: 'Maria Silva',
      cpf: '12345678909',
      email: 'maria@example.com',
      telefone: '92999999999',
      financeiro: true,
      alunosCount: 0,
    });
  });

  it('mantém valor default para vínculo do aluno', () => {
    const dto = linkAlunoResponsavelInputDTOSchema.parse({ responsavelId: 'resp-1' });

    expect(dto).toEqual({
      responsavelId: 'resp-1',
      tipoVinculo: 'PRINCIPAL',
    });
  });
});
