import { describe, expect, it } from 'vitest';
import { StatusMatricula } from '@prisma/client';

import {
  canEditStructural,
  canTransition,
  getTerminalStatuses,
  isTerminalStatus,
  occupiesSeat,
  validateTransition,
} from './matricula-state-machine';

describe('matricula-state-machine', () => {
  it('trata ENCERRADA como terminal sem ocupar vaga', () => {
    expect(isTerminalStatus(StatusMatricula.ENCERRADA)).toBe(true);
    expect(getTerminalStatuses()).toContain(StatusMatricula.ENCERRADA);
    expect(occupiesSeat(StatusMatricula.ENCERRADA)).toBe(false);
    expect(canEditStructural(StatusMatricula.ENCERRADA)).toBe(false);
  });

  it('permite encerramento natural a partir dos estados operacionais', () => {
    expect(canTransition(StatusMatricula.ATIVA, StatusMatricula.ENCERRADA)).toBe(true);
    expect(canTransition(StatusMatricula.PAUSADA, StatusMatricula.ENCERRADA)).toBe(true);
    expect(canTransition(StatusMatricula.AGUARDANDO_CONFIRMACAO, StatusMatricula.ENCERRADA)).toBe(true);
  });

  it('bloqueia transicoes saindo de ENCERRADA', () => {
    expect(validateTransition(StatusMatricula.ENCERRADA, StatusMatricula.ATIVA)).toEqual({
      success: false,
      error: 'STATUS_TERMINAL',
      from: StatusMatricula.ENCERRADA,
    });
  });
});
