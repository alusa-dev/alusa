import { describe, expect, it } from 'vitest';
import {
  DIAS_MAXIMOS_CONTRATO_EXPIRADO_REMATRICULA,
  validarDatasRematricula,
  validarElegibilidadeRematricula,
} from './rematricula-rules';

describe('validarDatasRematricula', () => {
  it('aceita nova data de início no mesmo dia civil do fim do contrato de origem, mesmo com horário diferente', () => {
    const result = validarDatasRematricula({
      dataFimContratoOrigem: new Date('2026-03-12T03:00:00.000Z'),
      novaDataInicio: new Date('2026-03-12T00:00:00.000Z'),
      novaDataFimContrato: new Date('2026-12-11T00:00:00.000Z'),
    });

    expect(result).toEqual({ success: true });
  });

  it('continua bloqueando quando a nova data de início cai em dia civil anterior ao fim do contrato de origem', () => {
    const result = validarDatasRematricula({
      dataFimContratoOrigem: new Date('2026-03-12T03:00:00.000Z'),
      novaDataInicio: new Date('2026-03-11T23:59:59.000Z'),
      novaDataFimContrato: new Date('2026-12-11T00:00:00.000Z'),
    });

    expect(result).toEqual({ success: false, error: 'DATA_INICIO_INVALIDA' });
  });

  it('continua bloqueando quando a nova data fim não é posterior à nova data de início', () => {
    const result = validarDatasRematricula({
      dataFimContratoOrigem: new Date('2026-03-12T03:00:00.000Z'),
      novaDataInicio: new Date('2026-03-12T00:00:00.000Z'),
      novaDataFimContrato: new Date('2026-03-12T00:00:00.000Z'),
    });

    expect(result).toEqual({ success: false, error: 'DATA_FIM_ANTES_INICIO' });
  });
});

describe('validarElegibilidadeRematricula', () => {
  it('aceita contrato ativo vencido recentemente dentro da janela operacional', () => {
    const result = validarElegibilidadeRematricula({
      status: 'ATIVA',
      contratoExpirado: true,
      diasContratoExpirado: 4,
    });

    expect(result).toEqual({ success: true });
  });

  it('bloqueia contrato vencido fora da janela operacional', () => {
    const result = validarElegibilidadeRematricula({
      status: 'ATIVA',
      contratoExpirado: true,
      diasContratoExpirado: DIAS_MAXIMOS_CONTRATO_EXPIRADO_REMATRICULA + 1,
    });

    expect(result).toEqual({ success: false, error: 'CONTRATO_EXPIRADO' });
  });

  it('preserva bloqueio por status mesmo dentro da janela operacional', () => {
    const result = validarElegibilidadeRematricula({
      status: 'CANCELADA',
      contratoExpirado: true,
      diasContratoExpirado: 4,
    });

    expect(result).toEqual({ success: false, error: 'STATUS_INVALIDO' });
  });

  it('preserva bloqueio de contrato expirado quando a chamada nao informa os dias', () => {
    const result = validarElegibilidadeRematricula({
      status: 'ATIVA',
      contratoExpirado: true,
    });

    expect(result).toEqual({ success: false, error: 'CONTRATO_EXPIRADO' });
  });
});
