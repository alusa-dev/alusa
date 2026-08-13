import { describe, expect, it } from 'vitest';
import {
  deriveEventPreferencesForChannelSelection,
  channelsFromSelection,
} from '../tenant-notification-preferences';

describe('tenant-notification-preferences', () => {
  const tenantPrefs = [
    {
      event: 'PAYMENT_CREATED' as const,
      scheduleOffset: 0,
      enabled: true,
      emailEnabledForProvider: false,
      smsEnabledForProvider: false,
      emailEnabledForCustomer: true,
      smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: true,
      phoneCallEnabledForCustomer: false,
    },
    {
      event: 'PAYMENT_OVERDUE' as const,
      scheduleOffset: 0,
      enabled: true,
      emailEnabledForProvider: true,
      smsEnabledForProvider: false,
      emailEnabledForCustomer: true,
      smsEnabledForCustomer: false,
      whatsappEnabledForCustomer: false,
      phoneCallEnabledForCustomer: true,
    },
  ];

  it('channelsFromSelection maps wizard values', () => {
    expect(channelsFromSelection(['EMAIL', 'SMS'])).toEqual({
      email: true,
      sms: true,
      whatsapp: false,
    });
  });

  it('deriveEventPreferencesForChannelSelection limits customer channels only', () => {
    const derived = deriveEventPreferencesForChannelSelection(tenantPrefs, {
      email: true,
      sms: false,
      whatsapp: false,
    });

    expect(derived[0].emailEnabledForCustomer).toBe(true);
    expect(derived[0].smsEnabledForCustomer).toBe(false);
    expect(derived[0].whatsappEnabledForCustomer).toBe(false);
    expect(derived[0].emailEnabledForProvider).toBe(false);

    expect(derived[1].emailEnabledForCustomer).toBe(true);
    expect(derived[1].phoneCallEnabledForCustomer).toBe(true);
    expect(derived[1].emailEnabledForProvider).toBe(true);
  });

  it('faz a seleção explícita do wizard prevalecer sobre os defaults globais', () => {
    const derived = deriveEventPreferencesForChannelSelection(tenantPrefs, {
      email: false,
      sms: false,
      whatsapp: true,
    });

    expect(derived[0].emailEnabledForCustomer).toBe(false);
    expect(derived[0].smsEnabledForCustomer).toBe(false);
    expect(derived[0].whatsappEnabledForCustomer).toBe(true);

    // A preferência global pode estar desligada, mas não bloqueia a escolha do wizard.
    expect(derived[1].whatsappEnabledForCustomer).toBe(true);
  });

  it('mantém canais do cliente desligados quando o evento está desabilitado', () => {
    const derived = deriveEventPreferencesForChannelSelection(
      [{ ...tenantPrefs[0], enabled: false }],
      { email: true, sms: true, whatsapp: true },
    );

    expect(derived[0].emailEnabledForCustomer).toBe(false);
    expect(derived[0].smsEnabledForCustomer).toBe(false);
    expect(derived[0].whatsappEnabledForCustomer).toBe(false);
  });
});
