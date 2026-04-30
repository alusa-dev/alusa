import { describe, expect, it } from 'vitest';
import {
  buildFinancialSnapshot,
  evaluateRematriculaDecision,
} from './rematricula-financial-policy.service';

describe('rematricula-financial-policy.service', () => {
  it('flexibiliza com alerta quando houver pendência relevante', () => {
    const snapshot = buildFinancialSnapshot({
      cobrancas: [{ status: 'PENDENTE' }],
      statusFinanceiro: 'ADIMPLENTE',
      integrationStatus: 'SINCRONIZADO',
      debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
    });

    const decision = evaluateRematriculaDecision({
      academicEligible: true,
      financialSnapshot: snapshot,
      policy: { preset: 'FLEXIVEL', debtScope: 'QUALQUER_COBRANCA_EM_ABERTO', overrideRoles: [] },
      currentUserRole: 'ADMIN',
    });

    expect(decision.actionStatus).toBe('LIBERADA_COM_AVISO');
    expect(decision.requiresOverrideReason).toBe(false);
  });

  it('exige autorização quando a regra controlada encontra dívida relevante', () => {
    const snapshot = buildFinancialSnapshot({
      cobrancas: [{ status: 'ATRASADO' }],
      statusFinanceiro: 'INADIMPLENTE',
      integrationStatus: 'SINCRONIZADO',
      debtScope: 'APENAS_VENCIDAS',
    });

    const decision = evaluateRematriculaDecision({
      academicEligible: true,
      financialSnapshot: snapshot,
      policy: { preset: 'CONTROLADA', debtScope: 'APENAS_VENCIDAS', overrideRoles: ['FINANCEIRO'] },
      currentUserRole: 'FINANCEIRO',
    });

    expect(decision.actionStatus).toBe('REQUER_OVERRIDE');
    expect(decision.canCurrentUserOverride).toBe(true);
    expect(decision.requiresOverrideReason).toBe(true);
  });

  it('bloqueia na regra restritiva quando a situação financeira estiver inconclusiva', () => {
    const snapshot = buildFinancialSnapshot({
      cobrancas: [{ status: 'PROCESSANDO' }],
      statusFinanceiro: 'PENDENTE_FINANCEIRO',
      integrationStatus: 'PENDENTE_SINCRONISMO',
      debtScope: 'QUALQUER_COBRANCA_EM_ABERTO',
    });

    const decision = evaluateRematriculaDecision({
      academicEligible: true,
      financialSnapshot: snapshot,
      policy: { preset: 'RESTRITIVA', debtScope: 'QUALQUER_COBRANCA_EM_ABERTO', overrideRoles: [] },
      currentUserRole: 'ADMIN',
    });

    expect(decision.actionStatus).toBe('BLOQUEADA');
    expect(decision.blockReason).toBe('AGUARDANDO_RECONCILIACAO');
  });

  it('ignora cobrança futura quando o escopo considera apenas vencidas', () => {
    const snapshot = buildFinancialSnapshot({
      cobrancas: [{ status: 'A_VENCER' }],
      statusFinanceiro: 'ADIMPLENTE',
      integrationStatus: 'SINCRONIZADO',
      debtScope: 'APENAS_VENCIDAS',
    });

    const decision = evaluateRematriculaDecision({
      academicEligible: true,
      financialSnapshot: snapshot,
      policy: { preset: 'CONTROLADA', debtScope: 'APENAS_VENCIDAS', overrideRoles: ['ADMIN'] },
      currentUserRole: 'ADMIN',
    });

    expect(snapshot.financialStatus).toBe('REGULAR');
    expect(decision.actionStatus).toBe('LIBERADA');
  });
});
