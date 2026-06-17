import { describe, expect, it } from 'vitest';

import {
  validateFiscalCoreSettingsDraft,
  validateFiscalSettingsDraft,
  validateFiscalWizardStep,
} from '../fiscal-settings-validation';

describe('fiscal-settings-validation', () => {
  it('exige campos fiscais obrigatórios no passo de informações', () => {
    const issues = validateFiscalWizardStep(
      'informacoes',
      { simplesNacional: true, useNationalPortal: true },
      {
        municipalOptions: {
          authenticationType: 'USER_AND_PASSWORD',
          usesSpecialTaxRegimes: true,
          usesNbs: true,
          nationalPortalTaxCalculationRegimeList: [{ label: 'Nenhum', value: '0' }],
        },
      },
    );

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining([
        'municipalInscription',
        'rpsSerie',
        'rpsNumber',
        'specialTaxRegime',
        'nbsCode',
        'nationalPortalTaxCalculationRegime',
      ]),
    );
  });

  it('exige inscrição estadual e AEDF quando a prefeitura exige', () => {
    const issues = validateFiscalWizardStep(
      'informacoes',
      {
        municipalInscription: '14.05.01',
        rpsSerie: '80001',
        rpsNumber: 1,
        simplesNacional: true,
      },
      {
        municipalOptions: {
          usesStateInscription: true,
          usesAedf: true,
          usesNbs: false,
        },
      },
    );

    expect(issues.map((issue) => issue.field)).toEqual(
      expect.arrayContaining(['stateInscription', 'aedf']),
    );
  });

  it('aceita inscrição estadual e AEDF quando informados', () => {
    const issues = validateFiscalWizardStep(
      'informacoes',
      {
        municipalInscription: '14.05.01',
        stateInscription: '123456789',
        aedf: 'AEDF123',
        rpsSerie: '1',
        rpsNumber: 1,
        simplesNacional: true,
      },
      {
        municipalOptions: {
          usesStateInscription: true,
          usesAedf: true,
          usesNbs: false,
        },
      },
    );

    expect(issues).toHaveLength(0);
  });

  it('aceita regime especial 0 como valor válido', () => {
    const issues = validateFiscalWizardStep(
      'informacoes',
      {
        municipalInscription: '14.05.01',
        rpsSerie: '80001',
        rpsNumber: 1,
        specialTaxRegime: '0',
        nbsCode: '1.2201.11.00',
        simplesNacional: true,
        nationalPortalTaxCalculationRegime: '1',
        useNationalPortal: true,
      },
      {
        municipalOptions: {
          authenticationType: 'USER_AND_PASSWORD',
          usesSpecialTaxRegimes: true,
          usesNbs: true,
          nationalPortalTaxCalculationRegimeList: [{ label: 'SN', value: '1' }],
        },
      },
    );

    expect(issues).toHaveLength(0);
  });

  it('núcleo fiscal não exige serviço padrão', () => {
    const issues = validateFiscalCoreSettingsDraft(
      {
        fiscalEmail: 'fiscal@escola.test',
        username: 'usuario',
        password: 'senha',
        municipalInscription: '14.05.01',
        rpsSerie: '80001',
        rpsNumber: 1,
        specialTaxRegime: '0',
        nbsCode: '1.2201.11.00',
        simplesNacional: true,
        nationalPortalTaxCalculationRegime: '1',
        useNationalPortal: true,
      },
      {
        municipalOptions: {
          authenticationType: 'USER_AND_PASSWORD',
          usesSpecialTaxRegimes: true,
          usesNbs: true,
          nationalPortalTaxCalculationRegimeList: [{ label: 'SN', value: '1' }],
        },
      },
    );

    expect(issues).toHaveLength(0);
  });

  it('bloqueia salvar sem serviço municipal padrão', () => {
    const issues = validateFiscalSettingsDraft(
      {
        fiscalEmail: 'fiscal@escola.test',
        username: 'usuario',
        password: 'senha',
        municipalInscription: '14.05.01',
        rpsSerie: '80001',
        rpsNumber: 1,
        specialTaxRegime: '0',
        nbsCode: '1.2201.11.00',
        simplesNacional: true,
        nationalPortalTaxCalculationRegime: '1',
        useNationalPortal: true,
      },
      {
        municipalOptions: {
          authenticationType: 'USER_AND_PASSWORD',
          usesSpecialTaxRegimes: true,
          usesNbs: true,
        },
        passwordConfigured: false,
        defaultServiceExists: false,
      },
    );

    expect(issues.some((issue) => issue.field === 'defaultService')).toBe(true);
  });

  it('valida faixa de série RPS do Portal Nacional para usuário e senha', () => {
    const issues = validateFiscalWizardStep(
      'informacoes',
      {
        municipalInscription: '140501',
        rpsSerie: '1',
        rpsNumber: 1,
        simplesNacional: false,
        useNationalPortal: true,
        accessMethod: 'USER_PASSWORD',
      },
      {
        municipalOptions: { authenticationType: 'USER_AND_PASSWORD' },
      },
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'rpsSerie',
          message: expect.stringContaining('80000 e 89999'),
        }),
      ]),
    );
  });

  it('valida faixa de série RPS do Portal Nacional para certificado digital', () => {
    const issues = validateFiscalWizardStep(
      'informacoes',
      {
        municipalInscription: '140501',
        rpsSerie: '80001',
        rpsNumber: 1,
        simplesNacional: false,
        useNationalPortal: true,
        accessMethod: 'CERTIFICATE',
      },
      {
        municipalOptions: { authenticationType: 'CERTIFICATE' },
      },
    );

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'rpsSerie',
          message: expect.stringContaining('00001 e 49999'),
        }),
      ]),
    );
  });

  it('valida dias permitidos para emissão antes do vencimento', () => {
    const issues = validateFiscalWizardStep('padroes', {
      emissionMode: 'ON_PAYMENT',
      invoiceEffectiveDatePeriod: 'BEFORE_PAYMENT_DUE_DATE',
      invoiceDaysBeforeDueDate: 7,
    });

    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: 'invoiceDaysBeforeDueDate',
        }),
      ]),
    );
  });
});
