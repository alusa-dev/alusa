import { describe, expect, it } from 'vitest';

import {
  computeFiscalInvoiceKpis,
  resolveFiscalInvoiceHighlightStatus,
  resolveFiscalInvoiceNotaUrl,
  resolveFiscalInvoiceRowActions,
  resolveFiscalInvoiceServiceLabel,
  resolveFiscalInvoiceStatusLabel,
} from '../../fiscal/fiscal-invoice-display';

describe('fiscal-invoice-display', () => {
  it('calcula KPIs por conjunto de notas', () => {
    const kpis = computeFiscalInvoiceKpis([
      {
        status: 'AUTHORIZED',
        value: 100,
        effectiveDate: new Date('2026-01-10T00:00:00.000Z'),
        statusUpdatedAt: new Date('2026-01-10T00:00:00.000Z'),
      },
      {
        status: 'ERROR',
        value: 50,
        effectiveDate: null,
        statusUpdatedAt: new Date('2026-01-05T00:00:00.000Z'),
      },
      {
        status: 'SCHEDULED',
        value: 80,
        effectiveDate: new Date('2026-02-01T00:00:00.000Z'),
        statusUpdatedAt: new Date('2026-02-01T00:00:00.000Z'),
      },
    ]);

    expect(kpis.totalNotas).toBe(3);
    expect(kpis.totalEmitidas).toBe(1);
    expect(kpis.totalValor).toBe(100);
    expect(kpis.comErro).toBe(1);
    expect(kpis.pendentes).toBe(1);
    expect(kpis.ultimaNotaEm).toBe('2026-02-01T00:00:00.000Z');
  });

  it('prioriza status de destaque com erro', () => {
    expect(
      resolveFiscalInvoiceHighlightStatus([
        { status: 'AUTHORIZED', value: 1, effectiveDate: null, statusUpdatedAt: new Date() },
        { status: 'ERROR', value: 1, effectiveDate: null, statusUpdatedAt: new Date() },
      ]),
    ).toBe('ERROR');
  });

  it('resolve label amigável', () => {
    expect(resolveFiscalInvoiceStatusLabel('AUTHORIZED')).toBe('Emitida');
  });

  it('prioriza PDF ao resolver URL da nota', () => {
    expect(
      resolveFiscalInvoiceNotaUrl({
        pdfUrl: 'https://example.com/nota.pdf',
        xmlUrl: 'https://example.com/nota.xml',
      }),
    ).toBe('https://example.com/nota.pdf');
  });

  it('resolve ações da linha conforme status da nota', () => {
    expect(
      resolveFiscalInvoiceRowActions({
        status: 'AUTHORIZED',
        pdfUrl: 'https://example.com/nota.pdf',
        xmlUrl: null,
        syncPending: false,
      }),
    ).toEqual({
      canViewNota: true,
      notaUrl: 'https://example.com/nota.pdf',
      canCancel: true,
      canEdit: false,
    });

    expect(
      resolveFiscalInvoiceRowActions({
        status: 'SCHEDULED',
        pdfUrl: null,
        xmlUrl: null,
        syncPending: false,
      }),
    ).toEqual({
      canViewNota: false,
      notaUrl: null,
      canCancel: true,
      canEdit: true,
    });

    expect(
      resolveFiscalInvoiceRowActions({
        status: 'ERROR',
        pdfUrl: null,
        xmlUrl: null,
        syncPending: false,
      }),
    ).toEqual({
      canViewNota: false,
      notaUrl: null,
      canCancel: false,
      canEdit: true,
    });
  });

  it('resume serviço com plano, aluno e competência', () => {
    expect(
      resolveFiscalInvoiceServiceLabel({
        cobrancaDescricao: 'Mensalidade',
        planoNome: 'Ballet Clássico',
        turmaNome: 'Matutino',
        alunoNome: 'Bryan de Alencar Bezerra',
        competenciaInicio: new Date('2026-06-01T00:00:00.000Z'),
        competenciaFim: new Date('2026-06-01T00:00:00.000Z'),
      }),
    ).toBe('Ballet Clássico — Bryan de Alencar Bezerra — 06/2026');
  });

  it('usa descrição da cobrança quando não há matrícula', () => {
    expect(
      resolveFiscalInvoiceServiceLabel({
        cobrancaDescricao: 'Cobrança avulsa',
      }),
    ).toBe('Cobrança avulsa');
  });
});
