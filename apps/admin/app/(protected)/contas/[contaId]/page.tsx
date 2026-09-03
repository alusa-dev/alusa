import Link from 'next/link';
import { notFound } from 'next/navigation';

import { Icon } from '@/components/icons/Icon';
import { requireAdminSessionForPage } from '@/lib/admin-session';
import { AccountWebhooksModal } from '@/features/support/components/AccountWebhooksModal';
import { AccountChargesTable } from '@/features/support/components/AccountChargesTable';
import { SupportAsaasRepairPanel } from '@/features/support/components/SupportAsaasRepairPanel';
import { getSupportAccount, listSupportAccountFinance } from '@/features/support/queries/support-account';
import {
  formatCurrency,
  formatDateTime,
  formatSupportStatus,
  maskDocument,
} from '@/features/support/shared/format';
import { SupportShell } from '@/features/support/shared/SupportShell';
import {
  SupportField,
  SupportMetric,
  SupportPageHeader,
  SupportPanel,
} from '@/features/support/shared/SupportUI';

function resolveAccountPhotoUrl(value: string | null | undefined) {
  const photo = value?.trim();
  if (!photo) return null;
  if (/^(data:|https?:\/\/)/i.test(photo)) return photo;

  try {
    return new URL(photo, process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').toString();
  } catch {
    return null;
  }
}

function formatWizardStep(step: number | null | undefined) {
  const labels: Record<number, string> = {
    1: 'Tipo de conta',
    2: 'Identificação',
    3: 'Contato',
    4: 'Endereço',
    5: 'Informações financeiras',
    6: 'Concluído',
  };
  if (!step) return 'Não iniciado';
  return `${step}/6 · ${labels[step] ?? 'Em andamento'}`;
}

function readCachedAsaasStatus(cache: unknown, area: 'general' | 'commercialInfo' | 'bankAccountInfo' | 'documentation') {
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return null;
  const myAccountStatus = (cache as { myAccountStatus?: unknown }).myAccountStatus;
  if (!myAccountStatus || typeof myAccountStatus !== 'object' || Array.isArray(myAccountStatus)) return null;
  const value = (myAccountStatus as Record<string, unknown>)[area];
  return typeof value === 'string' ? value : null;
}

export default async function SupportAccountPage({ params }: { params: Promise<{ contaId: string }> }) {
  const resolvedParams = await params;
  const session = await requireAdminSessionForPage(`/contas/${resolvedParams.contaId}`);
  const [data, charges] = await Promise.all([
    getSupportAccount(resolvedParams.contaId),
    listSupportAccountFinance(resolvedParams.contaId),
  ]);
  if (!data) notFound();

  const { conta, counts } = data;
  const financeProfile = conta.financeProfile;
  const asaasAccount = conta.financeProfile?.asaasAccount;
  const accountOwner = conta.ownerUser;
  const isWhitelabelBaas = conta.financeIntegrationMode === 'WHITELABEL_BAAS';
  const accountAddress = [
    conta.enderecoLogradouro,
    conta.enderecoNumero,
    conta.enderecoBairro,
    conta.enderecoCidade,
    conta.enderecoUf,
    conta.enderecoCep,
  ].filter(Boolean).join(', ');
  const financeAddress = [
    financeProfile?.address,
    financeProfile?.addressNumber,
    financeProfile?.province,
    financeProfile?.addressCity,
    financeProfile?.addressState,
    financeProfile?.postalCode,
  ].filter(Boolean).join(', ');
  const accountInitials = conta.nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  const accountPhotoUrl = resolveAccountPhotoUrl(conta.ownerUser?.foto);
  const recentWebhooks = data.recentWebhooks.map((webhook) => ({
    ...webhook,
    recebidoEm: webhook.recebidoEm.toISOString(),
    processadoEm: webhook.processadoEm?.toISOString() ?? null,
  }));

  return (
    <SupportShell session={session}>
      <div className="admin-detail account-detail">
        <Link className="account-detail-back" href="/contas">
          <Icon name="ChevronRight" size={16} className="account-detail-back-icon" aria-hidden="true" />
          Contas monitoradas
        </Link>

        <div className="account-detail-heading">
          <div className="account-detail-title">
            <div className="account-detail-avatar">
              {accountPhotoUrl ? (
                <img src={accountPhotoUrl} alt="" className="account-detail-avatar-image" />
              ) : accountInitials}
            </div>
            <SupportPageHeader
              title={conta.nome}
              description="Acompanhe o estado operacional, financeiro e de integração desta escola."
            />
          </div>

          <nav className="account-detail-actions" aria-label="Ações da conta">
            <AccountWebhooksModal contaId={conta.id} webhooks={recentWebhooks} />
          </nav>
        </div>

        <div className="account-detail-metrics">
          <SupportMetric label="Usuários" value={counts.usuarios} />
          <SupportMetric label="Alunos" value={counts.alunos} />
          <SupportMetric label="Responsáveis" value={counts.responsaveis} />
          <SupportMetric label="Matrículas ativas" value={counts.matriculasAtivas} />
          <SupportMetric label="Cobranças abertas" value={counts.cobrancasAbertas} tone="warning" />
          <SupportMetric label="Webhooks com erro" value={counts.webhooksComErro} tone="danger" />
        </div>

        <div className="account-detail-primary-grid">
          <SupportPanel title="Dados da conta" description="Informações cadastrais e operacionais armazenadas na Alusa.">
            <div className="support-fields">
              <SupportField label="ID da conta" value={conta.id} />
              <SupportField label="Nome cadastrado" value={conta.nome} />
              <SupportField label="Documento" value={maskDocument(conta.cpfCnpj)} />
              <SupportField label="Status" value={formatSupportStatus(conta.status)} />
              <SupportField label="Modo financeiro" value={formatSupportStatus(conta.financeIntegrationMode)} />
              <SupportField label="Status do onboarding Asaas" value={formatSupportStatus(conta.externalAsaasOnboardingStatus)} />
              <SupportField label="Fuso horário" value={conta.timezone} />
              <SupportField label="Endereço" value={accountAddress} />
            </div>
            {conta.deletedAt || conta.deleteReason ? (
              <div className="account-data-alert">
                <strong>Exclusão da conta</strong>
                <span>{conta.deleteReason ?? 'Solicitação registrada'} · {formatDateTime(conta.deletedAt)}</span>
              </div>
            ) : null}
          </SupportPanel>

          <SupportPanel title="Usuário responsável" description="Dados do usuário que administra esta conta na Alusa.">
            <div className="support-fields">
              <SupportField label="Nome" value={accountOwner?.nome} />
              <SupportField label="E-mail" value={accountOwner?.email} />
              <SupportField label="Telefone" value={accountOwner?.telefone} />
              <SupportField label="Perfil" value={formatSupportStatus(accountOwner?.role)} />
              <SupportField label="Status" value={formatSupportStatus(accountOwner?.status)} />
              <SupportField label="E-mail verificado" value={formatDateTime(accountOwner?.emailVerifiedAt)} />
            </div>
          </SupportPanel>

          <SupportPanel title="Onboarding financeiro" description="Dados preenchidos pela instituição durante a configuração financeira.">
            {financeProfile ? (
              <div className="support-fields">
                <SupportField label="Etapa preenchida" value={formatWizardStep(financeProfile.wizardStep)} />
                <SupportField label="Tipo de pessoa" value={formatSupportStatus(financeProfile.draftPersonType)} />
                <SupportField label="CPF/CNPJ informado" value={maskDocument(financeProfile.draftCpfCnpj ?? conta.cpfCnpj)} />
                <SupportField label="Data de nascimento" value={financeProfile.draftBirthDate} />
                <SupportField label="Nome do responsável" value={financeProfile.asaasOwnerName ?? financeProfile.asaasName} />
                <SupportField label="Razão social" value={financeProfile.asaasCompanyName} />
                <SupportField label="Tipo de empresa" value={formatSupportStatus(financeProfile.companyType)} />
                <SupportField label="E-mail financeiro" value={financeProfile.asaasLoginEmail} />
                <SupportField label="Celular" value={financeProfile.mobilePhone} />
                <SupportField label="Site" value={financeProfile.asaasSite} />
                <SupportField label="Renda/faturamento informado" value={financeProfile.incomeValue != null ? formatCurrency(financeProfile.incomeValue) : null} />
                <SupportField label="Endereço" value={financeAddress} />
                <SupportField label="Status do perfil" value={formatSupportStatus(financeProfile.status)} />
                <SupportField
                  label="Onboarding"
                  value={financeProfile.isOnboardingCompleted
                    ? `Concluído${financeProfile.wizardCompletedAt ?? financeProfile.onboardingCompletedAt ? ` em ${formatDateTime(financeProfile.wizardCompletedAt ?? financeProfile.onboardingCompletedAt)}` : ''}`
                    : 'Pendente'}
                />
                <SupportField label="Última sincronização" value={formatDateTime(financeProfile.lastAsaasSyncAt)} />
              </div>
            ) : (
              <p className="account-data-muted">Nenhum perfil de onboarding financeiro foi criado para esta conta.</p>
            )}
          </SupportPanel>

          <SupportPanel title="Dados sincronizados do Asaas" description="Snapshot local dos identificadores, estados e retornos operacionais do Asaas. As credenciais não são exibidas.">
            {asaasAccount ? (
              <>
                <div className="support-fields">
                  <SupportField label="ID da subconta Asaas" value={asaasAccount.asaasAccountId} />
                  <SupportField label="Wallet ID" value={asaasAccount.walletId} />
                  <SupportField label="E-mail da conta Asaas" value={asaasAccount.asaasAccountEmail} />
                  <SupportField label="Status da subconta" value={formatSupportStatus(asaasAccount.status)} />
                  <SupportField label="Status geral no Asaas" value={formatSupportStatus(readCachedAsaasStatus(asaasAccount.documentsCache, 'general'))} />
                  <SupportField label="Dados comerciais no Asaas" value={formatSupportStatus(readCachedAsaasStatus(asaasAccount.documentsCache, 'commercialInfo'))} />
                  <SupportField label="Dados bancários no Asaas" value={formatSupportStatus(readCachedAsaasStatus(asaasAccount.documentsCache, 'bankAccountInfo'))} />
                  <SupportField label="Documentação no Asaas" value={formatSupportStatus(readCachedAsaasStatus(asaasAccount.documentsCache, 'documentation'))} />
                  <SupportField label="Status regulatório" value={formatSupportStatus(financeProfile?.status)} />
                  <SupportField label="Status operacional" value={formatSupportStatus(asaasAccount.operationalStatus)} />
                  <SupportField label="Status da API key" value={formatSupportStatus(asaasAccount.apiKeyStatus)} />
                  <SupportField label="Status do webhook" value={formatSupportStatus(asaasAccount.webhookStatus)} />
                  <SupportField label="Status comercial" value={formatSupportStatus(asaasAccount.commercialInfoStatus)} />
                  <SupportField label="Data comercial agendada" value={asaasAccount.commercialInfoScheduledDate} />
                  <SupportField label="Provisionada em" value={formatDateTime(asaasAccount.provisionedAt)} />
                  <SupportField label="Último sync Asaas" value={formatDateTime(asaasAccount.lastAsaasSyncAt)} />
                  <SupportField label="Última reconciliação" value={formatDateTime(asaasAccount.lastFinanceReconciliationAt)} />
                  <SupportField label="Expiração da API key" value={formatDateTime(asaasAccount.apiKeyExpiresAt)} />
                  <SupportField label="Exclusão externa" value={formatSupportStatus(asaasAccount.deletionState)} />
                </div>
                {asaasAccount.provisionLastError || asaasAccount.regulatoryBlockReason ? (
                  <div className="account-data-alert">
                    <strong>Observação operacional</strong>
                    <span>{asaasAccount.provisionLastError ?? asaasAccount.regulatoryBlockReason}</span>
                  </div>
                ) : null}
                {asaasAccount.provisionAttempts > 0 || asaasAccount.provisionLastAttemptAt || asaasAccount.provisionLastHttpStatus ? (
                  <div className="account-data-subsection">
                    <div className="support-fields">
                      <SupportField label="Tentativas de provisionamento" value={asaasAccount.provisionAttempts} />
                      <SupportField label="Última tentativa" value={formatDateTime(asaasAccount.provisionLastAttemptAt)} />
                      <SupportField label="Último HTTP do provisionamento" value={asaasAccount.provisionLastHttpStatus} />
                    </div>
                  </div>
                ) : null}
                {asaasAccount.deletionState !== 'NOT_REQUESTED' ? (
                  <div className="account-data-subsection">
                    <div className="support-fields">
                      <SupportField label="Excluída externamente em" value={formatDateTime(asaasAccount.deletedExternallyAt)} />
                      <SupportField label="Excluída localmente em" value={formatDateTime(asaasAccount.deletedLocallyAt)} />
                    </div>
                  </div>
                ) : null}
                {isWhitelabelBaas ? (
                  <div className="account-data-subsection">
                    <SupportAsaasRepairPanel
                      contaId={conta.id}
                      accountStatus={formatSupportStatus(asaasAccount.status)}
                      financeStatus={formatSupportStatus(conta.financeStatus)}
                      webhookStatus={asaasAccount.webhookStatus}
                    />
                  </div>
                ) : null}
              </>
            ) : (
              <p className="account-data-muted">Nenhuma subconta Asaas foi vinculada a esta conta.</p>
            )}
          </SupportPanel>

        </div>

        <SupportPanel
          className="account-detail-charges"
          title="Todas as cobranças"
          description={`${charges.length} cobranças disponíveis para consulta.`}
          bodyClassName="account-detail-charges-body"
        >
          <AccountChargesTable
            contaId={conta.id}
            charges={charges.map((charge) => ({
              id: charge.id,
              asaasPaymentId: charge.asaasPaymentId,
              value: Number(charge.value),
              chargeType: charge.chargeType,
              billingType: charge.billingType,
              status: charge.status,
            }))}
          />
        </SupportPanel>

      </div>
    </SupportShell>
  );
}
