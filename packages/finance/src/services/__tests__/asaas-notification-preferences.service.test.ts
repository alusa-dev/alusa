import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMock = {
  financeProfile: {
    findUnique: vi.fn(),
  },
  conta: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  asaasNotificationPreference: {
    findMany: vi.fn(),
    createMany: vi.fn(),
    upsert: vi.fn(),
    deleteMany: vi.fn(),
  },
  asaasCustomerNotificationOverride: { findMany: vi.fn(), upsert: vi.fn() },
  asaasNotificationPreferenceOutbox: { upsert: vi.fn(), findUnique: vi.fn(), findMany: vi.fn(), updateMany: vi.fn() },
  customer: { findMany: vi.fn() },
  aluno: { findMany: vi.fn() },
  matricula: { findMany: vi.fn() },
  $transaction: vi.fn(),
};

vi.mock('@alusa/database', () => ({
  prisma: prismaMock,
  decryptSecret: vi.fn((value: string | null | undefined) => value ?? null),
}));

vi.mock('@alusa/lib', () => ({
  loadTenantNotificationEventPreferences: vi.fn().mockResolvedValue([]),
}));

const {
  applyAsaasNotificationPreferencesToCustomer,
  ensureAsaasNotificationPreferences,
  saveAsaasCustomerNotificationPreferences,
  saveAsaasNotificationPreferences,
  listCustomerIdsWithAsaas,
} = await import('../asaas-notification-preferences.service');
const { processAsaasNotificationPreferenceOutbox } = await import('../asaas-notification-preference-outbox.service');

function buildPreference(overrides: Record<string, unknown> = {}) {
  return {
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
    createdAt: new Date('2026-04-17T00:00:00.000Z'),
    updatedAt: new Date('2026-04-17T00:00:00.000Z'),
    ...overrides,
  };
}

describe('asaas-notification-preferences.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.$transaction.mockImplementation(async (callback: (_tx: typeof prismaMock) => Promise<unknown>) =>
      callback(prismaMock),
    );
    prismaMock.asaasNotificationPreference.upsert.mockResolvedValue(buildPreference());
    prismaMock.asaasNotificationPreference.deleteMany.mockResolvedValue({ count: 0 });
    prismaMock.asaasCustomerNotificationOverride.findMany.mockResolvedValue([]);
    prismaMock.asaasCustomerNotificationOverride.upsert.mockResolvedValue({});
    prismaMock.asaasNotificationPreferenceOutbox.upsert.mockResolvedValue({});
    prismaMock.asaasNotificationPreferenceOutbox.findUnique.mockResolvedValue(null);
    prismaMock.asaasNotificationPreferenceOutbox.findMany.mockResolvedValue([]);
    prismaMock.asaasNotificationPreferenceOutbox.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.conta.update.mockResolvedValue({ notificationPolicyVersion: 2 });
    prismaMock.financeProfile.findUnique.mockResolvedValue({
      asaasCredential: null,
      asaasAccount: {
        apiKeyEncrypted: '$aact_hmlg_test',
        apiKeyStatus: 'CONNECTED',
      },
    });
    prismaMock.conta.findUnique.mockResolvedValue({
      asaasApiKeyEncrypted: null,
      asaasWebhookSecretEncrypted: null,
    });
    prismaMock.asaasNotificationPreference.findMany.mockResolvedValue([buildPreference()]);
  });

  it('faz seed idempotente com skipDuplicates e releitura final', async () => {
    prismaMock.asaasNotificationPreference.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([buildPreference()]);
    prismaMock.asaasNotificationPreference.createMany.mockResolvedValue({ count: 1 });

    const result = await ensureAsaasNotificationPreferences('conta-1');

    expect(prismaMock.asaasNotificationPreference.createMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skipDuplicates: true,
        data: expect.arrayContaining([
          expect.objectContaining({
            contaId: 'conta-1',
            event: 'PAYMENT_CREATED',
            scheduleOffset: 0,
          }),
        ]),
      }),
    );
    expect(prismaMock.asaasNotificationPreference.findMany).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({ contaId: 'conta-1', event: 'PAYMENT_CREATED' }));
  });

  it('página mais de 500 customers sob o tenant solicitado sem coletar IDs de outra conta', async () => {
    const records = [
      ...Array.from({ length: 1_001 }, (_, index) => ({ id: `a-${String(index).padStart(4, '0')}`, asaasCustomerId: `cus-a-${index}`, contaId: 'conta-a' })),
      { id: 'z-other', asaasCustomerId: 'cus-other', contaId: 'conta-b' },
    ].sort((a, b) => a.id.localeCompare(b.id));
    prismaMock.customer.findMany.mockImplementation(async (args) => records.filter((row) =>
      row.contaId === args.where.contaId && (!args.where.id?.gt || row.id > args.where.id.gt),
    ).slice(0, args.take));
    prismaMock.aluno.findMany.mockResolvedValue([]);
    prismaMock.matricula.findMany.mockResolvedValue([]);

    const ids = await listCustomerIdsWithAsaas('conta-a');

    expect(ids).toHaveLength(1_001);
    expect(new Set(ids).size).toBe(1_001);
    expect(ids).not.toContain('cus-other');
    expect(prismaMock.customer.findMany).toHaveBeenCalledTimes(3);
    expect(prismaMock.customer.findMany.mock.calls.every(([args]) => args.where.contaId === 'conta-a' && args.take === 500)).toBe(true);
  });

  it('normaliza entradas duplicadas antes de salvar', async () => {
    prismaMock.asaasNotificationPreference.findMany.mockResolvedValue([
      buildPreference({
        whatsappEnabledForCustomer: true,
      }),
    ]);
    prismaMock.asaasNotificationPreference.createMany.mockResolvedValue({ count: 1 });

    await saveAsaasNotificationPreferences('conta-1', [
      {
        event: 'PAYMENT_CREATED',
        scheduleOffset: 0,
        enabled: true,
        emailEnabledForCustomer: true,
        smsEnabledForCustomer: false,
        whatsappEnabledForCustomer: false,
      },
      {
        event: 'PAYMENT_CREATED',
        scheduleOffset: 0,
        enabled: true,
        emailEnabledForCustomer: false,
        smsEnabledForCustomer: false,
        whatsappEnabledForCustomer: true,
      },
    ]);

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.asaasNotificationPreference.upsert).toHaveBeenCalledWith({
      where: { contaId_event_scheduleOffset: { contaId: 'conta-1', event: 'PAYMENT_CREATED', scheduleOffset: 0 } },
      create: expect.objectContaining({
        contaId: 'conta-1', event: 'PAYMENT_CREATED', scheduleOffset: 0,
        emailEnabledForCustomer: false, smsEnabledForCustomer: false, whatsappEnabledForCustomer: true,
      }),
      update: expect.objectContaining({
        emailEnabledForCustomer: false, smsEnabledForCustomer: false, whatsappEnabledForCustomer: true,
      }),
    });
  });

  it('rejeita mais de um intervalo positivo por evento antes de persistir', async () => {
    await expect(saveAsaasNotificationPreferences('conta-1', [
      { ...buildPreference({ event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 5 }) },
      { ...buildPreference({ event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 15 }) },
    ] as never)).rejects.toThrow(/apenas um intervalo/i);
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it('remove e não devolve intervalo positivo antigo ao persistir offset 0', async () => {
    const dueDate = buildPreference({ event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 0 });
    prismaMock.asaasNotificationPreference.findMany.mockResolvedValue([dueDate]);

    const saved = await saveAsaasNotificationPreferences('conta-1', [dueDate] as never);

    expect(prismaMock.asaasNotificationPreference.deleteMany).toHaveBeenCalledWith({
      where: { contaId: 'conta-1', event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: { gt: 0 } },
    });
    expect(saved.filter((preference) => preference.event === 'PAYMENT_DUEDATE_WARNING' && preference.scheduleOffset > 0)).toEqual([]);
  });

  it('falha sem mutar notificações vizinhas quando o intervalo exato não existe', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [
        { id: 'offset-5', event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 5 },
        { id: 'offset-15', event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 15 },
      ] }),
    } as Response);

    await expect(saveAsaasCustomerNotificationPreferences('conta-1', 'cus-1', [{
      event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 10,
    }])).rejects.toThrow(/intervalo 10 não encontrada no Asaas/i);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRestore();
  });

  it('persiste escolha explícita e intenção idempotente antes do PUT remoto', async () => {
    const trace: string[] = [];
    const remote = {
      id: 'not-1', event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true,
      emailEnabledForProvider: false, smsEnabledForProvider: false,
      emailEnabledForCustomer: false, smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
    };
    prismaMock.asaasCustomerNotificationOverride.upsert.mockImplementation(async () => {
      trace.push('override');
      return {} as never;
    });
    prismaMock.asaasNotificationPreferenceOutbox.upsert.mockImplementation(async () => {
      trace.push('outbox');
      return {} as never;
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'PUT') {
        trace.push('put');
        return { ok: true, json: async () => ({ notifications: [] }) } as Response;
      }
      trace.push('get');
      return { ok: true, json: async () => ({ data: [remote] }) } as Response;
    });

    await expect(saveAsaasCustomerNotificationPreferences('conta-1', 'cus-1', [{
      event: 'PAYMENT_CREATED', emailEnabledForCustomer: true,
    }])).rejects.toThrow(/não foi confirmada/i);

    expect(trace.indexOf('override')).toBeLessThan(trace.indexOf('put'));
    expect(trace.indexOf('outbox')).toBeLessThan(trace.indexOf('put'));
    expect(prismaMock.asaasNotificationPreferenceOutbox.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { uq_asaas_notif_outbox_conta_dedupe: { contaId: 'conta-1', dedupeKey: 'tenant-preferences:cus-1' } },
      create: expect.objectContaining({ contaId: 'conta-1', asaasCustomerId: 'cus-1' }),
    }));
    fetchMock.mockRestore();
  });

  it('não executa PUT síncrono se o worker já reivindicou o cliente', async () => {
    const remote = {
      id: 'not-1', event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true,
      emailEnabledForProvider: false, smsEnabledForProvider: false,
      emailEnabledForCustomer: false, smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
    };
    prismaMock.asaasNotificationPreferenceOutbox.findUnique.mockResolvedValue({ status: 'PROCESSING' });
    prismaMock.asaasNotificationPreferenceOutbox.updateMany.mockResolvedValue({ count: 0 });
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      ok: true, json: async () => ({ data: [remote] }),
    } as Response);

    await expect(saveAsaasCustomerNotificationPreferences('conta-1', 'cus-1', [{
      event: 'PAYMENT_CREATED', emailEnabledForCustomer: true,
    }])).rejects.toThrow(/sincronização já está em andamento/i);

    expect(prismaMock.asaasCustomerNotificationOverride.upsert).toHaveBeenCalled();
    expect(prismaMock.asaasNotificationPreferenceOutbox.upsert).toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1); // initial GET only; no competing PUT
    fetchMock.mockRestore();
  });

  it('preserva como legado um canal remoto desativado sem override local', async () => {
    const optedOut = {
      id: 'not-1', event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true,
      emailEnabledForProvider: false, smsEnabledForProvider: false,
      emailEnabledForCustomer: false, smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
    };
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [optedOut] }) } as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ notifications: [] }) } as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [optedOut] }) } as Response);

    await applyAsaasNotificationPreferencesToCustomer('conta-1', 'cus-1');

    const batch = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { notifications: Array<Record<string, unknown>> };
    expect(batch.notifications[0]).toEqual(expect.objectContaining({ id: 'not-1', emailEnabledForCustomer: false }));
    expect(prismaMock.asaasCustomerNotificationOverride.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ source: 'LEGACY_UNVERIFIED', emailEnabledForCustomer: false }),
    }));
    fetchMock.mockRestore();
  });

  it('aplica opt-in explícito persistido mesmo se o Asaas ainda estiver com o canal desligado', async () => {
    prismaMock.asaasCustomerNotificationOverride.findMany.mockResolvedValue([{
      event: 'PAYMENT_CREATED', scheduleOffset: 0, customerEnabled: true,
      emailEnabledForCustomer: true, smsEnabledForCustomer: null,
      whatsappEnabledForCustomer: null, phoneCallEnabledForCustomer: null,
    }]);
    const remote = {
      id: 'not-1', event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true,
      emailEnabledForProvider: false, smsEnabledForProvider: false,
      emailEnabledForCustomer: false, smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
    };
    const after = { ...remote, emailEnabledForCustomer: true };
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [remote] }) } as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ notifications: [] }) } as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [after] }) } as Response);

    await applyAsaasNotificationPreferencesToCustomer('conta-1', 'cus-1');

    const batch = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { notifications: Array<Record<string, unknown>> };
    expect(batch.notifications[0]).toEqual(expect.objectContaining({ emailEnabledForCustomer: true }));
    fetchMock.mockRestore();
  });

  it('não conclui a outbox quando o PUT é ignorado pelo Asaas mesmo que o override local diga opt-in', async () => {
    const remote = {
      id: 'not-1', event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true,
      emailEnabledForProvider: false, smsEnabledForProvider: false,
      emailEnabledForCustomer: false, smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
    };
    prismaMock.asaasCustomerNotificationOverride.findMany.mockResolvedValue([{
      event: 'PAYMENT_CREATED', scheduleOffset: 0, customerEnabled: true,
      emailEnabledForCustomer: true, smsEnabledForCustomer: null,
      whatsappEnabledForCustomer: null, phoneCallEnabledForCustomer: null,
    }]);
    prismaMock.asaasNotificationPreferenceOutbox.findMany.mockResolvedValue([{
      id: 'outbox-1', contaId: 'conta-1', asaasCustomerId: 'cus-1',
      status: 'PENDING', attempts: 0, policyVersion: 1, processingAt: null, claimToken: null,
    }]);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [remote] }) } as Response);
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ notifications: [] }) } as Response);
    // Asaas accepts the request but silently retains the old raw state.
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: [remote] }) } as Response);

    const result = await processAsaasNotificationPreferenceOutbox({ contaId: 'conta-1' });

    expect(result).toMatchObject({ processed: 0, failed: 1 });
    expect(prismaMock.asaasNotificationPreferenceOutbox.updateMany).toHaveBeenNthCalledWith(2,
      expect.objectContaining({ data: expect.objectContaining({ status: 'FAILED' }) }),
    );
    expect(prismaMock.asaasNotificationPreferenceOutbox.updateMany).not.toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'DONE' }) }),
    );
    fetchMock.mockRestore();
  });

  it('desativa offsets positivos não selecionados sem desativar o aviso para a escola', async () => {
    const scheduled = [0, 5, 10, 15, 30].map((scheduleOffset) => ({
      id: `warning-${scheduleOffset}`, event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset,
      enabled: true, emailEnabledForProvider: true, smsEnabledForProvider: false,
      emailEnabledForCustomer: true, smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
    }));
    const after = scheduled.map((item) => ({ ...item }));
    prismaMock.asaasNotificationPreference.findMany.mockResolvedValue([
      buildPreference({ event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 0, emailEnabledForProvider: true }),
      buildPreference({ event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 10, emailEnabledForProvider: true }),
    ]);
    prismaMock.conta.findUnique.mockResolvedValue({
      asaasApiKeyEncrypted: null, asaasWebhookSecretEncrypted: null, customerNotificationsEnabled: false,
    });
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: scheduled }) } as Response);
    fetchMock.mockImplementationOnce(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { notifications: Array<Record<string, unknown>> };
      for (const update of body.notifications) {
        const row = after.find((item) => item.id === update.id);
        if (row) Object.assign(row, update);
      }
      return { ok: true, json: async () => ({ notifications: [] }) } as Response;
    });
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ data: after }) }) as Response);

    await applyAsaasNotificationPreferencesToCustomer('conta-1', 'cus-1');

    const batch = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { notifications: Array<Record<string, unknown>> };
    expect(batch.notifications.find((item) => item.id === 'warning-5')).toEqual({
      id: 'warning-5', emailEnabledForCustomer: false, smsEnabledForCustomer: false,
      whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
    });
    expect(batch.notifications.find((item) => item.id === 'warning-15')).toEqual(expect.objectContaining({ whatsappEnabledForCustomer: false }));
    expect(batch.notifications.find((item) => item.id === 'warning-0')).toEqual(expect.objectContaining({ emailEnabledForProvider: true }));
    fetchMock.mockRestore();
  });

  it('desativa intervalos positivos obsoletos quando o aviso configurado volta ao vencimento (offset 0)', async () => {
    const scheduled = [0, 5, 10, 15, 30].map((scheduleOffset) => ({
      id: `warning-${scheduleOffset}`, event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset,
      enabled: true, emailEnabledForProvider: true, smsEnabledForProvider: true,
      emailEnabledForCustomer: true, smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: true, phoneCallEnabledForCustomer: false,
    }));
    const after = scheduled.map((item) => ({ ...item }));
    prismaMock.asaasNotificationPreference.findMany.mockResolvedValue([
      buildPreference({ event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset: 0, emailEnabledForProvider: true }),
    ]);
    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ data: scheduled }) } as Response);
    fetchMock.mockImplementationOnce(async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { notifications: Array<Record<string, unknown>> };
      for (const update of body.notifications) {
        const row = after.find((item) => item.id === update.id);
        if (row) Object.assign(row, update);
      }
      return { ok: true, json: async () => ({ notifications: [] }) } as Response;
    });
    fetchMock.mockImplementationOnce(async () => ({ ok: true, json: async () => ({ data: after }) }) as Response);

    await applyAsaasNotificationPreferencesToCustomer('conta-1', 'cus-1');

    const batch = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { notifications: Array<Record<string, unknown>> };
    for (const offset of [5, 10, 15, 30]) {
      expect(batch.notifications.find((item) => item.id === `warning-${offset}`)).toEqual(expect.objectContaining({
        emailEnabledForCustomer: false, smsEnabledForCustomer: false,
        whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
      }));
    }
    expect(batch.notifications.find((item) => item.id === 'warning-5')).not.toHaveProperty('emailEnabledForProvider');
    fetchMock.mockRestore();
  });

  it.each([[0, 10], [10, 0]])('prioriza offset positivo sobre 0 sem depender da ordem de leitura (%j)', async (first, second) => {
    const scheduled = [0, 5, 10, 15, 30].map((scheduleOffset) => ({
      id: `warning-${scheduleOffset}`, event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset,
      enabled: true, emailEnabledForProvider: true, smsEnabledForProvider: false,
      emailEnabledForCustomer: true, smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: true, phoneCallEnabledForCustomer: false,
    }));
    let after = scheduled.map((item) => ({ ...item }));
    prismaMock.asaasNotificationPreference.findMany.mockResolvedValue([first, second].map((scheduleOffset) =>
      buildPreference({ event: 'PAYMENT_DUEDATE_WARNING', scheduleOffset, emailEnabledForProvider: true }),
    ));
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      if (init?.method === 'PUT') {
        const body = JSON.parse(String(init.body)) as { notifications: Array<Record<string, unknown>> };
        for (const update of body.notifications) {
          const row = after.find((item) => item.id === update.id);
          if (row) Object.assign(row, update);
        }
        return { ok: true, json: async () => ({ notifications: [] }) } as Response;
      }
      return { ok: true, json: async () => ({ data: after }) } as Response;
    });

    await applyAsaasNotificationPreferencesToCustomer('conta-1', 'cus-1');

    const batch = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { notifications: Array<Record<string, unknown>> };
    expect(batch.notifications.find((item) => item.id === 'warning-10')).toEqual(expect.objectContaining({
      emailEnabledForCustomer: true, smsEnabledForCustomer: true, whatsappEnabledForCustomer: false,
    }));
    for (const offset of [5, 15, 30]) {
      expect(batch.notifications.find((item) => item.id === `warning-${offset}`)).toEqual(expect.objectContaining({
        emailEnabledForCustomer: false, smsEnabledForCustomer: false, whatsappEnabledForCustomer: false,
      }));
    }
    expect(batch.notifications.find((item) => item.id === 'warning-10')).toHaveProperty('emailEnabledForProvider', true);
    fetchMock.mockRestore();
  });

  it('usa produção quando a api key salva for prod mesmo com env sandbox', async () => {
    process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';
    prismaMock.financeProfile.findUnique.mockResolvedValue({
      asaasCredential: null,
      asaasAccount: {
        apiKeyEncrypted: '$aact_prod_test',
        apiKeyStatus: 'CONNECTED',
      },
    });

    const fetchMock = vi.spyOn(globalThis, 'fetch');
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'not-1',
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
    } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ notifications: [] }),
    } as Response);
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: [{
        id: 'not-1', event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true,
        emailEnabledForProvider: false, smsEnabledForProvider: false,
        emailEnabledForCustomer: true, smsEnabledForCustomer: true,
        whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
      }] }),
    } as Response);

    await applyAsaasNotificationPreferencesToCustomer('conta-1', 'cus-prod');

    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.asaas.com/v3/customers/cus-prod/notifications');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.asaas.com/v3/notifications/batch');
    expect(fetchMock.mock.calls[2]?.[0]).toBe('https://api.asaas.com/v3/customers/cus-prod/notifications');

    fetchMock.mockRestore();
    delete process.env.ASAAS_BASE_URL;
  });
});
