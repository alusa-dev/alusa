import { describe, it, expect } from 'vitest';

import {
  wizardStep1Schema,
  wizardStep2Schema,
  wizardStep3Schema,
  wizardStep4Schema,
  wizardStep5Schema,
  getMissingFieldsForSubaccount,
  type WizardState,
} from '../wizard-types';

describe('wizardStep1Schema', () => {
  it('valida personType PF', () => {
    const result = wizardStep1Schema.safeParse({ personType: 'PF' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personType).toBe('PF');
    }
  });

  it('valida personType PJ', () => {
    const result = wizardStep1Schema.safeParse({ personType: 'PJ' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.personType).toBe('PJ');
    }
  });

  it('rejeita personType inválido', () => {
    const result = wizardStep1Schema.safeParse({ personType: 'INVALIDO' });
    expect(result.success).toBe(false);
  });

  it('rejeita ausência de personType', () => {
    const result = wizardStep1Schema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe('wizardStep2Schema', () => {
  const validPFData = {
    personType: 'PF',
    schoolName: 'Escola Alusa',
    ownerName: 'João da Silva',
    cpfCnpj: '123.456.789-09',
    birthDate: '1990-01-15',
  };

  const validPJData = {
    personType: 'PJ',
    schoolName: 'Escola Alusa',
    companyName: 'Empresa XYZ LTDA',
    cpfCnpj: '12.345.678/0001-95',
    companyType: 'LIMITED',
  };

  it('valida dados PF completos', () => {
    const result = wizardStep2Schema.safeParse(validPFData);
    expect(result.success).toBe(true);
  });

  it('valida dados PJ completos', () => {
    const result = wizardStep2Schema.safeParse(validPJData);
    expect(result.success).toBe(true);
  });

  it('rejeita PF sem birthDate', () => {
    const { birthDate, ...data } = validPFData;
    const result = wizardStep2Schema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejeita PF sem nome da escola', () => {
    const { schoolName, ...data } = validPFData;
    const result = wizardStep2Schema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejeita PJ sem companyName', () => {
    const { companyName, ...data } = validPJData;
    const result = wizardStep2Schema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejeita PJ sem companyType', () => {
    const { companyType, ...data } = validPJData;
    const result = wizardStep2Schema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('normaliza CPF removendo pontuação', () => {
    const result = wizardStep2Schema.safeParse(validPFData);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.cpfCnpj).toBe('12345678909');
    }
  });
});

describe('wizardStep3Schema', () => {
  it('valida contato completo', () => {
    const result = wizardStep3Schema.safeParse({
      mobilePhone: '(11) 99999-9999',
      landlinePhone: '(11) 3333-3333',
      loginEmail: 'financeiro@empresa.com',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mobilePhone).toBe('11999999999');
      expect(result.data.landlinePhone).toBe('1133333333');
      expect(result.data.loginEmail).toBe('financeiro@empresa.com');
    }
  });

  it('aceita contato sem campos opcionais', () => {
    const result = wizardStep3Schema.safeParse({
      mobilePhone: '(11) 99999-9999',
    });
    expect(result.success).toBe(true);
  });
});

describe('wizardStep4Schema', () => {
  it('valida endereço completo', () => {
    const result = wizardStep4Schema.safeParse({
      postalCode: '01234-567',
      address: 'Rua das Flores',
      addressNumber: '123',
      province: 'Centro',
      addressCity: 'São Paulo',
      addressState: 'SP',
      complement: 'Apto 12',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.postalCode).toBe('01234567');
      expect(result.data.addressState).toBe('SP');
    }
  });
});

describe('wizardStep5Schema', () => {
  it('valida faturamento positivo', () => {
    const result = wizardStep5Schema.safeParse({
      incomeValue: 1000,
    });
    expect(result.success).toBe(true);
  });

  it('rejeita faturamento inválido', () => {
    const result = wizardStep5Schema.safeParse({
      incomeValue: 0,
    });
    expect(result.success).toBe(false);
  });
});

describe('getMissingFieldsForSubaccount', () => {
  const completeStatePF: WizardState = {
    step: 6,
    completedAt: new Date(),
    schoolName: 'Escola Alusa',
    personType: 'PF',
    cpfCnpj: '12345678909',
    birthDate: '1990-01-15',
    ownerName: 'João da Silva',
    companyName: null,
    companyType: null,
    mobilePhone: '11999999999',
    landlinePhone: null,
    incomeValue: 5000,
    address: 'Rua das Flores',
    addressNumber: '123',
    province: 'Centro',
    addressCity: 'São Paulo',
    addressState: 'SP',
    postalCode: '01234567',
    complement: null,
    loginEmail: null,
  };

  const completeStatePJ: WizardState = {
    step: 6,
    completedAt: new Date(),
    schoolName: 'Escola Alusa',
    personType: 'PJ',
    cpfCnpj: '12345678000195',
    birthDate: null,
    ownerName: 'Empresa XYZ LTDA',
    companyName: 'Empresa XYZ LTDA',
    companyType: 'LIMITED',
    mobilePhone: '11999999999',
    landlinePhone: null,
    incomeValue: 10000,
    address: 'Av. Paulista',
    addressNumber: '1000',
    province: 'Bela Vista',
    addressCity: 'São Paulo',
    addressState: 'SP',
    postalCode: '01310100',
    complement: null,
    loginEmail: null,
  };

  it('retorna array vazio para PF completo', () => {
    const missing = getMissingFieldsForSubaccount(completeStatePF);
    expect(missing).toEqual([]);
  });

  it('retorna array vazio para PJ completo', () => {
    const missing = getMissingFieldsForSubaccount(completeStatePJ);
    expect(missing).toEqual([]);
  });

  it('retorna personType se não definido', () => {
    const state: WizardState = { ...completeStatePF, personType: null };
    const missing = getMissingFieldsForSubaccount(state);
    expect(missing).toContain('personType');
  });

  it('retorna birthDate para PF sem birthDate', () => {
    const state: WizardState = { ...completeStatePF, birthDate: null };
    const missing = getMissingFieldsForSubaccount(state);
    expect(missing).toContain('birthDate');
  });

  it('retorna schoolName se nome da escola não foi definido', () => {
    const state: WizardState = { ...completeStatePF, schoolName: null };
    const missing = getMissingFieldsForSubaccount(state);
    expect(missing).toContain('schoolName');
  });

  it('retorna companyName para PJ sem companyName', () => {
    const state: WizardState = { ...completeStatePJ, companyName: null };
    const missing = getMissingFieldsForSubaccount(state);
    expect(missing).toContain('companyName');
  });

  it('retorna companyType para PJ sem companyType', () => {
    const state: WizardState = { ...completeStatePJ, companyType: null };
    const missing = getMissingFieldsForSubaccount(state);
    expect(missing).toContain('companyType');
  });

  it('retorna múltiplos campos faltantes', () => {
    const state: WizardState = {
      ...completeStatePF,
      ownerName: null,
      mobilePhone: null,
      address: null,
    };
    const missing = getMissingFieldsForSubaccount(state);
    expect(missing).toContain('ownerName');
    expect(missing).toContain('mobilePhone');
    expect(missing).toContain('address');
  });

  it('não exige birthDate para PJ', () => {
    const state: WizardState = { ...completeStatePJ, birthDate: null };
    const missing = getMissingFieldsForSubaccount(state);
    expect(missing).not.toContain('birthDate');
  });

  it('não exige companyName para PF', () => {
    const state: WizardState = { ...completeStatePF, companyName: null };
    const missing = getMissingFieldsForSubaccount(state);
    expect(missing).not.toContain('companyName');
  });
});
