import { describe, expect, it } from 'vitest';

import {
  assertPayerAddressFiscalReady,
  buildResponsavelEnderecoFromFlat,
  evaluatePayerAddressFiscalReadiness,
  getPayerAddressReadinessCalloutCopy,
  normalizePayerAddressInput,
  responsavelEnderecoInputSchema,
} from '../payer-address';

describe('payer-address', () => {
  const complete = {
    cep: '01310100',
    logradouro: 'Av. Paulista',
    numero: '150',
    bairro: 'Bela Vista',
    cidade: 'São Paulo',
    uf: 'SP',
  };

  it('normaliza endereço completo', () => {
    expect(normalizePayerAddressInput(complete)).toEqual({
      ...complete,
      complemento: undefined,
    });
  });

  it('considera endereço fiscal pronto quando completo', () => {
    const result = evaluatePayerAddressFiscalReadiness(complete);
    expect(result.ready).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it('rejeita CEP sem número', () => {
    const result = evaluatePayerAddressFiscalReadiness({
      cep: '01310100',
      logradouro: 'Av. Paulista',
      bairro: 'Centro',
      cidade: 'São Paulo',
      uf: 'SP',
    });
    expect(result.ready).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'PAYER_ADDRESS_NUMBER_MISSING')).toBe(true);
  });

  it('rejeita CEP inválido repetido', () => {
    const result = evaluatePayerAddressFiscalReadiness({
      ...complete,
      cep: '00000000',
    });
    expect(result.ready).toBe(false);
    expect(result.issues.some((issue) => issue.code === 'PAYER_ADDRESS_CEP_INVALID')).toBe(true);
  });

  it('monta endereço a partir de campos flat do wizard', () => {
    const nested = buildResponsavelEnderecoFromFlat({
      enderecoCep: '01310-100',
      enderecoLogradouro: 'Av. Paulista',
      enderecoNumero: '150',
      enderecoBairro: 'Bela Vista',
      enderecoCidade: 'São Paulo',
      enderecoUf: 'sp',
    });
    expect(nested?.cep).toBe('01310100');
    expect(assertPayerAddressFiscalReady(nested)).toMatchObject({ uf: 'SP' });
  });

  it('valida schema zod de endereço', () => {
    const parsed = responsavelEnderecoInputSchema.safeParse(complete);
    expect(parsed.success).toBe(true);
  });

  it('gera copy de callout sem duplicar título e detalhe', () => {
    expect(
      getPayerAddressReadinessCalloutCopy(
        [{ code: 'PAYER_ADDRESS_MISSING', message: 'Endereço do responsável financeiro não informado.' }],
        'responsavel-form',
      ),
    ).toEqual({
      label: 'Endereço não informado',
      detail: 'Preencha os campos abaixo para habilitar cobranças e NFS-e.',
    });
  });
});
