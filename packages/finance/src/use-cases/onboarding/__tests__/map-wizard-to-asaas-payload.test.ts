import { describe, it, expect } from 'vitest';

import { mapWizardToAsaasPayload, validateWizardForAsaas } from '../map-wizard-to-asaas-payload';
import type { WizardState } from '../wizard-types';

// ================================================================================
// Fixtures
// ================================================================================

const baseWizardStatePF: WizardState = {
  step: 6,
  completedAt: new Date(),
  schoolName: 'Escola Alusa',
  personType: 'PF',
  cpfCnpj: '123.456.789-09',
  birthDate: '1990-01-15',
  ownerName: 'João da Silva',
  companyName: null,
  companyType: null,
  mobilePhone: '11999998888',
  landlinePhone: '1133334444',
  incomeValue: 5000,
  address: 'Rua das Flores',
  addressNumber: '123',
  province: 'Centro',
  addressCity: 'São Paulo',
  addressState: 'SP',
  postalCode: '01234-567',
  complement: 'Apto 42',
  loginEmail: 'joao.login@example.com',
};

const baseWizardStatePJ: WizardState = {
  step: 6,
  completedAt: new Date(),
  schoolName: 'Escola Alusa',
  personType: 'PJ',
  cpfCnpj: '12.345.678/0001-95',
  birthDate: null,
  ownerName: 'Maria Souza',
  companyName: 'Empresa XYZ LTDA',
  companyType: 'LIMITED',
  mobilePhone: '11999997777',
  landlinePhone: null,
  incomeValue: 50000,
  address: 'Av. Paulista',
  addressNumber: '1000',
  province: 'Bela Vista',
  addressCity: 'São Paulo',
  addressState: 'SP',
  postalCode: '01310100',
  complement: null,
  loginEmail: null,
};

const testEmail = 'test@example.com';

// ================================================================================
// Testes: mapWizardToAsaasPayload - PF
// ================================================================================

describe('mapWizardToAsaasPayload - PF', () => {
  it('deve mapear corretamente dados PF completos', () => {
    const result = mapWizardToAsaasPayload(baseWizardStatePF, testEmail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload).toEqual({
      name: 'João da Silva',
      email: testEmail,
      cpfCnpj: '12345678909',
      mobilePhone: '11999998888',
      incomeValue: 5000,
      address: 'Rua das Flores',
      addressNumber: '123',
      province: 'Centro',
      postalCode: '01234567',
      birthDate: '1990-01-15',
      complement: 'Apto 42',
      phone: '1133334444',
    });
  });

  it('NÃO deve incluir companyType para PF', () => {
    const result = mapWizardToAsaasPayload(baseWizardStatePF, testEmail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.companyType).toBeUndefined();
  });

  it('deve retornar erro se birthDate estiver ausente para PF', () => {
    const wizard: WizardState = { ...baseWizardStatePF, birthDate: null };
    const result = mapWizardToAsaasPayload(wizard, testEmail);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('MISSING_REQUIRED_FIELD');
    expect(result.field).toBe('birthDate');
  });

  it('deve retornar erro se CPF tiver menos de 11 dígitos', () => {
    const wizard: WizardState = { ...baseWizardStatePF, cpfCnpj: '123456' };
    const result = mapWizardToAsaasPayload(wizard, testEmail);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('MISSING_REQUIRED_FIELD');
    expect(result.field).toBe('cpfCnpj');
  });
});

// ================================================================================
// Testes: mapWizardToAsaasPayload - PJ
// ================================================================================

describe('mapWizardToAsaasPayload - PJ', () => {
  it('deve mapear corretamente dados PJ completos', () => {
    const result = mapWizardToAsaasPayload(baseWizardStatePJ, testEmail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload).toEqual({
      name: 'Empresa XYZ LTDA',
      email: testEmail,
      cpfCnpj: '12345678000195',
      mobilePhone: '11999997777',
      incomeValue: 50000,
      address: 'Av. Paulista',
      addressNumber: '1000',
      province: 'Bela Vista',
      postalCode: '01310100',
      companyType: 'LIMITED',
    });
  });

  it('NÃO deve incluir birthDate para PJ', () => {
    const result = mapWizardToAsaasPayload(baseWizardStatePJ, testEmail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.birthDate).toBeUndefined();
  });

  it('deve usar companyName como name para PJ', () => {
    const result = mapWizardToAsaasPayload(baseWizardStatePJ, testEmail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.name).toBe('Empresa XYZ LTDA');
  });

  it('deve retornar erro se companyType estiver ausente para PJ', () => {
    const wizard: WizardState = { ...baseWizardStatePJ, companyType: null };
    const result = mapWizardToAsaasPayload(wizard, testEmail);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('INVALID_COMPANY_TYPE');
    expect(result.field).toBe('companyType');
  });

  it('deve retornar erro se CNPJ tiver menos de 14 dígitos', () => {
    const wizard: WizardState = { ...baseWizardStatePJ, cpfCnpj: '12345678' };
    const result = mapWizardToAsaasPayload(wizard, testEmail);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('MISSING_REQUIRED_FIELD');
    expect(result.field).toBe('cpfCnpj');
  });

  it('deve mapear todos os tipos de empresa válidos', () => {
    const companyTypes = ['MEI', 'LIMITED', 'INDIVIDUAL', 'ASSOCIATION'] as const;

    for (const companyType of companyTypes) {
      const wizard: WizardState = { ...baseWizardStatePJ, companyType };
      const result = mapWizardToAsaasPayload(wizard, testEmail);

      expect(result.ok).toBe(true);
      if (!result.ok) continue;

      expect(result.payload.companyType).toBe(companyType);
    }
  });
});

// ================================================================================
// Testes: Campos obrigatórios comuns
// ================================================================================

describe('mapWizardToAsaasPayload - campos obrigatórios', () => {
  const requiredFields = [
    { field: 'schoolName', value: null },
    { field: 'ownerName', value: null },
    { field: 'cpfCnpj', value: null },
    { field: 'mobilePhone', value: null },
    { field: 'incomeValue', value: null },
    { field: 'address', value: null },
    { field: 'addressNumber', value: null },
    { field: 'province', value: null },
    { field: 'postalCode', value: null },
  ] as const;

  for (const { field, value } of requiredFields) {
    it(`deve retornar erro se ${field} estiver ausente`, () => {
      const wizard: WizardState = { ...baseWizardStatePF, [field]: value };
      const result = mapWizardToAsaasPayload(wizard, testEmail);

      expect(result.ok).toBe(false);
      if (result.ok) return;

      expect(result.code).toBe('MISSING_REQUIRED_FIELD');
    });
  }

  it('deve retornar erro se personType for inválido', () => {
    const wizard: WizardState = { ...baseWizardStatePF, personType: null };
    const result = mapWizardToAsaasPayload(wizard, testEmail);

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.code).toBe('INVALID_PERSON_TYPE');
  });
});

// ================================================================================
// Testes: Sanitização de campos
// ================================================================================

describe('mapWizardToAsaasPayload - sanitização', () => {
  it('deve remover caracteres não numéricos do CPF', () => {
    const wizard: WizardState = { ...baseWizardStatePF, cpfCnpj: '123.456.789-09' };
    const result = mapWizardToAsaasPayload(wizard, testEmail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.cpfCnpj).toBe('12345678909');
  });

  it('deve remover caracteres não numéricos do CNPJ', () => {
    const wizard: WizardState = { ...baseWizardStatePJ, cpfCnpj: '12.345.678/0001-95' };
    const result = mapWizardToAsaasPayload(wizard, testEmail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.cpfCnpj).toBe('12345678000195');
  });

  it('deve remover caracteres não numéricos do telefone', () => {
    const wizard: WizardState = { ...baseWizardStatePF, mobilePhone: '(11) 99999-8888' };
    const result = mapWizardToAsaasPayload(wizard, testEmail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.mobilePhone).toBe('11999998888');
  });

  it('deve remover caracteres não numéricos do CEP e limitar a 8 dígitos', () => {
    const wizard: WizardState = { ...baseWizardStatePF, postalCode: '01234-567' };
    const result = mapWizardToAsaasPayload(wizard, testEmail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.postalCode).toBe('01234567');
  });

  it('deve fazer trim em strings', () => {
    const wizard: WizardState = {
      ...baseWizardStatePF,
      ownerName: '  João da Silva  ',
      address: '  Rua das Flores  ',
    };
    const result = mapWizardToAsaasPayload(wizard, testEmail);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.payload.name).toBe('João da Silva');
    expect(result.payload.address).toBe('Rua das Flores');
  });
});

// ================================================================================
// Testes: validateWizardForAsaas
// ================================================================================

describe('validateWizardForAsaas', () => {
  it('deve retornar valid=true para PF completo', () => {
    const result = validateWizardForAsaas(baseWizardStatePF);

    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it('deve retornar valid=true para PJ completo', () => {
    const result = validateWizardForAsaas(baseWizardStatePJ);

    expect(result.valid).toBe(true);
    expect(result.missingFields).toEqual([]);
  });

  it('deve listar campos faltantes para PF incompleto', () => {
    const wizard: WizardState = {
      ...baseWizardStatePF,
      birthDate: null,
      mobilePhone: null,
    };
    const result = validateWizardForAsaas(wizard);

    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('birthDate');
    expect(result.missingFields).toContain('mobilePhone');
  });

  it('deve listar campos faltantes para PJ incompleto', () => {
    const wizard: WizardState = {
      ...baseWizardStatePJ,
      companyType: null,
      incomeValue: null,
    };
    const result = validateWizardForAsaas(wizard);

    expect(result.valid).toBe(false);
    expect(result.missingFields).toContain('companyType');
    expect(result.missingFields).toContain('incomeValue');
  });
});
