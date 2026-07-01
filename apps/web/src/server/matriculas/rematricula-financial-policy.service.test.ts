import { describe, expect, it } from 'vitest';
import {
  buildFinancialSnapshot,
  evaluateCanonicalRematriculaDecision,
} from './rematricula-financial-policy.service';

describe('rematricula-financial-policy.service', () => {
  it('na regra canonica libera a rematricula com aviso e segura o financeiro futuro quando houver pendencia', () => {
    const snapshot = buildFinancialSnapshot({
      cobrancas: [{ status: 'PENDENTE' }],
      statusFinanceiro: 'ADIMPLENTE',
      integrationStatus: 'SINCRONIZADO',
      debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
    });

    const decision = evaluateCanonicalRematriculaDecision({
      academicEligible: true,
      financialSnapshot: snapshot,
    });

    expect(decision.actionStatus).toBe('LIBERADA_COM_AVISO');
    expect(decision.eligibilityStatus).toBe('ELEGIVEL');
    expect(decision.shouldBlockNewFinancialCycle).toBe(true);
    expect(decision.requiresOverrideReason).toBe(false);
  });

  it('na regra canonica bloqueia apenas quando a matricula nao for academicamente elegivel', () => {
    const snapshot = buildFinancialSnapshot({
      cobrancas: [],
      statusFinanceiro: 'ADIMPLENTE',
      integrationStatus: 'SINCRONIZADO',
      debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
    });

    const decision = evaluateCanonicalRematriculaDecision({
      academicEligible: false,
      financialSnapshot: snapshot,
    });

    expect(decision.actionStatus).toBe('BLOQUEADA');
    expect(decision.eligibilityStatus).toBe('NAO_ELEGIVEL');
    expect(decision.shouldBlockNewFinancialCycle).toBe(true);
  });

  it('na regra canonica libera com aviso quando a situacao financeira estiver inconclusiva', () => {
    const snapshot = buildFinancialSnapshot({
      cobrancas: [{ status: 'PROCESSANDO' }],
      statusFinanceiro: 'PENDENTE_FINANCEIRO',
      integrationStatus: 'PENDENTE_SINCRONISMO',
      debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
    });

    const decision = evaluateCanonicalRematriculaDecision({
      academicEligible: true,
      financialSnapshot: snapshot,
    });

    expect(decision.actionStatus).toBe('LIBERADA_COM_AVISO');
    expect(decision.blockReason).toBe('AGUARDANDO_RECONCILIACAO');
    expect(decision.shouldBlockNewFinancialCycle).toBe(true);
  });

  it('classifica cobrança futura como pendência quando o escopo canônico considera cobranças em aberto', () => {
    const snapshot = buildFinancialSnapshot({
      cobrancas: [{ status: 'A_VENCER' }],
      statusFinanceiro: 'ADIMPLENTE',
      integrationStatus: 'SINCRONIZADO',
      debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
    });

    const decision = evaluateCanonicalRematriculaDecision({
      academicEligible: true,
      financialSnapshot: snapshot,
    });

    expect(snapshot.financialStatus).toBe('PENDENTE');
    expect(decision.actionStatus).toBe('LIBERADA_COM_AVISO');
  });
});
