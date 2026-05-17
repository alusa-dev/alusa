import Link from 'next/link';
import { notFound } from 'next/navigation';

import { requireGlobalAdminSessionForPage } from '@/features/global-admin/auth/session.server';
import { SupportAsaasRepairPanel } from '@/features/support/components/SupportAsaasRepairPanel';
import { getSupportAccount } from '@/features/support/queries/support-account';
import { compactId, formatDateTime, maskDocument } from '@/features/support/shared/format';
import { SupportShell } from '@/features/support/shared/SupportShell';
import {
  KeyValue,
  RowLink,
  StatusBadge,
  SupportMetric,
  SupportPageHeader,
  SupportPanel,
} from '@/features/support/shared/SupportUI';

export default async function SupportAccountPage({ params }: { params: { contaId: string } }) {
  const session = await requireGlobalAdminSessionForPage(`/developer/contas/${params.contaId}`);
  const data = await getSupportAccount(params.contaId);
  if (!data) notFound();

  const { conta, counts } = data;
  const asaasAccount = conta.financeProfile?.asaasAccount;
  const kyc = asaasAccount?.kycProcess;
  const subaccountAsaasId = asaasAccount?.asaasAccountId ?? conta.financeProfile?.asaasAccountId ?? null;
  const isWhitelabelBaas = conta.financeIntegrationMode === 'WHITELABEL_BAAS';

  return (
    <SupportShell session={session}>
      <SupportPageHeader
        eyebrow="Conta 360º"
        title={conta.nome}
        description="Visão operacional da escola com contexto financeiro, Asaas, webhooks e trilha de auditoria."
      />

      <div className="mb-6 flex flex-wrap gap-2">
        <Link
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          href={`/developer/contas/${conta.id}/financeiro`}
        >
          Financeiro
        </Link>
        <Link
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          href={`/developer/contas/${conta.id}/webhooks`}
        >
          Webhooks
        </Link>
        <Link
          className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
          href={`/developer/contas/${conta.id}/timeline`}
        >
          Timeline
        </Link>
      </div>

      <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
        <SupportMetric label="Usuários" value={counts.usuarios} />
        <SupportMetric label="Alunos" value={counts.alunos} />
        <SupportMetric label="Responsáveis" value={counts.responsaveis} />
        <SupportMetric label="Matrículas ativas" value={counts.matriculasAtivas} />
        <SupportMetric label="Cobranças abertas" value={counts.cobrancasAbertas} tone="warning" />
        <SupportMetric label="Webhooks com erro" value={counts.webhooksComErro} tone="danger" />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <SupportPanel title="Identidade da conta">
          <dl>
            <KeyValue label="contaId" value={conta.id} />
            <KeyValue label="Documento" value={maskDocument(conta.cpfCnpj)} />
            <KeyValue label="Status" value={<StatusBadge value={conta.status} />} />
            <KeyValue label="Modo financeiro" value={conta.financeIntegrationMode} />
            <KeyValue label="Fuso horário" value={conta.timezone} />
            <KeyValue label="Criada em" value={formatDateTime(conta.createdAt)} />
          </dl>
        </SupportPanel>

        <SupportPanel
          title="Asaas / KYC"
          description="Diagnóstico da subconta, onboarding e recuperação segura da integração (white-label)."
        >
          <dl>
            <KeyValue
              label="Status financeiro"
              value={<StatusBadge value={conta.financeStatus} />}
            />
            <KeyValue
              label="Onboarding externo"
              value={<StatusBadge value={conta.externalAsaasOnboardingStatus} />}
            />
            <KeyValue
              label="Subconta Asaas"
              value={
                asaasAccount?.asaasAccountId ??
                conta.financeProfile?.asaasAccountId ??
                'Não vinculada'
              }
            />
            <KeyValue
              label="Status da subconta"
              value={<StatusBadge value={asaasAccount?.status} />}
            />
            <KeyValue label="API key" value={<StatusBadge value={asaasAccount?.apiKeyStatus} />} />
            <KeyValue
              label="Webhook"
              value={<StatusBadge value={asaasAccount?.webhookStatus} />}
            />
            <KeyValue
              label="Operacional"
              value={<StatusBadge value={asaasAccount?.operationalStatus} />}
            />
            <KeyValue
              label="Health check"
              value={formatDateTime(asaasAccount?.lastHealthCheckAt)}
            />
            <KeyValue
              label="Webhook check"
              value={formatDateTime(asaasAccount?.lastWebhookCheckAt)}
            />
            <KeyValue label="KYC" value={<StatusBadge value={kyc?.status} />} />
            <KeyValue
              label="Última sincronização"
              value={formatDateTime(conta.financeProfile?.lastAsaasSyncAt)}
            />
          </dl>

          {isWhitelabelBaas ? <SupportAsaasRepairPanel contaId={conta.id} /> : null}
        </SupportPanel>
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-3">
        <SupportPanel title="Cobranças recentes">
          <div className="space-y-3">
            {data.recentCharges.map((charge) => (
              <RowLink
                key={charge.id}
                href={`/developer/contas/${conta.id}/financeiro`}
                title={charge.payerName}
                description={charge.description ?? compactId(charge.asaasPaymentId)}
                meta={<StatusBadge value={charge.status} />}
              />
            ))}
          </div>
        </SupportPanel>

        <SupportPanel title="Webhooks recentes">
          <div className="space-y-3">
            {data.recentWebhooks.map((webhook) => (
              <RowLink
                key={webhook.id}
                href={`/developer/contas/${conta.id}/webhooks`}
                title={webhook.evento}
                description={webhook.eventId ?? webhook.ultimoErro ?? webhook.id}
                meta={<StatusBadge value={webhook.status} />}
              />
            ))}
          </div>
        </SupportPanel>

        <SupportPanel title="Auditoria recente">
          <div className="space-y-3">
            {data.recentAudit.map((audit) => (
              <RowLink
                key={audit.id}
                href="/developer/auditoria"
                title={audit.action}
                description={`${audit.actorType} · ${formatDateTime(audit.createdAt)}`}
                meta={<StatusBadge value={audit.entityType} />}
              />
            ))}
          </div>
        </SupportPanel>
      </div>
    </SupportShell>
  );
}
