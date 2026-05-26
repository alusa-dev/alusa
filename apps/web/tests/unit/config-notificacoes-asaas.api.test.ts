/**
 * Testes para /api/configuracoes/notificacoes/asaas
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { GET, POST, PUT } from '@/app/api/configuracoes/notificacoes/asaas/route';
import { getServerSession } from 'next-auth';
import {
  getAsaasNotificationPreferences,
  saveAsaasNotificationPreferences,
  applyPreferencesToAllCustomers,
} from '@alusa/finance';

vi.mock('next-auth', () => ({
  getServerSession: vi.fn(),
}));

vi.mock('@alusa/finance', () => ({
  getAsaasNotificationPreferences: vi.fn(),
  saveAsaasNotificationPreferences: vi.fn(),
  applyPreferencesToAllCustomers: vi.fn(),
}));

describe('Configurações globais de notificações Asaas', () => {
  const mockUser = { user: { id: 'user-1', role: 'ADMIN', contaId: 'conta-1' } };

  beforeEach(() => {
    vi.clearAllMocks();
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValue(mockUser);
  });

  it('GET deve retornar preferências atuais', async () => {
    (getAsaasNotificationPreferences as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'pref-1',
        contaId: 'conta-1',
        event: 'PAYMENT_CREATED',
        scheduleOffset: 0,
        enabled: true,
        emailEnabledForProvider: false,
        smsEnabledForProvider: false,
        emailEnabledForCustomer: true,
        smsEnabledForCustomer: true,
        whatsappEnabledForCustomer: false,
        phoneCallEnabledForCustomer: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferences).toHaveLength(1);
    expect(body.customerChannelDefaults).toEqual(['EMAIL', 'SMS']);
    expect(getAsaasNotificationPreferences).toHaveBeenCalledWith('conta-1');
  });

  it('GET deve bloquear usuário não autenticado', async () => {
    (getServerSession as ReturnType<typeof vi.fn>).mockResolvedValueOnce(null);
    const response = await GET();
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
    expect(saveAsaasNotificationPreferences).not.toHaveBeenCalled();
  });

  it('PUT deve salvar preferências sem aplicar em clientes existentes', async () => {
    (saveAsaasNotificationPreferences as ReturnType<typeof vi.fn>).mockResolvedValue([
      {
        id: 'pref-1',
        contaId: 'conta-1',
        event: 'PAYMENT_CREATED',
        scheduleOffset: 0,
        enabled: true,
        emailEnabledForProvider: false,
        smsEnabledForProvider: false,
        emailEnabledForCustomer: true,
        smsEnabledForCustomer: true,
        whatsappEnabledForCustomer: false,
        phoneCallEnabledForCustomer: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ]);

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
      }),
    });

    const response = await PUT(request);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.preferences).toHaveLength(1);
    expect(saveAsaasNotificationPreferences).toHaveBeenCalledWith('conta-1', expect.any(Array));
    expect(applyPreferencesToAllCustomers).not.toHaveBeenCalled();
  });

  it('POST deve iniciar sincronização em lote dos registros existentes', async () => {
    (applyPreferencesToAllCustomers as ReturnType<typeof vi.fn>).mockResolvedValue({
      processed: 2,
      successes: 2,
      failures: 0,
      errors: [],
    });

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(applyPreferencesToAllCustomers).toHaveBeenCalledWith('conta-1');
    expect(body.accepted).toBe(true);
  });
});
