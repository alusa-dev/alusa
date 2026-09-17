import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getAsaasBaseUrlForApiKeyOrThrow: vi.fn(),
  getInstallmentPaymentBook: vi.fn(),
  loadAsaasCredentials: vi.fn(),
}));

vi.mock('@alusa/asaas', () => ({
  getAsaasBaseUrlForApiKeyOrThrow: mocks.getAsaasBaseUrlForApiKeyOrThrow,
  getInstallmentPaymentBook: mocks.getInstallmentPaymentBook,
}));

vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: mocks.loadAsaasCredentials,
}));

import { getTenantInstallmentPaymentBook } from './get-installment-payment-book';

describe('getTenantInstallmentPaymentBook', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadAsaasCredentials.mockResolvedValue({ apiKey: 'asaas-key' });
    mocks.getAsaasBaseUrlForApiKeyOrThrow.mockReturnValue('https://sandbox.asaas.com/api/v3/');
  });

  it('devolve somente um documento do mesmo host Asaas do tenant', async () => {
    mocks.getInstallmentPaymentBook.mockResolvedValue({
      pdfUrl: '/documents/installment-book.pdf',
    });

    await expect(getTenantInstallmentPaymentBook('conta-1', 'installment-1')).resolves.toBe(
      'https://sandbox.asaas.com/documents/installment-book.pdf',
    );
  });

  it('não devolve URL externa fornecida pelo provedor', async () => {
    mocks.getInstallmentPaymentBook.mockResolvedValue({
      pdfUrl: 'https://attacker.example/file.pdf',
    });

    await expect(getTenantInstallmentPaymentBook('conta-1', 'installment-1')).resolves.toBeNull();
  });

  it('não chama o provedor quando o tenant não tem credencial conectada', async () => {
    mocks.loadAsaasCredentials.mockResolvedValue(null);

    await expect(getTenantInstallmentPaymentBook('conta-1', 'installment-1')).resolves.toBeNull();
    expect(mocks.getInstallmentPaymentBook).not.toHaveBeenCalled();
  });
});
