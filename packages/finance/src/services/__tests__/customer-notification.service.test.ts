import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  syncCustomerNotificationChannels,
} from '../customer-notification.service';

// Mock de loadAsaasCredentials
vi.mock('@alusa/database', () => ({
  loadAsaasCredentials: vi.fn(),
  prisma: {
    asaasNotificationPreference: {
      findMany: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { loadAsaasCredentials, prisma } from '@alusa/database';

const mockLoadAsaasCredentials = loadAsaasCredentials as ReturnType<typeof vi.fn>;

// Dados de teste
const MOCK_CONTA_ID = 'conta_123';
const MOCK_CUSTOMER_ID = 'cus_000007474636';
const MOCK_API_KEY = '$aact_hmlg_000test123';

const MOCK_NOTIFICATIONS = [
  {
    id: 'not_1',
    event: 'PAYMENT_CREATED',
    enabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: false,
    smsEnabledForCustomer: false,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
    scheduleOffset: 0,
  },
  {
    id: 'not_2',
    event: 'PAYMENT_RECEIVED',
    enabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: false,
    smsEnabledForCustomer: false,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
    scheduleOffset: 0,
  },
  {
    id: 'not_3',
    event: 'PAYMENT_OVERDUE',
    enabled: true,
    emailEnabledForProvider: false,
    smsEnabledForProvider: false,
    emailEnabledForCustomer: false,
    smsEnabledForCustomer: false,
    whatsappEnabledForCustomer: false,
    phoneCallEnabledForCustomer: false,
    scheduleOffset: 0,
  },
];

describe('syncCustomerNotificationChannels', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLoadAsaasCredentials.mockResolvedValue({
      apiKey: MOCK_API_KEY,
    });

    vi.mocked(prisma.asaasNotificationPreference.findMany).mockResolvedValue([]);
    vi.mocked(prisma.asaasNotificationPreference.upsert).mockResolvedValue({} as never);
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
    delete process.env.ASAAS_BASE_URL;
  });

  it('deve retornar sucesso quando batch update funciona', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');

    // GET /customers/{id}/notifications
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: MOCK_NOTIFICATIONS }),
    } as Response);

    // PUT /notifications/batch - sucesso
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notifications: MOCK_NOTIFICATIONS }),
    } as Response);

    const result = await syncCustomerNotificationChannels(
      MOCK_CONTA_ID,
      MOCK_CUSTOMER_ID,
      { email: true, sms: true, whatsapp: false }
    );

    expect(result.success).toBe(true);
    expect(result.applied.email).toBe(true);
    expect(result.applied.sms).toBe(true);
    expect(result.applied.whatsapp).toBe(false);
    expect(result.warnings).toHaveLength(0);
  });

  it('deve fazer fallback quando WhatsApp retorna invalid_action', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    process.env.ASAAS_BASE_URL = 'https://api.asaas.com/v3';
    mockLoadAsaasCredentials.mockResolvedValueOnce({
      apiKey: '$aact_prod_000test123',
    });

    // GET /customers/{id}/notifications
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [MOCK_NOTIFICATIONS[0]] }),
    } as Response);

    // PUT /notifications/batch - falha com invalid_action para WhatsApp
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        errors: [
          {
            code: 'invalid_action',
            description: 'Evento inválido para ativação da notificação por WhatsApp.',
          },
        ],
      }),
    } as Response);

    // PUT /notifications/{id} - falha no item com WhatsApp
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        errors: [
          {
            code: 'invalid_action',
            description: 'Evento inválido para ativação da notificação por WhatsApp.',
          },
        ],
      }),
    } as Response);

    // Retry do item sem WhatsApp - sucesso
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_NOTIFICATIONS[0],
    } as Response);

    const result = await syncCustomerNotificationChannels(
      MOCK_CONTA_ID,
      MOCK_CUSTOMER_ID,
      { email: true, sms: true, whatsapp: true }
    );

    expect(result.success).toBe(true);
    expect(result.applied.email).toBe(true);
    expect(result.applied.sms).toBe(true);
    expect(result.applied.whatsapp).toBe(false); // Fallback
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings[0].channel).toBe('whatsapp');
    expect(result.warnings[0].code).toBe('invalid_action');
  });

  it('deve registrar capability quando WhatsApp retorna invalid_action', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    process.env.ASAAS_BASE_URL = 'https://api.asaas.com/v3';
    mockLoadAsaasCredentials.mockResolvedValueOnce({
      apiKey: '$aact_prod_000test123',
    });

    // Primeira chamada - falha
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [MOCK_NOTIFICATIONS[0]] }),
    } as Response);

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        errors: [{ code: 'invalid_action', description: 'WhatsApp invalid' }],
      }),
    } as Response);

    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 400,
      json: async () => ({
        errors: [{ code: 'invalid_action', description: 'WhatsApp invalid' }],
      }),
    } as Response);

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => MOCK_NOTIFICATIONS[0],
    } as Response);

    await syncCustomerNotificationChannels(
      MOCK_CONTA_ID,
      MOCK_CUSTOMER_ID,
      { email: true, sms: false, whatsapp: true }
    );

    const { prisma } = await import('@alusa/database');
    expect(prisma.asaasNotificationPreference.upsert).toHaveBeenCalled();
  });

  it('deve aplicar canais por evento sem ligar WhatsApp na linha digitável', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    process.env.ASAAS_BASE_URL = 'https://api.asaas.com/v3';
    mockLoadAsaasCredentials.mockResolvedValueOnce({
      apiKey: '$aact_prod_000test123',
    });

    const notifications = [
      MOCK_NOTIFICATIONS[0],
      {
        ...MOCK_NOTIFICATIONS[1],
        id: 'not_linha',
        event: 'SEND_LINHA_DIGITAVEL',
      },
    ];

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: notifications }),
    } as Response);

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notifications }),
    } as Response);

    const result = await syncCustomerNotificationChannels(
      MOCK_CONTA_ID,
      MOCK_CUSTOMER_ID,
      { email: true, sms: true, whatsapp: true },
      {
        eventPreferences: [
          {
            event: 'PAYMENT_CREATED',
            scheduleOffset: 0,
            enabled: true,
            emailEnabledForProvider: false,
            smsEnabledForProvider: false,
            emailEnabledForCustomer: true,
            smsEnabledForCustomer: false,
            whatsappEnabledForCustomer: true,
            phoneCallEnabledForCustomer: false,
          },
          {
            event: 'SEND_LINHA_DIGITAVEL',
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
      },
    );

    const batchBody = JSON.parse(String(fetchSpy.mock.calls[1][1]?.body));
    expect(batchBody.notifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'not_1',
          smsEnabledForCustomer: false,
          whatsappEnabledForCustomer: true,
        }),
        expect.objectContaining({
          id: 'not_linha',
          smsEnabledForCustomer: true,
          whatsappEnabledForCustomer: false,
        }),
      ]),
    );
    expect(result.success).toBe(true);
    expect(result.applied.whatsapp).toBe(true);
  });

  it('não deve lançar exceção mesmo com erro de rede', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');

    // GET falha com erro de rede
    fetchSpy.mockRejectedValueOnce(new Error('Network error'));

    const result = await syncCustomerNotificationChannels(
      MOCK_CONTA_ID,
      MOCK_CUSTOMER_ID,
      { email: true, sms: true, whatsapp: true }
    );

    expect(result.success).toBe(false);
    expect(result.applied.email).toBe(false);
    expect(result.applied.sms).toBe(false);
    expect(result.applied.whatsapp).toBe(false);
    // Não lança exceção
  });

  it('não deve atualizar se já está conforme desejado', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');

    const alreadyConfigured = MOCK_NOTIFICATIONS.map((n) => ({
      ...n,
      emailEnabledForCustomer: true,
      smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: false,
    }));

    // GET retorna já configurado
    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: alreadyConfigured }),
    } as Response);

    const result = await syncCustomerNotificationChannels(
      MOCK_CONTA_ID,
      MOCK_CUSTOMER_ID,
      { email: true, sms: true, whatsapp: false }
    );

    expect(result.success).toBe(true);
    // Não deve ter feito PUT (apenas 1 chamada de GET)
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('deve retornar falso se credenciais não existem', async () => {
    mockLoadAsaasCredentials.mockResolvedValue(null);

    const result = await syncCustomerNotificationChannels(
      MOCK_CONTA_ID,
      MOCK_CUSTOMER_ID,
      { email: true, sms: true, whatsapp: true }
    );

    expect(result.success).toBe(false);
  });

  it('não deve bloquear createStandaloneCharge em caso de falha', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');

    // GET retorna erro 500
    fetchSpy.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error',
    } as Response);

    // Não deve lançar exceção
    const result = await syncCustomerNotificationChannels(
      MOCK_CONTA_ID,
      MOCK_CUSTOMER_ID,
      { email: true, sms: true, whatsapp: true }
    );

    expect(result.success).toBe(false);
    // A função retorna normalmente, não lança
  });

  it('deve desabilitar WhatsApp em sandbox sem falhar', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');

    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: MOCK_NOTIFICATIONS }),
    } as Response);

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notifications: MOCK_NOTIFICATIONS }),
    } as Response);

    const result = await syncCustomerNotificationChannels(
      MOCK_CONTA_ID,
      MOCK_CUSTOMER_ID,
      { email: true, sms: true, whatsapp: true }
    );

    expect(result.success).toBe(true);
    expect(result.applied.whatsapp).toBe(false);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('deve usar produção quando a api key salva for prod mesmo com env sandbox', async () => {
    fetchSpy = vi.spyOn(globalThis, 'fetch');
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';

    mockLoadAsaasCredentials.mockResolvedValueOnce({
      apiKey: '$aact_prod_000test123',
    });

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: MOCK_NOTIFICATIONS }),
    } as Response);

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notifications: MOCK_NOTIFICATIONS }),
    } as Response);

    const result = await syncCustomerNotificationChannels(
      MOCK_CONTA_ID,
      MOCK_CUSTOMER_ID,
      { email: true, sms: true, whatsapp: false }
    );

    expect(result.success).toBe(true);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe(
      `https://api.asaas.com/v3/customers/${MOCK_CUSTOMER_ID}/notifications`
    );
    expect(fetchSpy.mock.calls[1]?.[0]).toBe('https://api.asaas.com/v3/notifications/batch');
  });
});
