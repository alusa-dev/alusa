import { describe, expect, it } from 'vitest';

import {
  rematriculaProcessCommunicationInputDTOSchema,
  rematriculaProcessExceptionInputDTOSchema,
  rematriculaProcessRouteParamsDTOSchema,
} from '@/features/cadastro/rematriculas/dtos';

describe('DTOs de governança de rematrícula', () => {
  it('valida parâmetros e comunicação com os campos canônicos', () => {
    expect(
      rematriculaProcessRouteParamsDTOSchema.parse({ id: 'process-1' }),
    ).toEqual({ id: 'process-1' });
    expect(
      rematriculaProcessCommunicationInputDTOSchema.parse({
        channel: 'EMAIL',
        audience: 'responsaveis',
        message: 'Sua rematrícula está pronta.',
      }),
    ).toMatchObject({ channel: 'EMAIL', audience: 'responsaveis' });
  });

  it('rejeita exceção sem justificativa suficiente', () => {
    expect(() =>
      rematriculaProcessExceptionInputDTOSchema.parse({
        permission: 'renewal.override',
        rule: 'financial_block',
        impact: 'allow',
        justification: 'curta',
      }),
    ).toThrow();
  });
});
