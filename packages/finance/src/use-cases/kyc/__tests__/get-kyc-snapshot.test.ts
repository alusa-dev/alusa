/**
 * Testes unitários do KycSnapshot engine (getKycSnapshot).
 *
 * Mocka: @alusa/asaas, @alusa/database, financeProfileService.
 * Verifica cenários A-E, cache v2, hasBlockingPending, rejectReasons e nextActions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type {
  AsaasMyAccountDocumentGroup,
  AsaasMyAccountDocumentsResponse,
  AsaasMyAccountStatus,
} from '@alusa/asaas';

// ── Mocks ─────────────────────────────────────────────────────────────────

const mockGetMyAccountStatus = vi.fn<[], Promise<AsaasMyAccountStatus>>();
const mockGetMyAccountDocuments = vi.fn<[], Promise<AsaasMyAccountDocumentsResponse>>();

vi.mock('@alusa/asaas', async () => {
  const actual = await vi.importActual<typeof import('@alusa/asaas')>('@alusa/asaas');
  return {
    ...actual,
    getAsaasBaseUrlFromEnvOrThrow: () => 'https://api-sandbox.asaas.com/v3',
    getMyAccountStatus: (...args: unknown[]) => mockGetMyAccountStatus(...(args as [])),
    getMyAccountDocuments: (...args: unknown[]) => mockGetMyAccountDocuments(...(args as [])),
  };
});

const FP_ID = 'fp_001';
const CONTA_ID = 'conta_001';
const ASAAS_ACCOUNT_ID = 'acc_asaas_001';

vi.mock('@alusa/database', () => ({
  prisma: {
    financeProfile: {
      findUnique: vi.fn(async () => ({ id: FP_ID, contaId: CONTA_ID })),
    },
    asaasAccount: {
      findUnique: vi.fn(async () => ({
        id: 'aa_001',
        asaasAccountId: ASAAS_ACCOUNT_ID,
        provisionedAt: new Date(Date.now() - 60_000), // 60s ago — past delay
        documentsCache: null,
        documentsCacheUpdatedAt: null,
        commercialInfoStatus: null,
        commercialInfoScheduledDate: null,
      })),
      update: vi.fn(async () => ({ id: 'aa_001' })),
    },
  },
  loadAsaasCredentials: vi.fn(async () => ({
    apiKey: '$aact_test_key',
    accountId: ASAAS_ACCOUNT_ID,
  })),
}));

vi.mock('../../../foundation/finance-profile.service', () => ({
  financeProfileService: {
    syncRegulatoryState: vi.fn(async () => undefined),
    getOrCreateByTenant: vi.fn(async () => ({ id: FP_ID, isOnboardingCompleted: false })),
  },
}));

process.env.ASAAS_BASE_URL = 'https://api-sandbox.asaas.com/v3';

import { getKycSnapshot } from '../get-kyc-snapshot';

// ── Helpers para fixtures ─────────────────────────────────────────────────

function makeStatus(overrides: Partial<AsaasMyAccountStatus> = {}): AsaasMyAccountStatus {
  return {
    general: 'PENDING',
    documentation: 'PENDING',
    bankAccountInfo: 'PENDING',
    ...overrides,
  };
}

function makeGroup(overrides: Partial<AsaasMyAccountDocumentGroup>): AsaasMyAccountDocumentGroup {
  return {
    id: 'grp_default',
    status: 'NOT_SENT',
    ...overrides,
  };
}

function makeDocs(
  groups: AsaasMyAccountDocumentGroup[],
  rejectReasons?: string[],
): AsaasMyAccountDocumentsResponse {
  return { data: groups, rejectReasons };
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe('getKycSnapshot', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('retorna null quando financeProfile não existe', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.financeProfile.findUnique).mockResolvedValueOnce(null);

    const result = await getKycSnapshot('fp_inexistente');
    expect(result).toBeNull();
  });

  it('retorna null quando credenciais não disponíveis', async () => {
    const { loadAsaasCredentials } = await import('@alusa/database');
    vi.mocked(loadAsaasCredentials).mockResolvedValueOnce(null);

    const result = await getKycSnapshot(FP_ID);
    expect(result).toBeNull();
  });

  it('retorna null quando subconta provisionada < 15s atrás', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(), // agora — menos de 15s
      documentsCache: null,
      documentsCacheUpdatedAt: null,
    } as never);

    const result = await getKycSnapshot(FP_ID);
    expect(result).toBeNull();
    expect(mockGetMyAccountStatus).not.toHaveBeenCalled();
    expect(mockGetMyAccountDocuments).not.toHaveBeenCalled();
  });

  // ── Cenário A: onboardingUrl presente + NOT_SENT → EXTERNAL_ONBOARDING ──

  it('Cenário A: grupo com onboardingUrl + NOT_SENT → EXTERNAL_ONBOARDING', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    const exp = new Date(Date.now() + 60_000).toISOString();
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: 'grp_ext',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'RG ou CNH',
          onboardingUrl: 'https://asaas.com/onboarding/abc',
          onboardingUrlExpirationDate: exp,
        }),
      ]),
    );

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0]).toMatchObject({
      kind: 'EXTERNAL_ONBOARDING',
      groupId: 'grp_ext',
      type: 'IDENTIFICATION',
      onboardingUrl: 'https://asaas.com/onboarding/abc',
      onboardingUrlExpirationDate: exp,
      isOnboardingUrlExpired: false,
    });
  });

  it('Cenário A: EXTERNAL_ONBOARDING com onboardingUrlExpirationDate no passado marca expirado', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    const exp = new Date(Date.now() - 60_000).toISOString();
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: 'grp_ext_exp',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'RG ou CNH',
          onboardingUrl: 'https://asaas.com/onboarding/expired',
          onboardingUrlExpirationDate: exp,
        }),
      ]),
    );

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0]).toMatchObject({
      kind: 'EXTERNAL_ONBOARDING',
      groupId: 'grp_ext_exp',
      onboardingUrl: 'https://asaas.com/onboarding/expired',
      onboardingUrlExpirationDate: exp,
      isOnboardingUrlExpired: true,
    });
  });

  // ── Cenário B: onboardingUrl ausente + NOT_SENT → UPLOAD_DOCUMENT ──

  it('Cenário B: grupo sem onboardingUrl + NOT_SENT → UPLOAD_DOCUMENT', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: 'grp_upload',
          status: 'NOT_SENT',
          type: 'SOCIAL_CONTRACT',
          title: 'Contrato social',
        }),
      ]),
    );

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0]).toMatchObject({
      kind: 'UPLOAD_DOCUMENT',
      groupId: 'grp_upload',
      type: 'SOCIAL_CONTRACT',
    });
    expect(snapshot!.nextActions[0].onboardingUrl).toBeUndefined();
  });

  it('Cenário B2: grupo sem onboardingUrl + description padrão do provedor → UPLOAD_DOCUMENT', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: 'grp_portal',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'Documentos de identificação',
          description: 'Para enviar esse documento acesse nosso aplicativo ou utilize o link de onboarding.',
        }),
      ]),
    );

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0]).toMatchObject({
      kind: 'UPLOAD_DOCUMENT',
      groupId: 'grp_portal',
      type: 'IDENTIFICATION',
    });
  });

  // ── Cenário C: AWAITING_APPROVAL → sem ação ──

  it('Cenário C: grupo AWAITING_APPROVAL (UNDER_REVIEW) → nenhuma ação', async () => {
    mockGetMyAccountStatus.mockResolvedValue(
      makeStatus({ documentation: 'AWAITING_APPROVAL' }),
    );
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({ id: 'grp_review', status: 'AWAITING_APPROVAL', title: 'Em análise' }),
      ]),
    );

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nextActions).toHaveLength(0);
    expect(snapshot!.hasBlockingPending).toBe(true);
  });

  // ── Cenário D: REJECTED → UPLOAD_DOCUMENT (sem onboardingUrl) ──

  it('Cenário D: grupo REJECTED + sem onboardingUrl → UPLOAD_DOCUMENT', async () => {
    mockGetMyAccountStatus.mockResolvedValue(
      makeStatus({ documentation: 'REJECTED' }),
    );
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs(
        [
          makeGroup({
            id: 'grp_rej',
            status: 'REJECTED',
            type: 'IDENTIFICATION',
            title: 'Documento rejeitado',
          }),
        ],
        ['Imagem ilegível'],
      ),
    );

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0].kind).toBe('UPLOAD_DOCUMENT');
    expect(snapshot!.rejectReasons).toEqual(['Imagem ilegível']);
  });

  // ── Cenário E: bankAccountInfo não aprovado + grupo bancário ──

  it('Cenário D (com onboardingUrl): REJECTED + onboardingUrl → EXTERNAL_ONBOARDING', async () => {
    mockGetMyAccountStatus.mockResolvedValue(
      makeStatus({ documentation: 'REJECTED' }),
    );
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: 'grp_rej_ext',
          status: 'REJECTED',
          type: 'IDENTIFICATION',
          title: 'Rejeitado',
          onboardingUrl: 'https://asaas.com/onboarding/rej',
        }),
      ]),
    );

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.nextActions[0].kind).toBe('EXTERNAL_ONBOARDING');
    expect(snapshot!.nextActions[0].onboardingUrl).toBe('https://asaas.com/onboarding/rej');
  });

  // ── hasBlockingPending ──

  it('hasBlockingPending = false quando todas áreas APPROVED', async () => {
    mockGetMyAccountStatus.mockResolvedValue(
      makeStatus({
        general: 'APPROVED',
        documentation: 'APPROVED',
        bankAccountInfo: 'APPROVED',
      }),
    );
    mockGetMyAccountDocuments.mockResolvedValue(makeDocs([]));

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.hasBlockingPending).toBe(false);
    expect(snapshot!.nextActions).toHaveLength(0);
  });

  it('hasBlockingPending = true quando qualquer área não é APPROVED', async () => {
    mockGetMyAccountStatus.mockResolvedValue(
      makeStatus({
        general: 'APPROVED',
        documentation: 'APPROVED',
        bankAccountInfo: 'PENDING',
      }),
    );
    mockGetMyAccountDocuments.mockResolvedValue(makeDocs([]));

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.hasBlockingPending).toBe(true);
  });

  // ── Grupos IGNORED são descartados ──

  it('ignora grupos com status IGNORED', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({ id: 'grp_ign', status: 'IGNORED', title: 'Ignorar' }),
        makeGroup({ id: 'grp_act', status: 'NOT_SENT', title: 'Ativo' }),
      ]),
    );

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0].groupId).toBe('grp_act');
  });

  // ── Persiste cache v2 após fetch ──

  it('persiste cache v2 após busca fresh', async () => {
    const { prisma } = await import('@alusa/database');
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    mockGetMyAccountDocuments.mockResolvedValue(makeDocs([]));

    await getKycSnapshot(FP_ID);

    expect(prisma.asaasAccount.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          documentsCache: expect.objectContaining({ version: 2 }),
        }),
      }),
    );
  });

  // ── Cache v2 válido: não chama Asaas ──

  it('usa cache v2 válido sem chamar Asaas', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(Date.now() - 120_000),
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
      documentsCache: {
        version: 2,
        myAccountStatus: { general: 'APPROVED', documentation: 'APPROVED', bankAccountInfo: 'APPROVED' },
        groups: [
          {
            id: 'grp_cached_ext',
            status: 'NOT_SENT',
            type: 'IDENTIFICATION',
            title: 'Documento externo',
            description: 'Via link',
            hasOnboardingUrl: true,
          },
        ],
        rejectReasons: [],
        fetchedAt: new Date().toISOString(),
      },
      documentsCacheUpdatedAt: new Date(), // fresh cache
    } as never);

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.hasBlockingPending).toBe(false);
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0]).toMatchObject({
      kind: 'EXTERNAL_ONBOARDING',
      groupId: 'grp_cached_ext',
      type: 'IDENTIFICATION',
    });
    expect(snapshot!.nextActions[0].onboardingUrl).toBeUndefined();
    expect(snapshot!.nextActions[0].onboardingUrlExpirationDate).toBeUndefined();
    expect(snapshot!.nextActions[0].isOnboardingUrlExpired).toBeUndefined();
    expect(mockGetMyAccountStatus).not.toHaveBeenCalled();
    expect(mockGetMyAccountDocuments).not.toHaveBeenCalled();
  });

  // ── Cache v1 (legado) é ignorado → busca fresh ──

  it('ignora cache v1 (sem version: 2) e busca fresh', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(Date.now() - 120_000),
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
      documentsCache: { data: [{ id: 'old', status: 'PENDING' }] }, // v1
      documentsCacheUpdatedAt: new Date(),
    } as never);

    mockGetMyAccountStatus.mockResolvedValue(makeStatus({ general: 'APPROVED', documentation: 'APPROVED', bankAccountInfo: 'APPROVED' }));
    mockGetMyAccountDocuments.mockResolvedValue(makeDocs([]));

    const snapshot = await getKycSnapshot(FP_ID);
    expect(mockGetMyAccountStatus).toHaveBeenCalled();
    expect(snapshot!.hasBlockingPending).toBe(false);
  });

  // ── fresh=true ignora cache ──

  it('fresh=true sempre busca no Asaas', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(Date.now() - 120_000),
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
      documentsCache: {
        version: 2,
        myAccountStatus: { general: 'APPROVED', documentation: 'APPROVED', bankAccountInfo: 'APPROVED' },
        groups: [],
        rejectReasons: [],
        fetchedAt: new Date().toISOString(),
      },
      documentsCacheUpdatedAt: new Date(),
    } as never);

    const exp = new Date(Date.now() + 60_000).toISOString();
    mockGetMyAccountStatus.mockResolvedValue(makeStatus({ general: 'PENDING' }));
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: 'grp_fresh_ext',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'Documento externo',
          onboardingUrl: 'https://cadastro.io/xyz',
          onboardingUrlExpirationDate: exp,
        }),
      ]),
    );

    const snapshot = await getKycSnapshot(FP_ID, { fresh: true });
    expect(mockGetMyAccountStatus).toHaveBeenCalled();
    expect(snapshot!.generalStatus).toBe('PENDING');
    expect(snapshot!.nextActions.find((a) => a.groupId === 'grp_fresh_ext')).toMatchObject({
      kind: 'EXTERNAL_ONBOARDING',
      onboardingUrl: 'https://cadastro.io/xyz',
      onboardingUrlExpirationDate: exp,
      isOnboardingUrlExpired: false,
    });
  });

  // ── Sincroniza regulatoryState ──

  it('chama syncRegulatoryState quando general status presente', async () => {
    const { financeProfileService } = await import('../../../foundation/finance-profile.service');
    mockGetMyAccountStatus.mockResolvedValue(makeStatus({ general: 'APPROVED' }));
    mockGetMyAccountDocuments.mockResolvedValue(makeDocs([]));

    await getKycSnapshot(FP_ID);
    expect(financeProfileService.syncRegulatoryState).toHaveBeenCalledWith(
      expect.objectContaining({
        contaId: CONTA_ID,
        generalStatus: 'APPROVED',
      }),
    );
  });

  // ── processStatus (FASE 7) ──

  it('processStatus = APPROVED quando general = APPROVED', async () => {
    mockGetMyAccountStatus.mockResolvedValue(
      makeStatus({ general: 'APPROVED', documentation: 'APPROVED', bankAccountInfo: 'APPROVED' }),
    );
    mockGetMyAccountDocuments.mockResolvedValue(makeDocs([]));

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.processStatus).toBe('APPROVED');
  });

  it('processStatus = REJECTED quando general = REJECTED', async () => {
    mockGetMyAccountStatus.mockResolvedValue(
      makeStatus({ general: 'REJECTED', documentation: 'PENDING' }),
    );
    mockGetMyAccountDocuments.mockResolvedValue(makeDocs([]));

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.processStatus).toBe('REJECTED');
  });

  it('processStatus = EXTERNAL_IN_PROGRESS quando grupo externo pendente', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: 'grp_ext',
          status: 'NOT_SENT',
          onboardingUrl: 'https://asaas.com/onboarding/abc',
        }),
      ]),
    );

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.processStatus).toBe('EXTERNAL_IN_PROGRESS');
  });

  it('processStatus derivado do cache v2 (all APPROVED)', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(Date.now() - 120_000),
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
      documentsCache: {
        version: 2,
        myAccountStatus: { general: 'APPROVED', documentation: 'APPROVED', bankAccountInfo: 'APPROVED' },
        groups: [],
        rejectReasons: [],
        fetchedAt: new Date().toISOString(),
      },
      documentsCacheUpdatedAt: new Date(),
    } as never);

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.processStatus).toBe('APPROVED');
  });

  it('expõe commercialInfoStatus=EXPIRING_SOON como aviso (sem mascarar KYC)', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(Date.now() - 120_000),
      commercialInfoStatus: 'EXPIRING_SOON',
      commercialInfoScheduledDate: '2026-03-01',
      documentsCache: {
        version: 2,
        myAccountStatus: { general: 'APPROVED', documentation: 'APPROVED', bankAccountInfo: 'APPROVED' },
        groups: [],
        rejectReasons: [],
        fetchedAt: new Date().toISOString(),
      },
      documentsCacheUpdatedAt: new Date(),
    } as never);

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.commercialInfoStatus).toBe('EXPIRING_SOON');
    expect(snapshot!.commercialInfoScheduledDate).toBe('2026-03-01');
    expect(snapshot!.hasBlockingPending).toBe(false);
  });

  it('expõe commercialInfoStatus=EXPIRED para bloqueio no guard', async () => {
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(Date.now() - 120_000),
      commercialInfoStatus: 'EXPIRED',
      commercialInfoScheduledDate: '2026-03-01',
      documentsCache: {
        version: 2,
        myAccountStatus: { general: 'APPROVED', documentation: 'APPROVED', bankAccountInfo: 'APPROVED' },
        groups: [],
        rejectReasons: [],
        fetchedAt: new Date().toISOString(),
      },
      documentsCacheUpdatedAt: new Date(),
    } as never);

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.commercialInfoStatus).toBe('EXPIRED');
    expect(snapshot!.processStatus).toBe('APPROVED');
  });

  // ── isSandbox ──

  it('isSandbox = true quando ASAAS_BASE_URL aponta para sandbox', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    mockGetMyAccountDocuments.mockResolvedValue(makeDocs([]));

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot!.isSandbox).toBe(true);
  });

  // ── WAITING_PROVIDER / PROVISIONING_TIMEOUT ──

  it('zero UUID + provisionedAt recente → WAITING_PROVIDER', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: '00000000-0000-0000-0000-000000000000',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'Documento de Identidade',
        }),
      ]),
    );

    // provisionedAt 30s ago — well within sandbox timeout (2 min)
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(Date.now() - 30_000),
      documentsCache: null,
      documentsCacheUpdatedAt: null,
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    } as never);

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0]).toMatchObject({
      kind: 'WAITING_PROVIDER',
      groupId: '00000000-0000-0000-0000-000000000000',
      type: 'IDENTIFICATION',
    });
  });

  it('zero UUID + provisionedAt expirado → PROVISIONING_TIMEOUT', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: '00000000-0000-0000-0000-000000000000',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'Documento de Identidade',
        }),
      ]),
    );

    // provisionedAt 5 min ago — past sandbox timeout (2 min)
    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(Date.now() - 5 * 60_000),
      documentsCache: null,
      documentsCacheUpdatedAt: null,
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    } as never);

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0]).toMatchObject({
      kind: 'PROVISIONING_TIMEOUT',
      groupId: '00000000-0000-0000-0000-000000000000',
      type: 'IDENTIFICATION',
    });
  });

  it('zero UUID + onboardingUrl expirado → PROVISIONING_TIMEOUT', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: '00000000-0000-0000-0000-000000000000',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'Documento de Identidade',
          onboardingUrl: 'https://asaas.com/onboarding/expired-zero-uuid',
          onboardingUrlExpirationDate: '2025-03-04 00:00:00',
        }),
      ]),
    );

    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(Date.now() - 5 * 60_000),
      documentsCache: null,
      documentsCacheUpdatedAt: null,
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    } as never);

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0]).toMatchObject({
      kind: 'PROVISIONING_TIMEOUT',
      groupId: '00000000-0000-0000-0000-000000000000',
      type: 'IDENTIFICATION',
    });
  });

  it('zero UUID sem provisionedAt → PROVISIONING_TIMEOUT (fallback)', async () => {
    mockGetMyAccountStatus.mockResolvedValue(makeStatus());
    mockGetMyAccountDocuments.mockResolvedValue(
      makeDocs([
        makeGroup({
          id: '00000000-0000-0000-0000-000000000000',
          status: 'NOT_SENT',
          type: 'IDENTIFICATION',
          title: 'Documento de Identidade',
        }),
      ]),
    );

    const { prisma } = await import('@alusa/database');
    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: null,
      documentsCache: null,
      documentsCacheUpdatedAt: null,
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    } as never);

    const snapshot = await getKycSnapshot(FP_ID);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.nextActions).toHaveLength(1);
    expect(snapshot!.nextActions[0].kind).toBe('PROVISIONING_TIMEOUT');
  });

  it('usa cache recente quando busca fresh falha com 502 do Asaas', async () => {
    const { prisma } = await import('@alusa/database');
    const { AsaasHttpError } = await import('@alusa/asaas');

    vi.mocked(prisma.asaasAccount.findUnique).mockResolvedValueOnce({
      id: 'aa_001',
      asaasAccountId: ASAAS_ACCOUNT_ID,
      provisionedAt: new Date(Date.now() - 60_000),
      documentsCache: {
        version: 2,
        myAccountStatus: { general: 'PENDING', documentation: 'PENDING', bankAccountInfo: 'PENDING' },
        groups: [],
        rejectReasons: [],
        fetchedAt: new Date().toISOString(),
      },
      documentsCacheUpdatedAt: new Date(Date.now() - 30_000),
      commercialInfoStatus: null,
      commercialInfoScheduledDate: null,
    } as never);

    mockGetMyAccountStatus.mockRejectedValueOnce(new AsaasHttpError('bad gateway', 502));
    mockGetMyAccountDocuments.mockRejectedValueOnce(new AsaasHttpError('bad gateway', 502));

    const snapshot = await getKycSnapshot(FP_ID, { fresh: true });

    expect(snapshot).not.toBeNull();
    expect(snapshot?.fetchedAt).toBeDefined();
    expect(snapshot?.processStatus).toBeDefined();
  });
});
