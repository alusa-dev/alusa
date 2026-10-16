import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const { handleAccountWebhookMock } = vi.hoisted(() => ({
  handleAccountWebhookMock: vi.fn(),
}));

vi.mock('../account-webhook-handler', () => ({
  handleAccountWebhook: handleAccountWebhookMock,
}));

import { prisma } from '@alusa/database';
import { processAsaasWebhookQueue } from '../asaas-webhook-handler.server';
import { runWebhookScheduler } from '../webhook-scheduler.service';

describe('webhook queue persisted replay convergence', () => {
  let contaId: string | null = null;
  let otherContaId: string | null = null;
  let originalMaxAttempts: string | undefined;
  let originalResendApiKey: string | undefined;
  let originalFetch: typeof globalThis.fetch | undefined;

  afterEach(async () => {
    if (contaId) {
      await prisma.financeWebhookSideEffectOutbox.deleteMany({ where: { contaId } });
      await prisma.webhookAsaas.deleteMany({ where: { contaId } });
      await prisma.conta.deleteMany({ where: { id: contaId } });
      contaId = null;
    }
    if (otherContaId) {
      await prisma.financeWebhookSideEffectOutbox.deleteMany({ where: { contaId: otherContaId } });
      await prisma.webhookAsaas.deleteMany({ where: { contaId: otherContaId } });
      await prisma.conta.deleteMany({ where: { id: otherContaId } });
      otherContaId = null;
    }
    if (originalMaxAttempts === undefined) {
      delete process.env.FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS;
    } else {
      process.env.FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS = originalMaxAttempts;
    }
    originalMaxAttempts = undefined;
    if (originalResendApiKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = originalResendApiKey;
    originalResendApiKey = undefined;
    if (originalFetch) vi.stubGlobal('fetch', originalFetch);
    else vi.unstubAllGlobals();
    originalFetch = undefined;
    vi.clearAllMocks();
  });

  // This package-level DB harness exercises the real scheduler, queue and lock
  // against local Postgres. HTTP 500 mapping is intentionally covered by the
  // adjacent apps/web route unit test, which isolates Next route dependencies.
  it('retries a persisted scheduler partial failure once and skips a concurrent scheduler owner', async () => {
    originalMaxAttempts = process.env.FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS;
    process.env.FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS = '5';
    originalResendApiKey = process.env.RESEND_API_KEY;
    process.env.RESEND_API_KEY = 'scheduler-integration-test-key';
    originalFetch = globalThis.fetch;
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: 'temporary failure' }), { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'resend-message-accepted' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Scheduler Retry Integration',
        cpfCnpj: `00${unique.replaceAll('-', '').slice(0, 12)}`,
      },
    });
    contaId = conta.id;

    const eventId = `evt_${randomUUID()}`;
    const hook = await prisma.webhookAsaas.create({
      data: {
        contaId,
        evento: 'ACCOUNT_STATUS_APPROVED',
        eventId,
        payload: { id: eventId, event: 'ACCOUNT_STATUS_APPROVED' },
        status: 'PENDENTE',
        tentativas: 0,
      },
    });
    const outbox = await prisma.financeWebhookSideEffectOutbox.create({
      data: {
        contaId,
        effectType: 'EVENT_PUBLIC_ORDER_CREATED_EMAIL',
        dedupeKey: `created-email:${randomUUID()}`,
        payload: {
          orderId: `order-${randomUUID()}`,
          buyerEmail: 'buyer@example.test',
          buyerName: 'Integration Buyer',
          eventName: 'Evento de integração',
          eventStartsAt: '2026-11-01T20:00:00.000Z',
          statusPath: '/pedido/integration-order',
          invoiceUrl: null,
          paymentMethod: 'PIX',
          expiresAt: '2026-10-17T20:00:00.000Z',
        },
        status: 'PENDING',
        attempts: 0,
        availableAt: new Date('2000-01-01T00:00:00.000Z'),
      },
    });

    let signalHandlerStarted: () => void = () => undefined;
    let releaseHandler: () => void = () => undefined;
    const handlerStarted = new Promise<void>((resolve) => { signalHandlerStarted = resolve; });
    const handlerGate = new Promise<void>((resolve) => { releaseHandler = resolve; });
    handleAccountWebhookMock.mockImplementationOnce(async () => {
      signalHandlerStarted();
      await handlerGate;
      return { success: false, error: 'transient_handler_failure' };
    }).mockResolvedValue({ success: true });

    const options = {
      contaId,
      drainLimit: 10,
      skipHealthCheck: true,
      skipDriftCheck: true,
      skipArchive: true,
    };
    const firstRunPromise = runWebhookScheduler(options);
    let concurrentRun;
    try {
      await handlerStarted;
      concurrentRun = await runWebhookScheduler(options);
    } finally {
      releaseHandler();
    }

    const firstRun = await firstRunPromise;
    expect(firstRun.hasErrors).toBe(true);
    expect(firstRun.skippedDueToLock).not.toBe(true);
    expect(concurrentRun).toMatchObject({ skippedDueToLock: true, hasErrors: false });
    const firstOutboxState = await prisma.financeWebhookSideEffectOutbox.findFirst({
      where: { id: outbox.id, contaId },
      select: { status: true, attempts: true, deliveryStatus: true },
    });
    expect(firstOutboxState).toMatchObject({ status: 'PENDING', attempts: 1, deliveryStatus: 'FAILED' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const retryEligibilityUpdated = await prisma.webhookAsaas.updateMany({
      where: { id: hook.id, contaId, status: 'ERRO' },
      data: { nextRetryAt: new Date('2000-01-01T00:00:00.000Z') },
    });
    expect(retryEligibilityUpdated.count).toBe(1);
    const outboxRetryEligibilityUpdated = await prisma.financeWebhookSideEffectOutbox.updateMany({
      where: { id: outbox.id, contaId, status: 'PENDING' },
      data: { availableAt: new Date('2000-01-01T00:00:00.000Z') },
    });
    expect(outboxRetryEligibilityUpdated.count).toBe(1);

    const retryRun = await runWebhookScheduler(options);
    expect(retryRun.skippedDueToLock).not.toBe(true);
    const [persistedHook, persistedOutbox] = await Promise.all([
      prisma.webhookAsaas.findFirst({ where: { id: hook.id, contaId } }),
      prisma.financeWebhookSideEffectOutbox.findFirst({ where: { id: outbox.id, contaId } }),
    ]);

    expect(retryRun.hasErrors).toBe(false);
    expect(persistedHook).toMatchObject({ status: 'PROCESSADO', tentativas: 2, contaId });
    expect(persistedHook?.attemptsLog).toHaveLength(2);
    expect(handleAccountWebhookMock).toHaveBeenCalledTimes(2);
    expect(persistedOutbox).toMatchObject({
      status: 'PROCESSED',
      attempts: 2,
      deliveryStatus: 'SENT',
      providerMessageId: 'resend-message-accepted',
      contaId,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const idempotencyKeys = fetchMock.mock.calls.map(([, request]) =>
      new Headers((request as RequestInit).headers).get('Idempotency-Key'),
    );
    expect(idempotencyKeys).toEqual([
      `event-order-created-email:${(outbox.payload as { orderId: string }).orderId}`,
      `event-order-created-email:${(outbox.payload as { orderId: string }).orderId}`,
    ]);
    const providerResponses = await Promise.all(fetchMock.mock.results.map((result) =>
      result.type === 'return' ? result.value : Promise.reject(result.value),
    ));
    expect(providerResponses.filter((response) => (response as Response).status === 200)).toHaveLength(1);
  });

  it('retries only the failed tenant row after a partial queue run', async () => {
    originalMaxAttempts = process.env.FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS;
    process.env.FINANCE_WEBHOOK_REPROCESS_MAX_ATTEMPTS = '5';
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Webhook Replay Integration',
        cpfCnpj: `00${unique.replaceAll('-', '').slice(0, 12)}`,
      },
    });
    contaId = conta.id;
    const otherUnique = randomUUID();
    const otherConta = await prisma.conta.create({
      data: {
        nome: 'Outra Conta Webhook Replay Integration',
        cpfCnpj: `00${otherUnique.replaceAll('-', '').slice(0, 12)}`,
      },
    });
    otherContaId = otherConta.id;

    const eventA = `evt_${randomUUID()}`;
    const eventB = `evt_${randomUUID()}`;
    const eventOtherTenant = `evt_${randomUUID()}`;
    const hookA = await prisma.webhookAsaas.create({
      data: {
        contaId,
        evento: 'ACCOUNT_STATUS_APPROVED',
        eventId: eventA,
        payload: { id: eventA, event: 'ACCOUNT_STATUS_APPROVED' },
        status: 'PENDENTE',
        tentativas: 0,
      },
    });
    const hookB = await prisma.webhookAsaas.create({
      data: {
        contaId,
        evento: 'ACCOUNT_STATUS_APPROVED',
        eventId: eventB,
        payload: { id: eventB, event: 'ACCOUNT_STATUS_APPROVED' },
        status: 'PENDENTE',
        tentativas: 0,
      },
    });
    const hookOtherTenant = await prisma.webhookAsaas.create({
      data: {
        contaId: otherContaId,
        evento: 'ACCOUNT_STATUS_APPROVED',
        eventId: eventOtherTenant,
        payload: { id: eventOtherTenant, event: 'ACCOUNT_STATUS_APPROVED' },
        status: 'PENDENTE',
        tentativas: 0,
      },
    });

    let eventBAttempts = 0;
    handleAccountWebhookMock.mockImplementation(async (_tenantId: string, input: { payloadId: string }) => {
      if (input.payloadId === eventA) return { success: true };
      eventBAttempts += 1;
      if (eventBAttempts === 1) return { success: false, error: 'transient_handler_failure' };
      return { success: true };
    });

    const firstRun = await processAsaasWebhookQueue({
      contaId,
      limit: 10,
      statuses: ['PENDENTE', 'ERRO'],
      source: 'WEBHOOK',
    });

    expect(firstRun).toMatchObject({ attempted: 2, processed: 1, failed: 1, skipped: 0 });

    const retryEligibilityUpdated = await prisma.webhookAsaas.updateMany({
      where: { id: hookB.id, contaId, status: 'ERRO' },
      // The test Postgres instance may use a different local timezone than
      // the Node process; a full day keeps eligibility unambiguous.
      data: { nextRetryAt: new Date(Date.now() - 24 * 60 * 60_000) },
    });
    expect(retryEligibilityUpdated.count).toBe(1);
    const retryableB = await prisma.webhookAsaas.findFirst({
      where: { id: hookB.id, contaId },
      select: { status: true, tentativas: true, nextRetryAt: true },
    });
    expect(retryableB).toMatchObject({ status: 'ERRO', tentativas: 1 });
    expect(retryableB?.nextRetryAt?.getTime()).toBeLessThan(Date.now());

    const secondRun = await processAsaasWebhookQueue({
      contaId,
      limit: 10,
      statuses: ['PENDENTE', 'ERRO'],
      source: 'WEBHOOK',
    });

    expect(secondRun).toMatchObject({ attempted: 1, processed: 1, failed: 0, skipped: 0 });

    const [persistedA, persistedB] = await Promise.all([
      prisma.webhookAsaas.findFirst({ where: { id: hookA.id, contaId } }),
      prisma.webhookAsaas.findFirst({ where: { id: hookB.id, contaId } }),
    ]);
    const persistedOtherTenant = await prisma.webhookAsaas.findFirst({
      where: { id: hookOtherTenant.id, contaId: otherContaId },
    });

    expect(persistedA).toMatchObject({ status: 'PROCESSADO', tentativas: 1, contaId });
    expect(persistedB).toMatchObject({ status: 'PROCESSADO', tentativas: 2, contaId });
    expect(persistedA?.attemptsLog).toHaveLength(1);
    expect(persistedB?.attemptsLog).toHaveLength(2);
    expect(handleAccountWebhookMock.mock.calls.filter(([, input]) => input.payloadId === eventA)).toHaveLength(1);
    expect(handleAccountWebhookMock.mock.calls.filter(([, input]) => input.payloadId === eventB)).toHaveLength(2);
    expect(persistedA?.attemptsLog).toEqual([
      expect.objectContaining({ ok: true, status: 'PROCESSADO', source: 'WEBHOOK' }),
    ]);
    expect(persistedB?.attemptsLog).toEqual([
      expect.objectContaining({ ok: false, status: 'ERRO', source: 'WEBHOOK' }),
      expect.objectContaining({ ok: true, status: 'PROCESSADO', source: 'WEBHOOK' }),
    ]);
    expect(persistedOtherTenant).toMatchObject({
      status: 'PENDENTE',
      tentativas: 0,
      contaId: otherContaId,
    });
    expect(persistedOtherTenant?.attemptsLog).toBeNull();
    expect(handleAccountWebhookMock.mock.calls.filter(([, input]) => input.payloadId === eventOtherTenant)).toHaveLength(0);
  });

  it('processes a persisted row once across concurrent tenant drains and leaves another tenant untouched', async () => {
    const unique = randomUUID();
    const conta = await prisma.conta.create({
      data: {
        nome: 'Conta Webhook Concurrent Integration',
        cpfCnpj: `00${unique.replaceAll('-', '').slice(0, 12)}`,
      },
    });
    contaId = conta.id;
    const otherUnique = randomUUID();
    const otherConta = await prisma.conta.create({
      data: {
        nome: 'Outra Conta Webhook Concurrent Integration',
        cpfCnpj: `00${otherUnique.replaceAll('-', '').slice(0, 12)}`,
      },
    });
    otherContaId = otherConta.id;

    const eventA = `evt_${randomUUID()}`;
    const eventB = `evt_${randomUUID()}`;
    const hookA = await prisma.webhookAsaas.create({
      data: {
        contaId,
        evento: 'ACCOUNT_STATUS_APPROVED',
        eventId: eventA,
        payload: { id: eventA, event: 'ACCOUNT_STATUS_APPROVED' },
        status: 'PENDENTE',
        tentativas: 0,
      },
    });
    const hookB = await prisma.webhookAsaas.create({
      data: {
        contaId: otherContaId,
        evento: 'ACCOUNT_STATUS_APPROVED',
        eventId: eventB,
        payload: { id: eventB, event: 'ACCOUNT_STATUS_APPROVED' },
        status: 'PENDENTE',
        tentativas: 0,
      },
    });

    let signalHandlerStarted: () => void = () => undefined;
    let releaseHandler: () => void = () => undefined;
    const handlerStarted = new Promise<void>((resolve) => { signalHandlerStarted = resolve; });
    const handlerGate = new Promise<void>((resolve) => { releaseHandler = resolve; });
    handleAccountWebhookMock.mockImplementation(async () => {
      signalHandlerStarted();
      await handlerGate;
      return { success: true };
    });

    const firstDrain = processAsaasWebhookQueue({
      contaId,
      limit: 10,
      statuses: ['PENDENTE', 'ERRO'],
      source: 'WEBHOOK',
    });
    try {
      await handlerStarted;
      const concurrentDrain = await processAsaasWebhookQueue({
        contaId,
        limit: 10,
        statuses: ['PENDENTE', 'ERRO'],
        source: 'WEBHOOK',
      });
      expect(concurrentDrain).toMatchObject({ attempted: 0, processed: 0, failed: 0, skipped: 0 });
    } finally {
      releaseHandler();
    }

    const firstResult = await firstDrain;
    expect(firstResult).toMatchObject({ attempted: 1, processed: 1, failed: 0, skipped: 0 });
    expect(handleAccountWebhookMock).toHaveBeenCalledTimes(1);
    expect(handleAccountWebhookMock).toHaveBeenCalledWith(contaId, expect.objectContaining({ payloadId: eventA }));

    const [persistedA, persistedB] = await Promise.all([
      prisma.webhookAsaas.findFirst({ where: { id: hookA.id, contaId } }),
      prisma.webhookAsaas.findFirst({ where: { id: hookB.id, contaId: otherContaId } }),
    ]);
    expect(persistedA).toMatchObject({ status: 'PROCESSADO', tentativas: 1, contaId });
    expect(persistedA?.attemptsLog).toHaveLength(1);
    expect(persistedB).toMatchObject({ status: 'PENDENTE', tentativas: 0, contaId: otherContaId });
    expect(persistedB?.attemptsLog).toBeNull();
    expect(handleAccountWebhookMock.mock.calls.some(([, input]) => input.payloadId === eventB)).toBe(false);
  });
});
