import { beforeEach, describe, expect, it, vi } from 'vitest';

const ledger = vi.hoisted(() => ({
  expectedEventsForPaymentCommand: vi.fn(() => ['PAYMENT_REFUNDED']),
  claimPaymentRefundCommandForDispatch: vi.fn(),
  failPaymentCommand: vi.fn(),
  markPaymentCommandNeedsReconciliation: vi.fn(),
  markPaymentCommandSent: vi.fn(),
  registerPaymentCommand: vi.fn(),
}));

vi.mock('./payment-command-ledger', () => ledger);

import { runAsaasPaymentCommand } from './run-asaas-payment-command';

describe('runAsaasPaymentCommand callback context', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ledger.registerPaymentCommand.mockResolvedValue({ id: 'command-stable-1' });
    ledger.markPaymentCommandSent.mockResolvedValue(undefined);
    ledger.claimPaymentRefundCommandForDispatch.mockResolvedValue({ claimed: true, activeCommand: null });
  });

  it('passes the persisted command ID to the remote operation for retry-safe refund identity', async () => {
    const run = vi.fn(async (context: { commandJobId: string; correlationId: string }) => context.commandJobId);
    const output = await runAsaasPaymentCommand({
      contaId: 'tenant-1', type: 'PAYMENT_REFUND_COMMAND', entityType: 'CHARGE', entityId: 'charge-1',
      asaasPaymentId: 'pay-1', actorId: 'user-1', correlationId: 'corr-1', run,
    });

    expect(run).toHaveBeenCalledWith({ commandJobId: 'command-stable-1', correlationId: 'corr-1' });
    expect(output.result).toBe('command-stable-1');
    expect(output.alreadyDispatched).toBe(false);
  });

  it('keeps an ambiguous gateway 503 out of terminal failed state', async () => {
    const error = Object.assign(new Error('command already dispatched'), { status: 503 });
    await expect(runAsaasPaymentCommand({
      contaId: 'tenant-1', type: 'PAYMENT_REFUND_COMMAND', entityType: 'CHARGE', entityId: 'charge-1',
      asaasPaymentId: 'pay-1', actorId: 'user-1', reconcileAmbiguousFailure: true,
      run: async () => { throw error; },
    })).rejects.toBe(error);

    expect(ledger.markPaymentCommandNeedsReconciliation).toHaveBeenCalledWith({ jobId: 'command-stable-1', error });
    expect(ledger.failPaymentCommand).not.toHaveBeenCalled();
  });

  it('treats terminal refund gateway configuration errors as failed, not reconciliation', async () => {
    const error = Object.assign(new Error('gateway configuration missing'), { status: 400 });
    await expect(runAsaasPaymentCommand({
      contaId: 'tenant-1', type: 'PAYMENT_REFUND_COMMAND', entityType: 'CHARGE', entityId: 'charge-1',
      asaasPaymentId: 'pay-1', actorId: 'user-1', reconcileAmbiguousFailure: true,
      run: async () => { throw error; },
    })).rejects.toBe(error);

    expect(ledger.failPaymentCommand).toHaveBeenCalledWith({ jobId: 'command-stable-1', error });
    expect(ledger.markPaymentCommandNeedsReconciliation).not.toHaveBeenCalled();
  });

  it('preserves the previous terminal failure behavior unless explicitly opted in', async () => {
    const error = Object.assign(new Error('ambiguous provider outcome'), { status: 503 });
    await expect(runAsaasPaymentCommand({
      contaId: 'tenant-1', type: 'PAYMENT_CANCEL_COMMAND', entityType: 'CHARGE', entityId: 'charge-1',
      asaasPaymentId: 'pay-1', actorId: 'user-1', run: async () => { throw error; },
    })).rejects.toBe(error);

    expect(ledger.failPaymentCommand).toHaveBeenCalledWith({ jobId: 'command-stable-1', error });
    expect(ledger.markPaymentCommandNeedsReconciliation).not.toHaveBeenCalled();
  });

  it('keeps transport failures without HTTP status in reconciliation when opted in', async () => {
    const error = new Error('network timeout after dispatch');
    await expect(runAsaasPaymentCommand({
      contaId: 'tenant-1', type: 'PAYMENT_REFUND_COMMAND', entityType: 'CHARGE', entityId: 'charge-1',
      asaasPaymentId: 'pay-1', actorId: 'user-1', reconcileAmbiguousFailure: true,
      run: async () => { throw error; },
    })).rejects.toBe(error);

    expect(ledger.markPaymentCommandNeedsReconciliation).toHaveBeenCalledWith({ jobId: 'command-stable-1', error });
    expect(ledger.failPaymentCommand).not.toHaveBeenCalled();
  });

  it('short-circuits a confirmed refund replay without running the callback or downgrading state', async () => {
    ledger.registerPaymentCommand.mockResolvedValue({
      id: 'command-stable-1', payload: { commandStatus: 'CONFIRMED_BY_WEBHOOK' },
    });
    const run = vi.fn(async () => 'unexpected');
    const output = await runAsaasPaymentCommand({
      contaId: 'tenant-1', type: 'PAYMENT_REFUND_COMMAND', entityType: 'CHARGE', entityId: 'charge-1',
      asaasPaymentId: 'pay-1', actorId: 'user-1', correlationId: 'corr-1', reconcileAmbiguousFailure: true, run,
    });

    expect(output).toMatchObject({ alreadyDispatched: true, commandStatus: 'CONFIRMED_BY_WEBHOOK' });
    expect(run).not.toHaveBeenCalled();
    expect(ledger.claimPaymentRefundCommandForDispatch).not.toHaveBeenCalled();
    expect(ledger.markPaymentCommandSent).not.toHaveBeenCalled();
    expect(ledger.markPaymentCommandNeedsReconciliation).not.toHaveBeenCalled();
  });

  it('dispatches only the atomic-claim winner for concurrent retries with the same refund key', async () => {
    let releaseFirst!: () => void;
    const firstRunBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let claims = 0;
    ledger.registerPaymentCommand.mockResolvedValue({
      id: 'command-stable-1', payload: { commandStatus: 'REQUESTED' },
    });
    ledger.claimPaymentRefundCommandForDispatch.mockImplementation(async () => ({ claimed: ++claims === 1, activeCommand: null }));
    const run = vi.fn(async () => {
      await firstRunBlocked;
      return 'dispatched';
    });
    const input = {
      contaId: 'tenant-1', type: 'PAYMENT_REFUND_COMMAND' as const, entityType: 'CHARGE' as const, entityId: 'charge-1',
      asaasPaymentId: 'pay-1', actorId: 'user-1', correlationId: 'same-key', reconcileAmbiguousFailure: true, run,
    };

    const first = runAsaasPaymentCommand(input);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(1));
    const second = await runAsaasPaymentCommand(input);
    expect(second).toMatchObject({ alreadyDispatched: true });
    expect(run).toHaveBeenCalledTimes(1);
    releaseFirst();
    const firstOutput = await first;
    expect(firstOutput).toMatchObject({ alreadyDispatched: false, result: 'dispatched' });
    expect(ledger.markPaymentCommandSent).not.toHaveBeenCalled();
  });
});
