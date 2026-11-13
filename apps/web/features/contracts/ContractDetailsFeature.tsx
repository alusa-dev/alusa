'use client';

import { useEffect, useState } from 'react';
import { logClientOperationalEvent } from '@/lib/observability/client-operational-log';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Download, Eye, Share2 } from '@/components/icons/icons';
import {
  getContract,
  createContract,
  regenerateContract,
  regenerateEventContract,
  getEventContract,
  type Contract,
  type ContractEvent,
  getContractNotificationHistory,
  type ContractNotificationHistory,
} from './services/contracts-service';
import { Badge, type StatusType } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { InfoCallout } from '@/components/ui/info-callout';
import { ShareContractDialog } from './components/ShareContractDialog';
import { PDFViewer } from './components/PDFViewer';
import { toast } from '@/components/ui/toast';

interface ContratoDetalhesFeatureProps {
  contratoId: string;
  origem?: 'MATRICULA' | 'EVENTO';
}

type ContratoDetalhe = {
  id: string;
  status: string;
  modelo: { id?: string | null; nome: string } | null;
  arquivoPdfUrl: string;
  arquivoPdfAssinadoUrl: string | null;
  tokenPublico: string;
  tokenExpiraEm: string | null;
  createdAt: string;
  aluno: { nome: string; cpf: string | null };
  matriculaId?: string;
  evento?: { name: string } | null;
  assinadoPor: string | null;
  assinadoCpf: string | null;
  assinadoEm: string | null;
  hashAssinatura: string | null;
  origem: 'MATRICULA' | 'EVENTO';
};

type SignatureTimelineEvent = {
  id: string;
  at: string;
  kind: 'CREATED' | 'NOTIFICATION' | 'SIGNED';
  title: string;
  detail?: string;
  error?: string | null;
};

function normalizeContrato(contrato: Contract): ContratoDetalhe {
  return {
    id: contrato.id,
    status: contrato.status,
    modelo: contrato.modelo,
    arquivoPdfUrl: contrato.arquivoPdfUrl,
    arquivoPdfAssinadoUrl: contrato.arquivoPdfAssinadoUrl,
    tokenPublico: contrato.tokenPublico,
    tokenExpiraEm: contrato.tokenExpiraEm,
    createdAt: contrato.createdAt,
    aluno: contrato.matricula.aluno,
    matriculaId: contrato.matriculaId,
    assinadoPor: contrato.assinadoPor,
    assinadoCpf: contrato.assinadoCpf,
    assinadoEm: contrato.assinadoEm,
    hashAssinatura: contrato.hashAssinatura,
    origem: 'MATRICULA',
  };
}

function normalizeEventoContrato(contrato: ContractEvent): ContratoDetalhe {
  return {
    id: contrato.id,
    status: contrato.status,
    modelo: contrato.modelo,
    arquivoPdfUrl: contrato.arquivoPdfUrl,
    arquivoPdfAssinadoUrl: contrato.arquivoPdfAssinadoUrl,
    tokenPublico: contrato.tokenPublico,
    tokenExpiraEm: contrato.tokenExpiraEm,
    createdAt: contrato.createdAt,
    aluno: { nome: contrato.aluno?.nome ?? 'Aluno indisponível', cpf: contrato.aluno?.cpf ?? null },
    evento: contrato.evento,
    assinadoPor: contrato.assinadoPor,
    assinadoCpf: contrato.assinadoCpf,
    assinadoEm: contrato.assinadoEm,
    hashAssinatura: contrato.hashAssinatura,
    origem: 'EVENTO',
  };
}

function formatContractCreatedAt(value: string) {
  const date = new Date(value);
  const dateLabel = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeLabel = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).replace(':', 'h');
  return `${dateLabel}, às ${timeLabel}`;
}

function latestNotification<T extends { createdAt: string; processedAt: string | null }>(items: T[]) {
  return [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];
}

function maskEmail(email: string) {
  const [localPart, domain] = email.split('@');
  if (!localPart || !domain) return email;
  return `${localPart[0]}***@${domain}`;
}

function maskPhone(phone: string) {
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 4 ? `(••) •••••-${digits.slice(-4)}` : phone;
}

function notificationState(status: string, confirmed: boolean) {
  if (status === 'SENT' && confirmed) return 'sent' as const;
  if (status === 'PENDING' || status === 'SENT') return 'pending' as const;
  if (status === 'PROCESSING') return 'processing' as const;
  if (status === 'FAILED' || status === 'DLQ') return 'failed' as const;
  return 'not-sent' as const;
}

function notificationDetail(channel: 'email' | 'whatsapp', state: ReturnType<typeof notificationState>, recipient: string) {
  const label = channel === 'email' ? 'E-mail' : 'Mensagem';
  if (state === 'sent') return `${label} ${channel === 'email' ? 'enviado' : 'enviada'} para · ${recipient}`;
  if (state === 'pending') return `Envio pendente para · ${recipient}`;
  if (state === 'processing') return `Envio em andamento para · ${recipient}`;
  if (state === 'failed') return `Não foi possível enviar para · ${recipient}`;
  return `Envio não realizado para · ${recipient}`;
}

export function ContratoDetalhesFeature({ contratoId, origem = 'MATRICULA' }: ContratoDetalhesFeatureProps) {
  const router = useRouter();
  const [contrato, setContrato] = useState<ContratoDetalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notificationHistory, setNotificationHistory] = useState<ContractNotificationHistory>({ email: [], whatsapp: [] });
  const [notificationHistoryError, setNotificationHistoryError] = useState(false);
  const [refreshingNotificationHistory, setRefreshingNotificationHistory] = useState(false);
  const isEvento = contrato?.origem === 'EVENTO';
  const signatureTimeline: SignatureTimelineEvent[] = contrato
    ? [
        {
          id: 'contract-created',
          at: contrato.createdAt,
          kind: 'CREATED' as const,
          title: 'Contrato criado',
          detail: contrato.modelo?.nome ? `Modelo: ${contrato.modelo.nome}` : undefined,
        },
        ...(latestNotification(notificationHistory.email) ? (() => {
          const item = latestNotification(notificationHistory.email)!;
          const state = notificationState(item.status, item.status === 'SENT');
          return [{
            id: 'email-latest',
            at: item.processedAt ?? item.createdAt,
            kind: 'NOTIFICATION' as const,
            title: 'Envio por e-mail',
            detail: notificationDetail('email', state, maskEmail(item.recipientEmail)),
          }];
        })() : []),
        ...(latestNotification(notificationHistory.whatsapp) ? (() => {
          const item = latestNotification(notificationHistory.whatsapp)!;
          const state = notificationState(item.status, item.providerAccepted);
          const recipientPhone = 'recipientPhone' in item && typeof item.recipientPhone === 'string'
            ? item.recipientPhone
            : '';
          return [{
            id: 'whatsapp-latest',
            at: item.processedAt ?? item.createdAt,
            kind: 'NOTIFICATION' as const,
            title: 'Envio por WhatsApp',
            detail: notificationDetail('whatsapp', state, recipientPhone ? maskPhone(recipientPhone) : 'destinatário'),
          }];
        })() : []),
        ...(contrato.assinadoEm
          ? [{
              id: 'contract-signed',
              at: contrato.assinadoEm,
              kind: 'SIGNED' as const,
              title: 'Contrato assinado',
              detail: contrato.assinadoPor ? `Assinado por ${contrato.assinadoPor}` : undefined,
            }]
          : []),
      ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    : [];

  useEffect(() => {
    setLoading(true);
    const request = origem === 'EVENTO'
      ? getEventContract(contratoId).then(normalizeEventoContrato)
      : getContract(contratoId).then(normalizeContrato);
    request
      .then(async (value) => {
        setContrato(value);
        if (origem === 'MATRICULA') {
          try {
            setNotificationHistory(await getContractNotificationHistory(value.id));
            setNotificationHistoryError(false);
          } catch {
            setNotificationHistoryError(true);
          }
        }
      })
      .catch((err) => {
        toast.error('Erro ao carregar contrato');
        logClientOperationalEvent('contracts.details.load_failed', err);
      })
      .finally(() => setLoading(false));
  }, [contratoId, origem]);

  const handleGerarAditivo = async () => {
    if (!contrato || isEvento || !contrato.modelo?.id || !contrato.matriculaId) {
      toast.error('Aditivos estão disponíveis apenas para contratos de matrícula');
      return;
    }
    try {
      const novo = await createContract({ matriculaId: contrato.matriculaId, modeloId: contrato.modelo.id, contratoOrigemId: contrato.id });
      setContrato(normalizeContrato(novo));
      toast.success('Aditivo gerado. Envie o novo link para assinatura.');
      setShareOpen(true);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const pdfUrl = contrato ? (contrato.arquivoPdfAssinadoUrl || contrato.arquivoPdfUrl) : '';

  const handleDownload = () => {
    if (!contrato || !pdfUrl) return;
    const link = document.createElement('a');
    link.href = pdfUrl;
    link.download = `Contrato-${contrato.aluno.nome}.pdf`;
    link.click();
  };

  const handleShareContrato = async () => {
    if (!contrato || sharing) return;
    try {
      setSharing(true);
      const updated = isEvento
        ? normalizeEventoContrato(await regenerateEventContract(contrato.id))
        : normalizeContrato(await regenerateContract(contrato.id));
      setContrato(updated);
      if (!isEvento) {
        try {
          setNotificationHistory(await getContractNotificationHistory(updated.id));
          setNotificationHistoryError(false);
        } catch {
          setNotificationHistoryError(true);
        }
      }
      setShareOpen(true);
      toast.success('Link de assinatura gerado.');
    } catch (error) {
      toast.error((error as Error).message || 'Erro ao gerar link de assinatura');
    } finally {
      setSharing(false);
    }
  };

  const refreshNotificationHistory = async () => {
    if (!contrato || isEvento || refreshingNotificationHistory) return;
    setRefreshingNotificationHistory(true);
    try {
      setNotificationHistory(await getContractNotificationHistory(contrato.id));
      setNotificationHistoryError(false);
    } catch {
      setNotificationHistoryError(true);
    } finally {
      setRefreshingNotificationHistory(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-white">
        <div className="w-full min-w-0 px-6 pt-6 pb-0">
          <div className="mb-4">
            <Skeleton className="mb-4 h-11 w-24" />
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
              <div className="min-w-0 flex-1 space-y-3">
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-64" />
                </div>
                <Skeleton className="h-4 w-72" />
              </div>
              <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap lg:w-auto">
                <Skeleton className="h-10 w-full sm:w-40" />
                <Skeleton className="h-10 w-full sm:w-36" />
                <Skeleton className="h-10 w-full sm:w-28" />
              </div>
            </div>
          </div>

        <div className="w-full min-w-0 px-6 py-8">
          <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
            <div className="space-y-4 lg:col-span-8 xl:col-span-9">
              <Skeleton className="h-12 w-full rounded-t-lg" />
              <Skeleton className="h-[32rem] w-full rounded-b-lg" />
            </div>
            <div className="lg:col-span-4 xl:col-span-3">
              <div className="space-y-5 rounded-xl border border-slate-200 p-6">
                <Skeleton className="h-5 w-44" />
                <Skeleton className="h-px w-full" />
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-4 w-40" />
                <div className="grid grid-cols-2 gap-4">
                  <Skeleton className="h-14 w-full" />
                  <Skeleton className="h-14 w-full" />
                </div>
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-24 w-full rounded-lg" />
              </div>
            </div>
          </div>
        </div>
        </div>
      </div>
    );
  }
  if (!contrato) return <div className="flex min-h-screen items-center justify-center bg-gray-50"><div className="text-center"><p className="mb-4 text-gray-600">Contrato não encontrado</p><Button onClick={() => router.back()}>Voltar</Button></div></div>;

  return (
    <div className="min-h-screen bg-white">
      <div className="w-full min-w-0 px-6 pt-6 pb-0">
        <div className="mb-4">
          <button
            type="button"
            onClick={() => router.back()}
            className="mb-4 flex min-h-11 items-center gap-2 rounded-md px-1 text-sm text-gray-600 transition-colors hover:bg-gray-50 hover:text-gray-900 sm:mb-5"
          >
            <ArrowLeft className="h-4 w-4 shrink-0" />
            Voltar
          </button>
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between lg:gap-6">
            <div className="min-w-0 flex-1">
              <h1 className="text-3xl font-bold leading-tight text-gray-900">Detalhes do Contrato</h1>
              <p className="mt-2 text-sm text-gray-600">
                Visualize o documento e acompanhe o processo de assinatura deste contrato.
              </p>
            </div>
            <div className="flex w-full min-w-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-stretch lg:w-auto lg:flex-initial lg:items-center lg:justify-end">
            {(contrato.status === 'PENDENTE' || contrato.status === 'EXPIRADO') && (
              <Button variant="outline" onClick={handleShareContrato} disabled={sharing} className="h-10 w-full justify-center border-gray-300 px-4 text-gray-700 hover:bg-gray-50 sm:w-auto">
                <Share2 className="mr-2 h-4 w-4" />{sharing ? 'Gerando Link...' : 'Compartilhar Link'}
              </Button>
            )}
            {contrato.status === 'ASSINADO' && !isEvento && (
              <Button variant="outline" onClick={handleGerarAditivo} className="h-10 w-full justify-center border-gray-300 px-4 text-gray-700 hover:bg-gray-50 sm:w-auto">Gerar aditivo</Button>
            )}
            <Button variant="outline" onClick={() => window.open(pdfUrl, '_blank', 'noopener,noreferrer')} className="h-10 w-full justify-center border-gray-300 px-4 text-gray-700 hover:bg-gray-50 sm:w-auto">
              <Eye className="mr-2 h-4 w-4" />Visualizar PDF
            </Button>
            <Button onClick={handleDownload} className="h-10 w-full justify-center px-4 shadow-none sm:w-auto">
              <Download className="mr-2 h-4 w-4" />Baixar
            </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full min-w-0 px-6 py-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-8 xl:col-span-9"><div className="space-y-4">{pdfUrl ? <PDFViewer url={pdfUrl} title={`Contrato - ${contrato.aluno.nome}`} className="w-full" maxHeight="82vh" showDownload={false} /> : <div className="flex h-[32rem] items-center justify-center rounded-lg border bg-gray-50 font-medium text-gray-400">PDF não disponível</div>}
            {contrato.status === 'ASSINADO' && <div className="px-1 py-2"><p className="mb-1 text-sm font-semibold text-emerald-900">Assinatura Eletrônica Registrada</p><div className="space-y-1 text-sm text-emerald-800"><p><span className="font-medium">Assinado por:</span> {contrato.assinadoPor || 'N/A'}</p><p><span className="font-medium">CPF:</span> {contrato.assinadoCpf || 'N/A'}</p><p><span className="font-medium">Data:</span> {contrato.assinadoEm ? new Date(contrato.assinadoEm).toLocaleString() : 'N/A'}</p>{contrato.hashAssinatura && <p className="mt-2 break-all font-mono text-xs text-emerald-700/80">Hash: {contrato.hashAssinatura}</p>}</div></div>}
          </div></div>
          <div className="space-y-6 lg:col-span-4 xl:col-span-3">
            <Card className="border border-slate-200 shadow-none">
              <CardHeader className="border-b border-gray-100 pb-3">
                <CardTitle className="text-base font-medium">Informações do Contrato</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Aluno</p>
                    <p className="mt-1 text-sm font-medium text-gray-900">{contrato.aluno.nome}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">CPF do Aluno</p>
                      <p className="mt-1 font-mono text-sm font-medium text-gray-900">{contrato.aluno.cpf || 'Não informado'}</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p>
                      <div className="mt-1"><Badge status={contrato.status as StatusType} size="sm" /></div>
                    </div>
                  </div>
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-gray-500">Modelo Utilizado</p>
                    <p className="mt-1 text-sm font-medium text-gray-900">{contrato.modelo?.nome || 'Modelo Personalizado'}</p>
                  </div>
                  <div className="border-t border-gray-100 pt-4">
                    <p className="mb-1 text-xs font-medium text-gray-500">Criado em</p>
                    <p className="text-sm text-gray-700">{formatContractCreatedAt(contrato.createdAt)}</p>
                  </div>
                </div>
                {contrato.status === 'PENDENTE' && (
                  <InfoCallout variant="warning" size="sm" title="Aguardando Assinatura">
                    O link de assinatura está ativo para assinatura.
                  </InfoCallout>
                )}
              </CardContent>
            </Card>
            {(notificationHistoryError || signatureTimeline.length > 0) && (
              <section aria-label="Histórico de assinatura" className="rounded-lg border border-slate-200 p-4 text-sm">
                <h2 className="font-semibold text-slate-800">Histórico de assinatura</h2>
                {!isEvento && notificationHistoryError && (
                  <div role="status" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-amber-800">
                    <span>Não foi possível carregar o histórico de assinatura.</span>
                    <Button variant="outline" size="sm" onClick={() => void refreshNotificationHistory()} disabled={refreshingNotificationHistory}>
                      {refreshingNotificationHistory ? 'Atualizando…' : 'Tentar novamente'}
                    </Button>
                  </div>
                )}
                {signatureTimeline.length > 0 && (
                  <ol aria-label="Linha do tempo da assinatura" className="mt-4 space-y-0">
                    {signatureTimeline.map((item, index) => (
                      <li key={item.id} className="relative flex gap-3 pb-4 last:pb-0">
                        <span className="relative w-3 shrink-0" aria-hidden="true">
                          {index < signatureTimeline.length - 1 && (
                            <span className="absolute left-1/2 top-[9px] bottom-[-25px] w-px -translate-x-1/2 bg-slate-200" />
                          )}
                          <span className={`relative z-10 mx-auto mt-1 block h-2.5 w-2.5 rounded-full ${item.kind === 'SIGNED' ? 'bg-emerald-600' : 'bg-[#5c2f91]'}`} />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-slate-800">{item.title}</p>
                          <time dateTime={new Date(item.at).toISOString()} className="mt-1 block text-xs text-slate-500">
                            {new Date(item.at).toLocaleString('pt-BR')}
                          </time>
                          {item.detail && <p className="mt-1 text-xs text-slate-500">{item.detail}</p>}
                          {item.error && <p className="mt-1 text-xs text-red-700">{item.error}</p>}
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}
          </div>
        </div>
      </div>
      <ShareContractDialog open={shareOpen} onOpenChange={setShareOpen} tokenPublico={contrato.tokenPublico} alunoNome={contrato.aluno.nome} publicPath={isEvento ? '/p/evento-contrato' : '/p/contrato'} />
    </div>
  );
}
