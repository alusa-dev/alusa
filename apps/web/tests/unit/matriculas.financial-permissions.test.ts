import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  matricula: vi.fn(),
  agreement: vi.fn(),
  log: vi.fn(),
  updateMany: vi.fn(),
  preview: vi.fn(),
  commit: vi.fn(),
  updateSubscription: vi.fn(),
  project: vi.fn(),
  context: vi.fn(),
  editable: vi.fn(),
  align: vi.fn(),
  getChannels: vi.fn(),
  syncChannels: vi.fn(),
}));
vi.mock('next-auth', () => ({ getServerSession: mocks.session }));
vi.mock('@/lib/auth-options', () => ({ authOptions: {} }));
vi.mock('@/src/prisma', () => ({ prisma: {
  matricula: { findFirst: mocks.matricula, updateMany: mocks.updateMany },
  billingAgreement: { findFirst: mocks.agreement },
  matriculaLog: { create: mocks.log },
} }));
vi.mock('@/lib/prisma-tenant', () => ({ runWithTenant: async (_contaId: string, callback: (db: unknown) => unknown) => {
  const { prisma } = await import('@/src/prisma');
  return callback(prisma);
} }));
vi.mock('@alusa/finance', () => ({
  KycNotApprovedError: class extends Error {},
  getCustomerNotificationChannels: mocks.getChannels,
  syncCustomerNotificationsForUserSelection: mocks.syncChannels,
  previewBillingAgreementChange: mocks.preview,
  commitBillingAgreementChange: mocks.commit,
  updateSubscription: mocks.updateSubscription,
  projectConfirmedBillingAgreementSnapshot: mocks.project,
}));
vi.mock('@/features/cadastro/matriculas/mappers', () => ({
  mapMatriculaNotificationChannelsResultToDTO: (input: unknown) => input,
  mapMatriculaSubscriptionValueUpdateResultToDTO: (input: unknown) => input,
  mapMatriculaSubscriptionBillingTypeUpdateResultToDTO: (input: unknown) => input,
}));
vi.mock('@/src/server/matriculas/financial-context.service', () => ({
  resolveMatriculaFinancialContext: mocks.context,
  isFinancialContextEditable: mocks.editable,
  updateFamilyFinancialLocalState: mocks.align,
}));
vi.mock('@/src/server/matriculas/enrollment-finance-consistency.service', () => ({
  alignLocalPendingEnrollmentCharges: mocks.align,
}));
vi.mock('@/src/server/matriculas/subscription-snapshot', () => ({ deriveLocalAssinaturaSnapshot: vi.fn() }));
vi.mock('@/src/server/matriculas/recurring-billing', () => ({ mapBillingTypeToFormaPagamento: () => 'PIX' }));

import { PUT as updateValue } from '@/app/api/matriculas/[id]/valor/route';
import { PUT as updateBillingType } from '@/app/api/matriculas/[id]/forma-pagamento/route';

const routes = [
  { name: 'valor', put: updateValue, body: { value: 250, updatePendingPayments: true } },
  { name: 'forma-pagamento', put: updateBillingType, body: { billingType: 'PIX' } },
];

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ user: { id: 'user-a', contaId: 'conta-a', role: 'ADMIN' } });
  mocks.matricula.mockResolvedValue({
    id: 'matricula-a', contratoAtual: null, asaasSubscriptionId: 'sub-a',
    subscriptions: [{ billingAgreementId: 'agreement-a' }],
    billingAllocations: [{ id: 'allocation-a', agreementId: 'agreement-a', netAmount: 200 }],
  });
  mocks.agreement.mockResolvedValue({ version: 1, nextDueDate: null, asaasSubscriptionId: 'sub-a' });
  mocks.preview.mockResolvedValue({ blockers: [], previewHash: 'hash', expiresAt: new Date() });
  mocks.commit.mockResolvedValue({ status: 'SUCCEEDED', operationId: 'op-a' });
  mocks.context.mockResolvedValue({
    mode: 'INDIVIDUAL', asaasSubscriptionId: 'sub-a', localSnapshot: { billingType: 'BOLETO' },
    sharedAgreement: { affectedMatriculaIds: ['matricula-a', 'matricula-sibling'] },
  });
  mocks.editable.mockReturnValue(true);
  mocks.align.mockResolvedValue({ cobrancasUpdated: 1, chargesUpdated: 1 });
});

describe.each(routes)('permissões financeiras: $name', ({ put, body }) => {
  const request = (extra = {}) => new Request('http://localhost/api/matriculas/matricula-a', {
    method: 'PUT', headers: { 'content-type': 'application/json', 'idempotency-key': 'request-a' },
    body: JSON.stringify({ ...body, ...extra }),
  });
  const context = { params: Promise.resolve({ id: 'matricula-a' }) };
  function expectNoEffects() {
    expect(mocks.matricula).not.toHaveBeenCalled();
    expect(mocks.preview).not.toHaveBeenCalled();
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.updateSubscription).not.toHaveBeenCalled();
    expect(mocks.log).not.toHaveBeenCalled();
  }

  it.each([null, { user: { id: 'user-a', role: 'ADMIN' } }, { user: { contaId: 'conta-a', role: 'ADMIN' } }])(
    'rejeita sessão ausente/incompleta mesmo com conta no payload', async (session) => {
      mocks.session.mockResolvedValue(session);
      expect((await put(request({ contaId: 'conta-a' }), context)).status).toBe(401);
      expectNoEffects();
    },
  );
  it.each(['RECEPCAO', 'ALUNO', 'RESPONSAVEL', 'PROFESSOR', ''])('nega papel %s antes de consultar financeiro', async (role) => {
    mocks.session.mockResolvedValue({ user: { id: 'user-a', contaId: 'conta-a', role } });
    expect((await put(request(), context)).status).toBe(403);
    expectNoEffects();
  });
  it('nega conta B no payload autenticado na conta A', async () => {
    const result = await put(request({ contaId: 'conta-b' }), context);
    expect(result.status).toBe(403);
    expect((await result.json()).error.code).toBe('CONTA_INVALIDA');
    expectNoEffects();
  });
  it('não revela matrícula de outra conta e aplica filtro tenant', async () => {
    mocks.matricula.mockResolvedValue(null);
    expect((await put(request(), context)).status).toBe(404);
    expect(mocks.matricula).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'matricula-a', aluno: { contaId: 'conta-a' } } }));
    expect(mocks.commit).not.toHaveBeenCalled();
    expect(mocks.updateSubscription).not.toHaveBeenCalled();
  });
  it('não expõe detalhes internos quando a consulta falha', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.matricula.mockRejectedValue(new Error('internal secret connection details'));
    try {
      const result = await put(request(), context);
      expect(result.status).toBe(500);
      expect(await result.text()).not.toContain('internal secret');
      expect(mocks.commit).not.toHaveBeenCalled();
      expect(mocks.updateSubscription).not.toHaveBeenCalled();
    } finally {
      logger.mockRestore();
    }
  });
  it.each(['ADMIN', 'FINANCEIRO'])('permite %s, usa conta da sessão e registra ator', async (role) => {
    mocks.session.mockResolvedValue({ user: { id: 'user-a', contaId: 'conta-a', role } });
    const response = await put(request(), context);
    expect(response.status).toBe(200);
    expect(mocks.session).toHaveBeenCalledTimes(1);
    if (put === updateBillingType) {
      expect(mocks.updateSubscription).toHaveBeenCalledWith('sub-a', expect.objectContaining({ billingType: 'PIX' }), { contaId: 'conta-a' });
      expect(mocks.updateMany).toHaveBeenCalledWith({
        where: { contaId: 'conta-a', id: { in: ['matricula-a', 'matricula-sibling'] } },
        data: { formaPagamento: 'PIX' },
      });
      expect(mocks.align).toHaveBeenCalledTimes(2);
    } else {
      expect(mocks.commit).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', actorId: 'user-a' }));
    }
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'user-a' }) }));
    expect(mocks.matricula).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'matricula-a', aluno: { contaId: 'conta-a' } } }));
  });
});


describe('permissões de notificações da matrícula', () => {
  const context = { params: Promise.resolve({ id: 'matricula-a' }) };
  const requested = { email: true, sms: false, whatsapp: false };
  beforeEach(() => {
    mocks.context.mockResolvedValue({ targetMatriculaId: 'matricula-a', customerId: 'cus-a', mode: 'INDIVIDUAL' });
    mocks.getChannels.mockResolvedValue({ email: false, sms: false, whatsapp: false, notificationCount: 1 });
    mocks.syncChannels.mockResolvedValue({ success: true, applied: requested, warnings: [] });
  });
  async function invoke(method: 'GET' | 'PUT', contaId?: string) {
    const { GET, PUT } = await import('@/app/api/matriculas/[id]/notificacoes/route');
    const req = new Request(`http://localhost/api/matriculas/matricula-a/notificacoes${contaId ? `?contaId=${contaId}` : ''}`, {
      method,
      ...(method === 'PUT' ? { body: JSON.stringify({ contaId, channels: requested }) } : {}),
    });
    return (method === 'GET' ? GET : PUT)(req, context);
  }
  it.each(['GET', 'PUT'] as const)('%s exige sessão completa e não aceita conta livre', async (method) => {
    mocks.session.mockResolvedValue(null);
    expect((await invoke(method, 'conta-a')).status).toBe(401);
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.getChannels).not.toHaveBeenCalled();
    expect(mocks.syncChannels).not.toHaveBeenCalled();
  });
  it.each(['GET', 'PUT'] as const)('%s nega papel do portal', async (method) => {
    mocks.session.mockResolvedValue({ user: { id: 'user-a', contaId: 'conta-a', role: 'RESPONSAVEL' } });
    expect((await invoke(method)).status).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each(['GET', 'PUT'] as const)('%s nega conta divergente', async (method) => {
    expect((await invoke(method, 'conta-b')).status).toBe(403);
    expect(mocks.context).not.toHaveBeenCalled();
  });
  it.each(['GET', 'PUT'] as const)('%s não revela matrícula de outro tenant', async (method) => {
    mocks.context.mockResolvedValue(null);
    expect((await invoke(method)).status).toBe(404);
    expect(mocks.context).toHaveBeenCalledWith(expect.objectContaining({ contaId: 'conta-a', matriculaId: 'matricula-a' }));
    expect(mocks.getChannels).not.toHaveBeenCalled();
    expect(mocks.syncChannels).not.toHaveBeenCalled();
  });
  it.each(['ADMIN', 'FINANCEIRO', 'RECEPCAO'])('permite leitura e atualização para %s', async (role) => {
    mocks.session.mockResolvedValue({ user: { id: 'user-a', contaId: 'conta-a', role } });
    expect((await invoke('GET')).status).toBe(200);
    expect((await invoke('PUT')).status).toBe(200);
    expect(mocks.syncChannels).toHaveBeenCalledWith('conta-a', 'cus-a', requested);
    expect(mocks.log).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ actorId: 'user-a' }) }));
  });
});
