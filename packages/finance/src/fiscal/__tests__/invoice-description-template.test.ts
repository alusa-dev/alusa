import { describe, expect, it } from 'vitest';

import { buildInvoiceDescriptionFromTemplate } from '../invoice-description-template';

describe('buildInvoiceDescriptionFromTemplate', () => {
  it('substitui variáveis educacionais', () => {
    const result = buildInvoiceDescriptionFromTemplate(
      'Serviços — {aluno} — {competencia} — turma {turma}',
      { aluno: 'Maria', competencia: '03/2026', turma: 'Ballet' },
    );
    expect(result).toBe('Serviços — Maria — 03/2026 — turma Ballet');
  });

  it('remove placeholders vazios e competência sem valor', () => {
    const result = buildInvoiceDescriptionFromTemplate(
      'Serviços educacionais — {aluno} — competência {competencia}',
      {},
    );
    expect(result).toBe('Serviços educacionais');
  });

  it('remove segmentos vazios entre travessões', () => {
    const result = buildInvoiceDescriptionFromTemplate(
      'Serviços educacionais — {aluno} — competência {competencia}',
      { aluno: 'Ingresso VIP' },
    );
    expect(result).toBe('Serviços educacionais — Ingresso VIP');
  });
});
