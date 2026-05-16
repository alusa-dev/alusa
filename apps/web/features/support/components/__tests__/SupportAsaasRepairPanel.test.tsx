import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SupportAsaasRepairPanel } from '../SupportAsaasRepairPanel';

void React;

const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const diagnosis = {
  phase: 'API_KEY_OR_SUBACCOUNT_RECOVERY',
  financeIntegrationMode: 'WHITELABEL_BAAS',
  hasFinanceProfile: true,
  hasAsaasAccountRow: true,
  effectiveAsaasAccountId: '78e18307-38cf-4ba6-ba36-ad1aee1f1342',
  canCreateSubaccount: true,
  missingWizardFields: [],
  provisionJob: null,
  webhookJob: null,
  needsApiKeyRecovery: true,
  integrationOperational: false,
  webhookDrift: null,
  recoveryStuckWithoutSubaccountId: false,
  recommendedAction: 'SAVE_MANUAL_API_KEY',
  hint: 'Subconta Asaas existente, mas API Key ausente ou inválida.',
};

function okJson(data: unknown) {
  return { ok: true, json: async () => ({ success: true, data }) } as Response;
}

describe('SupportAsaasRepairPanel', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue(okJson(diagnosis));
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('mostra CTA manual quando recommendedAction = SAVE_MANUAL_API_KEY', async () => {
    render(<SupportAsaasRepairPanel contaId="conta-1" />);

    expect(await screen.findByText('Validar e salvar nova API Key')).toBeTruthy();
    expect(screen.getByText('Recuperar API Key da subconta')).toBeTruthy();
    expect(screen.getByDisplayValue('78e18307-38cf-4ba6-ba36-ad1aee1f1342')).toBeTruthy();
  });

  it('não mostra botões automáticos antigos', async () => {
    render(<SupportAsaasRepairPanel contaId="conta-1" />);

    await screen.findByText('Validar e salvar nova API Key');
    expect(screen.queryByText('Diagnosticar e reparar (automático)')).toBeNull();
    expect(screen.queryByText('Recuperar chave / webhooks')).toBeNull();
  });

  it('exige motivo e checkboxes antes de salvar', async () => {
    render(<SupportAsaasRepairPanel contaId="conta-1" />);

    const button = await screen.findByText('Validar e salvar nova API Key');
    const apiKey = screen.getByPlaceholderText('Cole a API Key recém-gerada');

    fireEvent.change(apiKey, { target: { value: '$aact_hmlg_manual_key' } });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByPlaceholderText('Ex.: Reparo suporte — sync Asaas.'), {
      target: { value: 'motivo operacional válido' },
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText('A chave foi gerada pelo script local oficial.'));
    fireEvent.click(screen.getByText('A chave pertence à subconta exibida acima.'));
    fireEvent.click(
      screen.getByText('Entendo que a Alusa validará e salvará a chave criptografada.'),
    );

    expect((button as HTMLButtonElement).disabled).toBe(false);
  });

  it('limpa campo apiKey e atualiza diagnóstico após salvar', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(okJson(diagnosis))
      .mockResolvedValueOnce(
        okJson({
          summary: 'Chave validada e salva com segurança.',
          webhook: { reason: 'REPAIRED' },
          reconcile: { reconciled: true },
          warnings: [],
        }),
      )
      .mockResolvedValueOnce(
        okJson({ ...diagnosis, needsApiKeyRecovery: false, integrationOperational: true }),
      );

    render(<SupportAsaasRepairPanel contaId="conta-1" />);

    const apiKey = await screen.findByPlaceholderText('Cole a API Key recém-gerada');
    fireEvent.change(apiKey, { target: { value: '$aact_hmlg_manual_key' } });
    fireEvent.change(screen.getByPlaceholderText('Ex.: Reparo suporte — sync Asaas.'), {
      target: { value: 'motivo operacional válido' },
    });
    fireEvent.click(screen.getByText('A chave foi gerada pelo script local oficial.'));
    fireEvent.click(screen.getByText('A chave pertence à subconta exibida acima.'));
    fireEvent.click(
      screen.getByText('Entendo que a Alusa validará e salvará a chave criptografada.'),
    );
    fireEvent.click(screen.getByText('Validar e salvar nova API Key'));

    await waitFor(() => expect(global.fetch).toHaveBeenCalledTimes(3));
    expect((apiKey as HTMLInputElement).value).toBe('');
    expect(refreshMock).toHaveBeenCalled();
    expect(await screen.findByText(/Chave validada e salva com segurança/)).toBeTruthy();
  });
});
