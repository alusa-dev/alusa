import { describe, expect, it } from 'vitest';

import { computeFiscalReadiness } from '../../fiscal/fiscal-readiness';

describe('computeFiscalReadiness', () => {
  it('retorna NOT_CONFIGURED sem settings', () => {
    const result = computeFiscalReadiness({ settings: null, services: [] });
    expect(result.ready).toBe(false);
    expect(result.status).toBe('NOT_CONFIGURED');
  });

  it('exige serviço padrão', () => {
    const result = computeFiscalReadiness({
      settings: {
        id: '1',
        contaId: 't1',
        fiscalEmail: 'fiscal@escola.com',
        municipalInscription: '123',
        rpsSerie: '1',
        rpsNumber: 10,
        accessMethod: 'TOKEN',
        accessConfiguredAt: new Date(),
        passwordConfigured: false,
        accessTokenConfigured: true,
        certificateConfigured: false,
        simplesNacional: true,
        culturalProjectsPromoter: false,
        readinessStatus: 'PENDING',
        readinessIssues: null,
        emissionMode: 'MANUAL',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never,
      services: [],
      kycApproved: true,
      invoicesEnabled: true,
    });
    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.code === 'DEFAULT_SERVICE_REQUIRED')).toBe(true);
  });

  it('fica READY com acesso, email e serviço padrão', () => {
    const result = computeFiscalReadiness({
      settings: {
        id: '1',
        contaId: 't1',
        fiscalEmail: 'fiscal@escola.com',
        municipalInscription: '123',
        rpsSerie: '1',
        rpsNumber: 10,
        accessMethod: 'TOKEN',
        accessConfiguredAt: new Date(),
        passwordConfigured: false,
        accessTokenConfigured: true,
        certificateConfigured: false,
        simplesNacional: true,
        culturalProjectsPromoter: false,
        readinessStatus: 'PENDING',
        readinessIssues: null,
        emissionMode: 'MANUAL',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never,
      services: [
        {
          id: 's1',
          contaId: 't1',
          name: 'Ensino',
          municipalServiceCode: '8.02',
          isDefault: true,
        } as never,
      ],
      kycApproved: true,
      invoicesEnabled: true,
    });
    expect(result.ready).toBe(true);
    expect(result.status).toBe('READY');
  });

  it('não fica READY quando requisitos municipais não carregam em conta parcialmente configurada', () => {
    const result = computeFiscalReadiness({
      settings: {
        id: '1',
        contaId: 't1',
        fiscalEmail: 'fiscal@escola.com',
        municipalInscription: '123',
        rpsSerie: '1',
        rpsNumber: 10,
        accessMethod: 'TOKEN',
        accessConfiguredAt: new Date(),
        passwordConfigured: false,
        accessTokenConfigured: true,
        certificateConfigured: false,
        simplesNacional: true,
        culturalProjectsPromoter: false,
        readinessStatus: 'PENDING',
        readinessIssues: null,
        emissionMode: 'MANUAL',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never,
      services: [
        {
          id: 's1',
          contaId: 't1',
          name: 'Ensino',
          municipalServiceCode: '8.02',
          isDefault: true,
        } as never,
      ],
      municipalOptions: null,
      kycApproved: true,
      invoicesEnabled: true,
    });

    expect(result.ready).toBe(false);
    expect(result.issues.some((i) => i.code === 'MUNICIPAL_OPTIONS_UNAVAILABLE')).toBe(true);
  });

  it('exige inscrição estadual e AEDF conforme municipalOptions', () => {
    const baseSettings = {
      id: '1',
      contaId: 't1',
      fiscalEmail: 'fiscal@escola.com',
      municipalInscription: '123',
      rpsSerie: '1',
      rpsNumber: 10,
      accessMethod: 'TOKEN',
      accessConfiguredAt: new Date(),
      passwordConfigured: false,
      accessTokenConfigured: true,
      certificateConfigured: false,
      simplesNacional: true,
      culturalProjectsPromoter: false,
      readinessStatus: 'PENDING',
      readinessIssues: null,
      emissionMode: 'MANUAL',
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never;

    const services = [
      {
        id: 's1',
        contaId: 't1',
        name: 'Ensino',
        municipalServiceCode: '8.02',
        isDefault: true,
      } as never,
    ];

    const withoutIe = computeFiscalReadiness({
      settings: { ...baseSettings, stateInscription: null, aedf: null },
      services,
      municipalOptions: { usesStateInscription: true, usesAedf: true },
      kycApproved: true,
      invoicesEnabled: true,
    });
    expect(withoutIe.ready).toBe(false);
    expect(withoutIe.issues.some((i) => i.code === 'STATE_INSCRIPTION_REQUIRED')).toBe(true);
    expect(withoutIe.issues.some((i) => i.code === 'AEDF_REQUIRED')).toBe(true);

    const complete = computeFiscalReadiness({
      settings: {
        ...baseSettings,
        stateInscription: '123456789',
        aedf: 'AEDF001',
      },
      services,
      municipalOptions: { usesStateInscription: true, usesAedf: true },
      kycApproved: true,
      invoicesEnabled: true,
    });
    expect(complete.ready).toBe(true);
  });
});
