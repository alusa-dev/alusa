import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { AsaasNotificationSettings } from '@/features/settings/notifications/asaas/AsaasNotificationSettings';

void React;

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(), update: vi.fn(), save: vi.fn(), reset: vi.fn(), setCustomerEnabled: vi.fn(), setChannels: vi.fn(), setContractsEnabled: vi.fn(), setContractsMaster: vi.fn(), setContractsChannel: vi.fn(),
}));

vi.mock('@/features/settings/notifications/asaas/hooks/useAsaasNotificationSettings', () => ({
  useAsaasNotificationSettings: () => {
    const React = require('react') as typeof import('react');
    const initialPreferences = [
      { id: 'created', event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true, customerEnabled: true, emailEnabledForCustomer: true, whatsappEnabledForCustomer: false, smsEnabledForCustomer: true, emailEnabledForProvider: false, smsEnabledForProvider: false },
      { id: 'due', event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 0, enabled: true, customerEnabled: true, emailEnabledForCustomer: true, whatsappEnabledForCustomer: false, smsEnabledForCustomer: true, emailEnabledForProvider: true, smsEnabledForProvider: false },
      { id: 'before', event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 5, enabled: true, customerEnabled: true, emailEnabledForCustomer: true, whatsappEnabledForCustomer: false, smsEnabledForCustomer: true, emailEnabledForProvider: true, smsEnabledForProvider: false },
      { id: 'late', event: 'PAYMENT_OVERDUE', scheduleOffset: 0, enabled: true, customerEnabled: true, emailEnabledForCustomer: true, whatsappEnabledForCustomer: false, smsEnabledForCustomer: true, emailEnabledForProvider: true, smsEnabledForProvider: false },
      { id: 'late7', event: 'PAYMENT_OVERDUE', scheduleOffset: 7, enabled: true, customerEnabled: true, emailEnabledForCustomer: true, whatsappEnabledForCustomer: false, smsEnabledForCustomer: true, emailEnabledForProvider: true, smsEnabledForProvider: false },
      { id: 'received', event: 'PAYMENT_RECEIVED', scheduleOffset: 0, enabled: true, customerEnabled: true, emailEnabledForCustomer: true, whatsappEnabledForCustomer: false, smsEnabledForCustomer: true, emailEnabledForProvider: true, smsEnabledForProvider: false },
      { id: 'updated', event: 'PAYMENT_UPDATED', scheduleOffset: 0, enabled: true, customerEnabled: true, emailEnabledForCustomer: true, whatsappEnabledForCustomer: false, smsEnabledForCustomer: true, emailEnabledForProvider: true, smsEnabledForProvider: false },
      { id: 'line', event: 'SEND_LINHA_DIGITAVEL', scheduleOffset: 0, enabled: true, customerEnabled: true, emailEnabledForCustomer: true, whatsappEnabledForCustomer: false, smsEnabledForCustomer: true, emailEnabledForProvider: true, smsEnabledForProvider: false },
    ];
    const [preferences, setPreferences] = React.useState(initialPreferences);
    const [policy, setPolicy] = React.useState({ customerNotificationsEnabled: true, customerEmailNotificationsEnabled: true, customerWhatsAppNotificationsEnabled: true, customerSmsNotificationsEnabled: true, contractWhatsAppNotificationsEnabled: true, contractNotificationsEnabled: true, contractEmailNotificationsEnabled: false, version: 4 });
    return ({
    loading: false,
    saving: false,
    error: null,
    preferences,
    policy,
    synchronization: { pending: 2, failed: 0, legacyPreferenceUnknown: 1 },
    hasChanges: JSON.stringify(preferences) !== JSON.stringify(initialPreferences) || JSON.stringify(policy) !== JSON.stringify({ customerNotificationsEnabled: true, customerEmailNotificationsEnabled: true, customerWhatsAppNotificationsEnabled: true, customerSmsNotificationsEnabled: true, contractWhatsAppNotificationsEnabled: true, contractNotificationsEnabled: true, contractEmailNotificationsEnabled: false, version: 4 }),
    updatePreference: (event: string, scheduleOffset: number, patch: Record<string, unknown>) => {
      mocks.update(event, scheduleOffset, patch);
      setPreferences((current) => current.map((preference) => preference.event === event && preference.scheduleOffset === scheduleOffset ? { ...preference, ...patch } : preference));
    },
    fetchPreferences: mocks.fetch,
    savePreferences: mocks.save,
    reset: mocks.reset,
    setCustomerNotificationsEnabled: (enabled: boolean) => { mocks.setCustomerEnabled(enabled); setPolicy((current) => ({ ...current, customerNotificationsEnabled: enabled })); },
    setCustomerChannelEnabled: (channel: 'email' | 'whatsapp' | 'sms', enabled: boolean) => { mocks.setChannels(channel, enabled); const key = channel === 'email' ? 'customerEmailNotificationsEnabled' : channel === 'whatsapp' ? 'customerWhatsAppNotificationsEnabled' : 'customerSmsNotificationsEnabled'; setPolicy((current) => ({ ...current, [key]: enabled })); },
    setContractNotificationsEnabled: (enabled: boolean) => { mocks.setContractsMaster(enabled); setPolicy((current) => ({ ...current, contractNotificationsEnabled: enabled })); },
    setContractChannelEnabled: (channel: 'email' | 'whatsapp', enabled: boolean) => { mocks.setContractsChannel(channel, enabled); const key = channel === 'email' ? 'contractEmailNotificationsEnabled' : 'contractWhatsAppNotificationsEnabled'; setPolicy((current) => ({ ...current, [key]: enabled })); },
  });
  },
}));

describe('AsaasNotificationSettings', () => {
  beforeEach(() => vi.clearAllMocks());

  it('organiza avisos de cobrança em uma política e deixa seções secundárias fechadas', () => {
    render(<AsaasNotificationSettings />);
    expect(screen.getByRole('heading', { name: 'Notificações de cobrança' })).toBeInTheDocument();
    expect(screen.getByText('Ao criar cobrança')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Como avisar os responsáveis' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Quando enviar' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Canal E-mail para responsáveis' })).toBeInTheDocument();
    expect(screen.getByText(/Não se aplica a cobranças geradas automaticamente/)).toHaveClass('sr-only');
    expect(screen.getByRole('button', { name: 'Informações sobre o aviso ao criar cobrança' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Outros avisos' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Avisos para a escola' })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('button', { name: 'Salvar e aplicar' })).toBeDisabled();
    const billingPanel = screen.getByRole('heading', { name: 'Notificações de cobrança' }).closest('section');
    expect(billingPanel).toContainElement(screen.getByRole('status'));
  });

  it('usa ações Ativar/Desativar no controle mestre e preserva as preferências individuais', () => {
    render(<AsaasNotificationSettings />);
    const billingToggle = within(screen.getByRole('radiogroup', { name: 'Avisos automáticos para pagadores' }));
    expect(billingToggle.getByRole('radio', { name: 'Ativar' })).toBeInTheDocument();
    expect(billingToggle.getByRole('radio', { name: 'Desativar' })).toBeInTheDocument();
    expect(billingToggle.getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Desativar', 'Ativar']);
    fireEvent.click(billingToggle.getByRole('radio', { name: 'Desativar' }));
    expect(mocks.setCustomerEnabled).toHaveBeenCalledWith(false);
    expect(billingToggle.getByRole('radio', { name: 'Desativar' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Ao criar cobrança')).toBeInTheDocument();
    expect(screen.getByText(/Canais preservados enquanto os avisos automáticos estão desativados/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Aviso Ao criar cobrança' })).toHaveAttribute('aria-checked', 'true');
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('habilita salvar ao alterar a seleção individual de um aviso', () => {
    render(<AsaasNotificationSettings />);
    expect(screen.getByRole('button', { name: 'Salvar e aplicar' })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Aviso Ao criar cobrança' }));
    expect(mocks.update).toHaveBeenCalledWith('PAYMENT_CREATED', 0, { customerEnabled: false });
    expect(screen.getByRole('button', { name: 'Salvar e aplicar' })).toBeEnabled();
  });

  it('altera os canais globais sem misturá-los às opções de evento', () => {
    render(<AsaasNotificationSettings />);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Canal WhatsApp para responsáveis' }));
    expect(screen.getByRole('checkbox', { name: 'Aviso Ao criar cobrança' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'WhatsApp — Ao criar cobrança' })).not.toBeInTheDocument();
  });

  it('expõe status pendente e a limitação das preferências legadas sem origem conhecida', () => {
    render(<AsaasNotificationSettings />);
    expect(screen.getByText('2 pagador(es) aguardando aplicação.')).toBeInTheDocument();
    expect(screen.getByText(/Não há registro local que diferencie uma escolha do pagador/)).toBeInTheDocument();
  });

  it('expõe mestre e canais de contrato digital, preservando a seleção ao desativar', () => {
    render(<AsaasNotificationSettings />);
    expect(screen.getByRole('heading', { name: 'Notificações de contratos digitais' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Canal E-mail para contratos digitais' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Canal WhatsApp para contratos digitais' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Acessar contratos' })).not.toBeInTheDocument();
    const contractPanel = screen.getByRole('heading', { name: 'Notificações de contratos digitais' }).closest('section');
    const saveFooter = screen.getByRole('button', { name: 'Salvar e aplicar' }).closest('footer');
    expect(contractPanel?.compareDocumentPosition(saveFooter!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const contractToggle = within(screen.getByRole('radiogroup', { name: 'Envio automático de notificações de contratos' }));
    expect(contractToggle.getByRole('radio', { name: 'Ativar' })).toBeInTheDocument();
    expect(contractToggle.getByRole('radio', { name: 'Desativar' })).toBeInTheDocument();
    expect(contractToggle.getAllByRole('radio').map((radio) => radio.textContent)).toEqual(['Desativar', 'Ativar']);
    fireEvent.click(contractToggle.getByRole('radio', { name: 'Desativar' }));
    expect(mocks.setContractsMaster).toHaveBeenCalledWith(false);
    expect(contractToggle.getByRole('radio', { name: 'Desativar' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText(/Canais preservados enquanto o envio automático estiver desativado/)).toBeInTheDocument();
  });

  it('mostra rótulos em português e offsets naturais nos avisos para a escola', () => {
    render(<AsaasNotificationSettings />);
    fireEvent.click(screen.getByRole('button', { name: 'Avisos para a escola' }));
    expect(screen.getByText('Cobrança criada')).toBeInTheDocument();
    expect(screen.getAllByText('Aviso de vencimento')).toHaveLength(2);
    expect(screen.getAllByText('No vencimento')).toHaveLength(2);
    expect(screen.getByText('5 dias antes do vencimento')).toBeInTheDocument();
    expect(screen.getAllByText('Cobrança atrasada')).toHaveLength(2);
    expect(screen.getByText('No primeiro dia de atraso')).toBeInTheDocument();
    expect(screen.getByText('7 dias após o vencimento')).toBeInTheDocument();
    expect(screen.getByText('Pagamento recebido')).toBeInTheDocument();
    expect(screen.getByText('Cobrança atualizada')).toBeInTheDocument();
    expect(screen.getByText('Linha digitável não visualizada')).toBeInTheDocument();
    expect(screen.queryByText(/payment|send linha digitavel/i)).not.toBeInTheDocument();
  });
});
