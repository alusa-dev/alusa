import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PUT as putStudent } from '@/app/api/alunos/[id]/notificacoes/route';
import { PUT as putResponsible } from '@/app/api/responsaveis/[id]/notificacoes/route';

const mocks = vi.hoisted(() => ({
  save: vi.fn(),
  studentScope: vi.fn().mockResolvedValue({ status: 'OK', customerId: 'cus-1' }),
  responsibleScope: vi.fn().mockResolvedValue({ status: 'OK', customerId: 'cus-1' }),
  responsibleId: vi.fn().mockResolvedValue('responsavel-1'),
}));

vi.mock('@alusa/finance', () => ({
  getAsaasCustomerNotificationPreferences: vi.fn(),
  saveAsaasCustomerNotificationPreferences: mocks.save,
}));
vi.mock('@/lib/api/with-tenant-session', () => ({ resolveTenantSession: vi.fn().mockResolvedValue({ ok: true, contaId: 'conta-1', role: 'ADMIN' }) }));
vi.mock('@/src/server/finance/customer-notification-scope.service', () => ({
  resolveAlunoNotificationCustomer: mocks.studentScope,
  resolveResponsavelNotificationCustomer: mocks.responsibleScope,
}));
vi.mock('@/src/server/responsibles/resolve-responsible-route-id.service', () => ({ resolveResponsavelRouteId: mocks.responsibleId }));
vi.mock('@/src/server/platform-billing/capacity', () => ({ platformBillingAccessResponseForConta: vi.fn().mockResolvedValue(null) }));
vi.mock('@/lib/observability/api-logger', () => ({ getRequestId: vi.fn().mockReturnValue('request-1'), logApiOperationalEvent: vi.fn() }));

describe('customer notification API duplicate rejection', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ['student', putStudent],
    ['responsible', putResponsible],
  ])('rejects duplicate event/offset before Asaas PUT (%s)', async (_kind, PUT) => {
    const duplicate = {
      event: 'PAYMENT_CREATED', scheduleOffset: 0, enabled: true, customerEnabled: true,
      emailEnabledForProvider: false, smsEnabledForProvider: false,
      emailEnabledForCustomer: true, smsEnabledForCustomer: true,
      whatsappEnabledForCustomer: false, phoneCallEnabledForCustomer: false,
    };
    const response = await PUT(new Request('http://localhost/api/notificacoes', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preferences: [duplicate, duplicate] }),
    }), { params: Promise.resolve({ id: 'entity-1' }) });

    expect(response.status).toBe(422);
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
