import { beforeEach, describe, expect, it, vi } from 'vitest';

const consumeAuthActionTokenMock = vi.fn();
const createAuthActionTokenMock = vi.fn();
const findAuthActionTokenByPlainTokenMock = vi.fn();
const getAuthActionTokenExpiryLabelMock = vi.fn();
const invalidateAuthActionTokensMock = vi.fn();
const markAuthActionTokenEmailSentMock = vi.fn();
const prismaTransactionMock = vi.fn();
const usuarioUpdateMock = vi.fn();
const contaFindUniqueMock = vi.fn();
const contaUpdateMock = vi.fn();
const usuarioFindUniqueMock = vi.fn();
const usuarioFindFirstMock = vi.fn();
const sendTransactionalEmailMock = vi.fn();
const buildAccountReactivationTemplateMock = vi.fn();
const buildVerifyEmailTemplateMock = vi.fn();
const originalNextAuthUrl = process.env.NEXTAUTH_URL;
const originalNextPublicAppUrl = process.env.NEXT_PUBLIC_APP_URL;

vi.mock('@/lib/auth-action-tokens', () => ({
  consumeAuthActionToken: consumeAuthActionTokenMock,
  createAuthActionToken: createAuthActionTokenMock,
  findAuthActionTokenByPlainToken: findAuthActionTokenByPlainTokenMock,
  getAuthActionTokenExpiryLabel: getAuthActionTokenExpiryLabelMock,
  invalidateAuthActionTokens: invalidateAuthActionTokensMock,
  markAuthActionTokenEmailSent: markAuthActionTokenEmailSentMock,
}));

vi.mock('@/lib/prisma', () => ({
  default: {
    $transaction: prismaTransactionMock,
    usuario: {
      findUnique: usuarioFindUniqueMock,
      findFirst: usuarioFindFirstMock,
    },
    conta: {
      findUnique: contaFindUniqueMock,
      update: contaUpdateMock,
    },
  },
}));

vi.mock('@alusa/finance', () => ({
  auditLogService: {
    record: vi.fn(async () => ({ id: 'audit_1' })),
  },
}));

vi.mock('@/lib/email/transactional-email', () => ({
  sendTransactionalEmail: sendTransactionalEmailMock,
}));

vi.mock('@/lib/email/auth-email-templates', () => ({
  buildAccountReactivationTemplate: buildAccountReactivationTemplateMock,
  buildInviteUserTemplate: vi.fn(),
  buildResetPasswordTemplate: vi.fn(),
  buildVerifyEmailTemplate: buildVerifyEmailTemplateMock,
}));

describe('verifyEmailByToken', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    prismaTransactionMock.mockImplementation(
      async (
        callback: (tx: {
          usuario: { update: typeof usuarioUpdateMock };
          conta: { findUnique: typeof contaFindUniqueMock; update: typeof contaUpdateMock };
        }) => Promise<unknown>,
      ) =>
        callback({
          usuario: { update: usuarioUpdateMock },
          conta: { findUnique: contaFindUniqueMock, update: contaUpdateMock },
        }),
    );
  });

  afterAll(() => {
    if (originalNextAuthUrl === undefined) delete process.env.NEXTAUTH_URL;
    else process.env.NEXTAUTH_URL = originalNextAuthUrl;

    if (originalNextPublicAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
    else process.env.NEXT_PUBLIC_APP_URL = originalNextPublicAppUrl;
  });

  it('retorna sucesso quando o mesmo token já foi consumido e o e-mail já está confirmado', async () => {
    const user = {
      id: 'user_1',
      contaId: 'conta_1',
      email: 'user@example.com',
      nome: 'User Example',
      emailVerifiedAt: new Date('2026-03-25T10:00:00.000Z'),
    };

    consumeAuthActionTokenMock.mockResolvedValueOnce(null);
    findAuthActionTokenByPlainTokenMock.mockResolvedValueOnce({
      tokenId: 'token_1',
      usedAt: new Date('2026-03-25T10:00:00.000Z'),
      invalidatedAt: null,
      expiresAt: new Date('2026-03-26T10:00:00.000Z'),
      user,
    });

    const { verifyEmailByToken } = await import('@/lib/auth-email-flow');
    const result = await verifyEmailByToken('plain-token');

    expect(result).toEqual(user);
    expect(prismaTransactionMock).not.toHaveBeenCalled();
  });

  it('confirma o e-mail e invalida tokens remanescentes quando o token ainda está válido', async () => {
    const user = {
      id: 'user_2',
      contaId: 'conta_2',
      email: 'new@example.com',
      nome: 'New User',
      emailVerifiedAt: null,
    };

    consumeAuthActionTokenMock.mockResolvedValueOnce({
      tokenId: 'token_2',
      user,
    });
    contaFindUniqueMock.mockResolvedValueOnce({ status: 'ATIVO', deletedAt: null });

    const { verifyEmailByToken } = await import('@/lib/auth-email-flow');
    const result = await verifyEmailByToken('fresh-token');

    expect(result).toEqual(user);
    expect(prismaTransactionMock).toHaveBeenCalledTimes(1);
    expect(usuarioUpdateMock).toHaveBeenCalledWith({
      where: { id: 'user_2' },
      data: { emailVerifiedAt: expect.any(Date) },
    });
    expect(invalidateAuthActionTokensMock).toHaveBeenCalledWith('user_2', 'VERIFY_EMAIL', expect.any(Object));
  });

  it('reativa a conta quando o token é usado por um usuário com conta desativada', async () => {
    const user = {
      id: 'user_4',
      contaId: 'conta_4',
      email: 'reactivate@example.com',
      nome: 'Dormant User',
      emailVerifiedAt: new Date('2026-03-25T10:00:00.000Z'),
    };

    consumeAuthActionTokenMock.mockResolvedValueOnce({
      tokenId: 'token_4',
      user,
    });
    contaFindUniqueMock.mockResolvedValueOnce({ status: 'INATIVO', deletedAt: new Date() });

    const { verifyEmailByToken } = await import('@/lib/auth-email-flow');
    const result = await verifyEmailByToken('reactivate-token');

    expect(result).toEqual(user);
    expect(contaUpdateMock).toHaveBeenCalledWith({
      where: { id: 'conta_4' },
      data: {
        status: 'ATIVO',
        deletedAt: null,
        deletedByUserId: null,
        deleteReason: null,
      },
    });
  });

  it('inclui o callbackUrl no link de confirmação quando o destino é o onboarding', async () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3001';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    usuarioFindUniqueMock.mockResolvedValueOnce({
      id: 'user_3',
      nome: 'Admin Example',
      email: 'admin@example.com',
      emailVerifiedAt: null,
      contaId: 'conta_3',
      conta: { status: 'ATIVO', deletedAt: null },
    });
    createAuthActionTokenMock.mockResolvedValueOnce({
      token: 'plain-token',
      record: { id: 'token_3' },
    });
    getAuthActionTokenExpiryLabelMock.mockReturnValueOnce('1 dia');
    buildVerifyEmailTemplateMock.mockReturnValueOnce({
      subject: 'Confirme seu e-mail',
      html: '<p>template</p>',
      text: 'template',
    });
    sendTransactionalEmailMock.mockResolvedValueOnce({
      delivery: 'sent',
      emailId: 'email_3',
    });

    const { sendEmailVerificationForUser } = await import('@/lib/auth-email-flow');
    const result = await sendEmailVerificationForUser(
      'user_3',
      { ip: '127.0.0.1', userAgent: 'vitest' },
      { callbackUrl: '/finance/wizard' },
    );

    expect(buildVerifyEmailTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionUrl: expect.stringContaining('callbackUrl=%2Ffinance%2Fwizard'),
      }),
    );
    expect(sendTransactionalEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionUrl: expect.stringContaining('callbackUrl=%2Ffinance%2Fwizard'),
        idempotencyKey: 'verify_email/token_3',
      }),
    );
    expect(markAuthActionTokenEmailSentMock).toHaveBeenCalledWith('token_3', 'email_3');
    expect(result.actionUrl?.startsWith('http://localhost:3001/auth/verify-email')).toBe(true);
    expect(result.actionUrl).toContain('callbackUrl=%2Ffinance%2Fwizard');
  });

  it('envia template de reativação quando a conta está desativada', async () => {
    process.env.NEXTAUTH_URL = 'http://localhost:3001';
    process.env.NEXT_PUBLIC_APP_URL = 'http://localhost:3000';

    usuarioFindUniqueMock.mockResolvedValueOnce({
      id: 'user_5',
      nome: 'Dormant Admin',
      email: 'inactive@example.com',
      emailVerifiedAt: new Date('2026-03-20T10:00:00.000Z'),
      contaId: 'conta_5',
      conta: { status: 'INATIVO', deletedAt: new Date('2026-04-27T10:00:00.000Z') },
    });
    usuarioFindFirstMock.mockResolvedValueOnce({
      id: 'user_5',
      contaId: 'conta_5',
    });
    createAuthActionTokenMock.mockResolvedValueOnce({
      token: 'plain-token-2',
      record: { id: 'token_5' },
    });
    getAuthActionTokenExpiryLabelMock.mockReturnValueOnce('1 dia');
    buildAccountReactivationTemplateMock.mockReturnValueOnce({
      subject: 'Reative sua conta',
      html: '<p>template</p>',
      text: 'template',
    });
    sendTransactionalEmailMock.mockResolvedValueOnce({
      delivery: 'sent',
      emailId: 'email_5',
    });

    const { sendAccountReactivationForEmail } = await import('@/lib/auth-email-flow');
    await sendAccountReactivationForEmail('inactive@example.com', {
      ip: '127.0.0.1',
      userAgent: 'vitest',
    });

    expect(buildAccountReactivationTemplateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        actionUrl: expect.stringContaining('callbackUrl=%2Fauth%2Flogin%3Freactivated%3D1'),
      }),
    );
    expect(sendTransactionalEmailMock).toHaveBeenCalledWith(
      expect.objectContaining({
        category: 'account_reactivation',
        idempotencyKey: 'account_reactivation/token_5',
      }),
    );
  });
});