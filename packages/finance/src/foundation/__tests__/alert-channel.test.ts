import { describe, it, expect, beforeEach, vi } from 'vitest';
import { alertService, type AlertChannel, type AlertPayload } from '../alert-channel';

describe('AlertService', () => {
  beforeEach(() => {
    alertService.resetChannels();
    vi.restoreAllMocks();
  });

  describe('dispatch', () => {
    it('deve enviar para console por padrão', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      await alertService.dispatch({
        severity: 'critical',
        title: 'Teste',
        message: 'Mensagem de teste',
      });

      expect(spy).toHaveBeenCalled();
      const logData = JSON.parse(spy.mock.calls[0][0]);
      expect(logData.title).toBe('Teste');
      expect(logData.level).toBe('critical');
    });

    it('deve enviar para canais customizados registrados', async () => {
      const customChannel: AlertChannel = {
        name: 'test-channel',
        send: vi.fn(async () => {}),
      };

      alertService.registerChannel(customChannel);

      await alertService.dispatch({
        severity: 'warning',
        title: 'Alerta',
        message: 'Teste',
      });

      expect(customChannel.send).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Alerta', severity: 'warning' }),
      );
    });

    it('deve capturar erros de canais individuais (fail-safe)', async () => {
      const failingChannel: AlertChannel = {
        name: 'failing',
        send: vi.fn(async () => { throw new Error('Canal falhou'); }),
      };

      alertService.registerChannel(failingChannel);

      vi.spyOn(console, 'error').mockImplementation(() => {});
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await alertService.dispatch({
        severity: 'error',
        title: 'Teste',
        message: 'Não deve falhar',
      });

      const failedChannels = result.channelResults.filter((r) => !r.success);
      expect(failedChannels.length).toBe(1);
      expect(failedChannels[0].channel).toBe('failing');
      expect(failedChannels[0].error).toContain('Canal falhou');
    });

    it('deve usar console.warn para severidade info/warning', async () => {
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      await alertService.dispatch({
        severity: 'info',
        title: 'Info',
        message: 'Teste info',
      });

      expect(spy).toHaveBeenCalled();
    });
  });

  describe('convenience methods', () => {
    it('alertDLQ deve disparar com severidade error', async () => {
      const channel: AlertChannel = {
        name: 'spy',
        send: vi.fn(async () => {}),
      };
      alertService.registerChannel(channel);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await alertService.alertDLQ('conta1', 3, ['id1', 'id2', 'id3']);

      const payload = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as AlertPayload;
      expect(payload.severity).toBe('error');
      expect(payload.contaId).toBe('conta1');
      expect(payload.title).toContain('DLQ');
    });

    it('alertInterruptedQueue deve disparar com severidade critical', async () => {
      const channel: AlertChannel = {
        name: 'spy',
        send: vi.fn(async () => {}),
      };
      alertService.registerChannel(channel);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await alertService.alertInterruptedQueue('conta1', ['wh1', 'wh2']);

      const payload = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as AlertPayload;
      expect(payload.severity).toBe('critical');
    });

    it('alertCircuitOpen deve disparar com severidade critical', async () => {
      const channel: AlertChannel = {
        name: 'spy',
        send: vi.fn(async () => {}),
      };
      alertService.registerChannel(channel);
      vi.spyOn(console, 'error').mockImplementation(() => {});

      await alertService.alertCircuitOpen('conta1', 5);

      const payload = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as AlertPayload;
      expect(payload.severity).toBe('critical');
      expect(payload.metadata).toEqual({ failureCount: 5 });
    });

    it('alertRateLimitExceeded deve disparar com severidade warning', async () => {
      const channel: AlertChannel = {
        name: 'spy',
        send: vi.fn(async () => {}),
      };
      alertService.registerChannel(channel);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await alertService.alertRateLimitExceeded('conta1', '/v3/payments');

      const payload = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as AlertPayload;
      expect(payload.severity).toBe('warning');
      expect(payload.metadata).toEqual({ endpoint: '/v3/payments' });
    });

    it('alertQuotaWarning deve disparar com severidade warning', async () => {
      const channel: AlertChannel = {
        name: 'spy',
        send: vi.fn(async () => {}),
      };
      alertService.registerChannel(channel);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await alertService.alertQuotaWarning(20000, 25000, 80);

      const payload = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as AlertPayload;
      expect(payload.severity).toBe('warning');
      expect(payload.title).toContain('Quota');
    });

    it('alertReconciliationDrift deve disparar com severidade warning', async () => {
      const channel: AlertChannel = {
        name: 'spy',
        send: vi.fn(async () => {}),
      };
      alertService.registerChannel(channel);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await alertService.alertReconciliationDrift('conta1', {
        payments: 2,
        subscriptions: 1,
        installments: 0,
      });

      const payload = (channel.send as ReturnType<typeof vi.fn>).mock.calls[0][0] as AlertPayload;
      expect(payload.severity).toBe('warning');
      expect(payload.metadata).toEqual({ payments: 2, subscriptions: 1, installments: 0 });
    });

    it('alertReconciliationDrift sem drift não deve disparar', async () => {
      const channel: AlertChannel = {
        name: 'spy',
        send: vi.fn(async () => {}),
      };
      alertService.registerChannel(channel);

      await alertService.alertReconciliationDrift('conta1', {
        payments: 0,
        subscriptions: 0,
        installments: 0,
      });

      expect(channel.send).not.toHaveBeenCalled();
    });
  });

  describe('resetChannels', () => {
    it('deve remover canais customizados e manter console', async () => {
      const channel: AlertChannel = {
        name: 'custom',
        send: vi.fn(async () => {}),
      };
      alertService.registerChannel(channel);
      alertService.resetChannels();

      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await alertService.dispatch({
        severity: 'warning',
        title: 'Teste',
        message: 'Teste',
      });

      // Apenas console (1 channel)
      expect(result.channelResults.length).toBe(1);
      expect(result.channelResults[0].channel).toBe('console');
      expect(channel.send).not.toHaveBeenCalled();
    });
  });
});
