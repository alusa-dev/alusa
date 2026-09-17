import { describe, expect, it } from 'vitest';

import {
  eligibleEventStudentsQueryDTOSchema,
  eventParticipantPatchInputDTOSchema,
} from '@/features/events/dtos';

describe('DTOs de participantes de eventos', () => {
  it('valida atualização parcial de inscrição e mantém campos suportados', () => {
    expect(
      eventParticipantPatchInputDTOSchema.parse({
        isFeePaid: true,
        costumes: [{ id: 'costume-1', status: 'DELIVERED' }],
        ignored: 'legacy-field',
      }),
    ).toEqual({
      isFeePaid: true,
      costumes: [{ id: 'costume-1', status: 'DELIVERED' }],
    });
  });

  it('normaliza a consulta de alunos elegíveis', () => {
    expect(
      eligibleEventStudentsQueryDTOSchema.parse({
        anchorAlunoId: 'aluno-1',
        responsavelId: 'resp-1',
        q: 'Ana',
      }),
    ).toEqual({ anchorAlunoId: 'aluno-1', responsavelId: 'resp-1', q: 'Ana' });
  });
});
