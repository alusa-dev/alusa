import { describe, it, expect } from 'vitest';
import {
  buildChargeExternalReference,
  buildSubscriptionExternalReference,
  buildInstallmentExternalReference,
  buildStandaloneExternalReference,
  buildPaymentExternalReference,
  parseExternalReference,
  ASAAS_MAX_EXTERNAL_REF_LENGTH,
} from '../external-reference';

describe('External Reference - Builders V2', () => {
  describe('buildChargeExternalReference', () => {
    it('deve gerar referência no formato V2 (sem subcontaId)', () => {
      const ref = buildChargeExternalReference({
        matriculaId: 'mat-123',
        planoId: 'plano-456',
        periodo: '2024-01',
        subcontaId: 'conta-789',
      });

      expect(ref).toBe('alusa:charge:mat-123:plano-456:2024-01');
    });

    it('deve respeitar limite de 100 chars com IDs reais', () => {
      const ref = buildChargeExternalReference({
        matriculaId: 'cml4l6hs0005j3hanyekpdbae',
        planoId: 'cml4l6hs0005j3hanyekpdbaf',
        periodo: '2025-01',
      });

      expect(ref.length).toBeLessThanOrEqual(ASAAS_MAX_EXTERNAL_REF_LENGTH);
    });
  });

  describe('buildSubscriptionExternalReference', () => {
    it('deve gerar referência no formato V2 (sem subcontaId)', () => {
      const ref = buildSubscriptionExternalReference({
        matriculaId: 'mat-123',
        planoId: 'plano-456',
        subcontaId: 'conta-789',
      });

      expect(ref).toBe('alusa:subscription:mat-123:plano-456');
    });
  });

  describe('buildInstallmentExternalReference', () => {
    it('deve gerar referência no formato V2 (sem subcontaId)', () => {
      const ref = buildInstallmentExternalReference({
        installmentPlanId: 'inst-123',
        subcontaId: 'conta-789',
      });

      expect(ref).toBe('alusa:installment:inst-123');
    });

    it('deve respeitar limite de 100 chars com IDs reais', () => {
      const ref = buildInstallmentExternalReference({
        installmentPlanId: 'ip_abcdefabcdefabcdefabcdef',
      });

      expect(ref.length).toBeLessThanOrEqual(ASAAS_MAX_EXTERNAL_REF_LENGTH);
    });

    it('deve respeitar limite de 100 chars com sufixo de recreation', () => {
      const ref = buildInstallmentExternalReference({
        installmentPlanId: 'ip_abcdefabcdefabcdefabcdef:a1b2c3d4',
      });

      expect(ref.length).toBeLessThanOrEqual(ASAAS_MAX_EXTERNAL_REF_LENGTH);
    });
  });

  describe('buildStandaloneExternalReference', () => {
    it('deve gerar referência no formato V2 (sem subcontaId)', () => {
      const ref = buildStandaloneExternalReference({
        chargeId: 'charge-123',
        subcontaId: 'conta-789',
      });

      expect(ref).toBe('alusa:standalone:charge-123');
    });
  });

  describe('buildPaymentExternalReference', () => {
    it('deve gerar referência para pagamento de subscription', () => {
      const ref = buildPaymentExternalReference(
        'alusa:subscription:mat-123:plano-456',
        'pay-001'
      );

      expect(ref).toBe('alusa:subscription:mat-123:plano-456:payment:pay-001');
    });

    it('deve gerar referência para pagamento de installment', () => {
      const ref = buildPaymentExternalReference(
        'alusa:installment:inst-123',
        'pay-001'
      );

      expect(ref).toBe('alusa:installment:inst-123:payment:pay-001');
    });
  });
});

describe('External Reference - Parser V2', () => {
  describe('parseExternalReference - V2 format (sem subcontaId)', () => {
    it('deve parsear charge V2 sem subcontaId', () => {
      const parsed = parseExternalReference('alusa:charge:mat-123:plano-456:2024-01');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('charge');
      expect(parsed!.isV2).toBe(true);
      expect(parsed!.ids.matriculaId).toBe('mat-123');
      expect(parsed!.ids.planoId).toBe('plano-456');
      expect(parsed!.ids.periodo).toBe('2024-01');
      expect(parsed!.ids.subcontaId).toBeUndefined();
    });

    it('deve parsear charge V2 legado (com subcontaId)', () => {
      const parsed = parseExternalReference('alusa:charge:mat-123:plano-456:2024-01:conta-789');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('charge');
      expect(parsed!.isV2).toBe(true);
      expect(parsed!.ids.matriculaId).toBe('mat-123');
      expect(parsed!.ids.planoId).toBe('plano-456');
      expect(parsed!.ids.periodo).toBe('2024-01');
      expect(parsed!.ids.subcontaId).toBe('conta-789');
    });

    it('deve parsear subscription V2 sem subcontaId', () => {
      const parsed = parseExternalReference('alusa:subscription:mat-123:plano-456');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('subscription');
      expect(parsed!.isV2).toBe(true);
      expect(parsed!.ids.matriculaId).toBe('mat-123');
      expect(parsed!.ids.planoId).toBe('plano-456');
      expect(parsed!.ids.subcontaId).toBeUndefined();
    });

    it('deve parsear subscription V2 legado (com subcontaId)', () => {
      const parsed = parseExternalReference('alusa:subscription:mat-123:plano-456:conta-789');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('subscription');
      expect(parsed!.isV2).toBe(true);
      expect(parsed!.ids.matriculaId).toBe('mat-123');
      expect(parsed!.ids.planoId).toBe('plano-456');
      expect(parsed!.ids.subcontaId).toBe('conta-789');
    });

    it('deve parsear installment V2 sem subcontaId', () => {
      const parsed = parseExternalReference('alusa:installment:inst-123');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('installment');
      expect(parsed!.isV2).toBe(true);
      expect(parsed!.ids.installmentPlanId).toBe('inst-123');
      expect(parsed!.ids.subcontaId).toBeUndefined();
    });

    it('deve parsear installment V2 legado (com subcontaId)', () => {
      const parsed = parseExternalReference('alusa:installment:inst-123:conta-789');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('installment');
      expect(parsed!.isV2).toBe(true);
      expect(parsed!.ids.installmentPlanId).toBe('inst-123');
      expect(parsed!.ids.subcontaId).toBe('conta-789');
    });

    it('deve parsear standalone V2 sem subcontaId', () => {
      const parsed = parseExternalReference('alusa:standalone:charge-123');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('standalone');
      expect(parsed!.isV2).toBe(true);
      expect(parsed!.ids.chargeId).toBe('charge-123');
      expect(parsed!.ids.subcontaId).toBeUndefined();
    });

    it('deve parsear standalone V2 legado (com subcontaId)', () => {
      const parsed = parseExternalReference('alusa:standalone:charge-123:conta-789');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('standalone');
      expect(parsed!.isV2).toBe(true);
      expect(parsed!.ids.chargeId).toBe('charge-123');
      expect(parsed!.ids.subcontaId).toBe('conta-789');
    });
  });

  describe('parseExternalReference - V1 format (fallback)', () => {
    it('deve parsear subscription V1', () => {
      const parsed = parseExternalReference('subscription:sub-123');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('subscription');
      expect(parsed!.isV2).toBe(false);
      expect(parsed!.ids.subscriptionId).toBe('sub-123');
    });

    it('deve parsear installmentPlan V1', () => {
      const parsed = parseExternalReference('installmentPlan:inst-123');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('installment');
      expect(parsed!.isV2).toBe(false);
      expect(parsed!.ids.installmentPlanId).toBe('inst-123');
    });

    it('deve parsear installmentPlan:pending V1', () => {
      const parsed = parseExternalReference('installmentPlan:pending:inst-123');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('installment');
      expect(parsed!.isV2).toBe(false);
      // O parser extrai o primeiro segmento após 'installmentPlan:'
      // Para installmentPlan:pending:id, extrai 'pending'
      expect(parsed!.ids.installmentPlanId).toBe('pending');
    });

    it('deve parsear standalone V1', () => {
      const parsed = parseExternalReference('standalone:charge-123');

      expect(parsed).not.toBeNull();
      expect(parsed!.type).toBe('standalone');
      expect(parsed!.isV2).toBe(false);
      expect(parsed!.ids.chargeId).toBe('charge-123');
    });
  });

  describe('parseExternalReference - edge cases', () => {
    it('deve retornar null para referência vazia', () => {
      expect(parseExternalReference('')).toBeNull();
      expect(parseExternalReference(null as unknown as string)).toBeNull();
      expect(parseExternalReference(undefined as unknown as string)).toBeNull();
    });

    it('deve retornar unknown para formato desconhecido', () => {
      const parsed1 = parseExternalReference('unknown:format');
      expect(parsed1?.type).toBe('unknown');
      
      const parsed2 = parseExternalReference('random-string');
      expect(parsed2?.type).toBe('unknown');
    });

    it('deve retornar unknown para formato V2 incompleto', () => {
      // Formato incompleto retorna unknown, não null
      const parsed1 = parseExternalReference('alusa:charge:');
      expect(parsed1?.type).toBe('unknown');
      
      const parsed2 = parseExternalReference('alusa:');
      expect(parsed2?.type).toBe('unknown');
    });
  });
});

describe('External Reference - Round-trip', () => {
  it('charge deve fazer round-trip corretamente', () => {
    const original = {
      matriculaId: 'mat-abc',
      planoId: 'plano-def',
      periodo: '2024-03',
      subcontaId: 'conta-xyz',
    };

    const ref = buildChargeExternalReference(original);
    const parsed = parseExternalReference(ref);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('charge');
    expect(parsed!.isV2).toBe(true);
    expect(parsed!.ids.matriculaId).toBe(original.matriculaId);
    expect(parsed!.ids.planoId).toBe(original.planoId);
    expect(parsed!.ids.periodo).toBe(original.periodo);
    // subcontaId não é incluído no output V2
    expect(parsed!.ids.subcontaId).toBeUndefined();
  });

  it('subscription deve fazer round-trip corretamente', () => {
    const original = {
      matriculaId: 'mat-abc',
      planoId: 'plano-def',
      subcontaId: 'conta-xyz',
    };

    const ref = buildSubscriptionExternalReference(original);
    const parsed = parseExternalReference(ref);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('subscription');
    expect(parsed!.isV2).toBe(true);
    expect(parsed!.ids.matriculaId).toBe(original.matriculaId);
    expect(parsed!.ids.planoId).toBe(original.planoId);
    // subcontaId não é incluído no output V2
    expect(parsed!.ids.subcontaId).toBeUndefined();
  });

  it('installment deve fazer round-trip corretamente', () => {
    const original = {
      installmentPlanId: 'inst-abc',
      subcontaId: 'conta-xyz',
    };

    const ref = buildInstallmentExternalReference(original);
    const parsed = parseExternalReference(ref);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('installment');
    expect(parsed!.isV2).toBe(true);
    expect(parsed!.ids.installmentPlanId).toBe(original.installmentPlanId);
    // subcontaId não é incluído no output V2
    expect(parsed!.ids.subcontaId).toBeUndefined();
  });

  it('standalone deve fazer round-trip corretamente', () => {
    const original = {
      chargeId: 'charge-abc',
      subcontaId: 'conta-xyz',
    };

    const ref = buildStandaloneExternalReference(original);
    const parsed = parseExternalReference(ref);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('standalone');
    expect(parsed!.isV2).toBe(true);
    expect(parsed!.ids.chargeId).toBe(original.chargeId);
    // subcontaId não é incluído no output V2
    expect(parsed!.ids.subcontaId).toBeUndefined();
  });

  it('refs V2 legado (com subcontaId) fazem round-trip', () => {
    // Refs já salvas no DB com subcontaId devem continuar parseáveis
    const legacyRef = 'alusa:installment:inst-123:conta-789';
    const parsed = parseExternalReference(legacyRef);

    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('installment');
    expect(parsed!.ids.installmentPlanId).toBe('inst-123');
    expect(parsed!.ids.subcontaId).toBe('conta-789');
  });
});
