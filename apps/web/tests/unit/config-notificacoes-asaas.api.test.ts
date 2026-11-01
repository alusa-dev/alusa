/**
 * Testes para /api/configuracoes/notificacoes/asaas
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PUT } from '@/app/api/configuracoes/notificacoes/asaas/route';
import { resolveTenantSession } from '@/lib/api/with-tenant-session';
import {
  getAsaasNotificationPreferences,
  getAsaasNotificationPolicy,
  saveAsaasNotificationPolicyAndEnqueue,
  enqueueAsaasNotificationPreferenceSyncForTenant,
} from '@alusa/finance';

vi.mock('@/lib/api/with-tenant-session', () => ({
  resolveTenantSession: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  getAsaasNotificationPreferences: vi.fn(),
  getAsaasNotificationPolicy: vi.fn(),
  saveAsaasNotificationPolicyAndEnqueue: vi.fn(),
  enqueueAsaasNotificationPreferenceSyncForTenant: vi.fn(),
}));

vi.mock('@/src/server/platform-billing/capacity', () => ({
  platformBillingAccessResponseForConta: vi.fn().mockResolvedValue(null),
}));

describe('Configurações globais de notificações Asaas', () => {
  const mockPolicy = {
    policy: {
      customerNotificationsEnabled: true,
      customerEmailNotificationsEnabled: true,
      customerWhatsAppNotificationsEnabled: true,
      customerSmsNotificationsEnabled: true,
      contractWhatsAppNotificationsEnabled: false,
      contractNotificationsEnabled: true,
      contractEmailNotificationsEnabled: true,
      version: 1,
    },
    synchronization: { pending: 0, failed: 0, legacyPreferenceUnknown: 0 },
  };
  const mockPreference = (event: string, scheduleOffset: number, id = `${event}-${scheduleOffset}`) => ({
    id,
    contaId: 'conta-1',
    event,
    scheduleOffset,
    enabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: true,
    smsEnabledForCustomer: true,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveTenantSession).mockResolvedValue({ ok: true, contaId: 'conta-1', userId: 'user-1', role: 'ADMIN' });
    vi.mocked(getAsaasNotificationPolicy).mockResolvedValue(mockPolicy);
    vi.mocked(saveAsaasNotificationPolicyAndEnqueue).mockResolvedValue({
      preferences: [mockPreference('PAYMENT_CREATED', 0)],
      enqueued: 0,
      policy: mockPolicy.policy,
    } as never);
  });

  it('GET deve retornar preferências atuais', async () => {
    vi.mocked(getAsaasNotificationPreferences).mockResolvedValue([mockPreference('PAYMENT_CREATED', 0)]);

    const response = await GET(new Request('http://localhost/api/configuracoes/notificacoes/asaas'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferences).toHaveLength(1);
    expect(body.customerChannelDefaults).toEqual(['EMAIL', 'SMS']);
    expect(getAsaasNotificationPreferences).toHaveBeenCalledWith('conta-1');
  });

  it('GET normaliza offsets legados [5,10] e preserva uma única preferência positiva', async () => {
    vi.mocked(getAsaasNotificationPreferences).mockResolvedValue([
      mockPreference('PAYMENT_DUEDATE_WARNING', 0),
      mockPreference('PAYMENT_DUEDATE_WARNING', 5),
      mockPreference('PAYMENT_DUEDATE_WARNING', 10),
      mockPreference('PAYMENT_CREATED', 0),
    ]);

    const response = await GET(new Request('http://localhost/api/configuracoes/notificacoes/asaas'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferences.filter((preference: { event: string; scheduleOffset: number }) =>
      preference.event === 'PAYMENT_DUEDATE_WARNING' && preference.scheduleOffset > 0,
    )).toHaveLength(1);
    expect(body.preferences.find((preference: { event: string; scheduleOffset: number }) =>
      preference.event === 'PAYMENT_DUEDATE_WARNING' && preference.scheduleOffset > 0,
    )?.scheduleOffset).toBe(10);
    expect(body.preferences).toHaveLength(3);
  });

  it('GET deve bloquear usuário não autenticado', async () => {
    vi.mocked(resolveTenantSession).mockResolvedValueOnce({ ok: false, reason: 'UNAUTHENTICATED' });
    const response = await GET(new Request('http://localhost/api/configuracoes/notificacoes/asaas'));
    expect(response.status).toBe(401);
  });

  it('PUT deve validar payload inválido', async () => {
    const request = new NextRequest('http://localhost/api/configuracoes/notificacoes/asaas', {
      method: 'PUT',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    });
    const response = await PUT(request);
    expect(response.status).toBe(422);
    expect(saveAsaasNotificationPolicyAndEnqueue).not.toHaveBeenCalled();
  });

  it('PUT deve salvar preferências sem aplicar em clientes existentes', async () => {
    const request = new NextRequest('http://localhost/api/configuracoes/notificacoes/asaas', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        preferences: [
          {
            event: 'PAYMENT_CREATED',
            scheduleOffset: 0,
            enabled: true,
            emailEnabledForProvider: false,
            smsEnabledForProvider: false,
            emailEnabledForCustomer: true,
            smsEnabledForCustomer: true,
            whatsappEnabledForCustomer: false,
            phoneCallEnabledForCustomer: false,
          },
        ],
        policy: {
          customerNotificationsEnabled: true,
          customerEmailNotificationsEnabled: true,
          customerWhatsAppNotificationsEnabled: true,
          customerSmsNotificationsEnabled: true,
          contractWhatsAppNotificationsEnabled: false,
          contractNotificationsEnabled: true,
          contractEmailNotificationsEnabled: true,
        },
      }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferences).toHaveLength(1);
    expect(saveAsaasNotificationPolicyAndEnqueue).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-1', preferences: expect.any(Array) }));
    expect(enqueueAsaasNotificationPreferenceSyncForTenant).not.toHaveBeenCalled();
  });

  it('POST deve enfileirar sincronização dos registros existentes', async () => {
    (enqueueAsaasNotificationPreferenceSyncForTenant as ReturnType<typeof vi.fn>).mockResolvedValue({
      enqueued: 2,
      customerIds: ['cus_1', 'cus_2'],
    });

    const response = await POST(new Request('http://localhost/api/configuracoes/notificacoes/asaas', { method: 'POST' }));
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(enqueueAsaasNotificationPreferenceSyncForTenant).toHaveBeenCalledWith({
      contaId: 'conta-1',
      reason: 'CONFIGURACAO_GLOBAL_ATUALIZADA',
    });
    expect(body.accepted).toBe(true);
    expect(body.enqueued).toBe(2);
  });
});
