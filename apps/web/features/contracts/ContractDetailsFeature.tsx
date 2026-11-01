'use client';

import { useEffect, useRef, useState } from 'react';
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
  resendContractNotification,
  type ContractNotificationHistory,
} from './services/contracts-service';
import { Badge, type StatusType } from '@/components/ui/badge';
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

export function ContratoDetalhesFeature({ contratoId, origem = 'MATRICULA' }: ContratoDetalhesFeatureProps) {
  const router = useRouter();
  const [contrato, setContrato] = useState<ContratoDetalhe | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [notificationHistory, setNotificationHistory] = useState<ContractNotificationHistory>({ email: [], whatsapp: [] });
  const [notificationHistoryError, setNotificationHistoryError] = useState(false);
  const [refreshingNotificationHistory, setRefreshingNotificationHistory] = useState(false);
  const [resendingChannel, setResendingChannel] = useState<'EMAIL' | 'WHATSAPP' | null>(null);
  const resendLockRef = useRef(false);
  const isEvento = contrato?.origem === 'EVENTO';

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

  const handleResendChannel = async (channel: 'EMAIL' | 'WHATSAPP') => {
    if (!contrato || isEvento || resendLockRef.current) return;
    resendLockRef.current = true;
    try {
      setResendingChannel(channel);
      await resendContractNotification(contrato.id, channel, crypto.randomUUID());
      try {
        setNotificationHistory(await getContractNotificationHistory(contrato.id));
        setNotificationHistoryError(false);
      } catch {
        setNotificationHistoryError(true);
      }
      toast.success(channel === 'EMAIL' ? 'E-mail colocado na fila de envio.' : 'Reenvio por WhatsApp processado.');
    } catch (error) {
      toast.error((error as Error).message || 'Erro ao reenviar notificação');
    } finally {
      resendLockRef.current = false;
      setResendingChannel(null);
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

  const notificationStatusLabel = (status: string) => ({
    PENDING: 'Aguardando envio',
    PROCESSING: 'Em processamento',
    SENT: 'Aceito pelo provedor',
    FAILED: 'Falha temporária; nova tentativa prevista',
    DLQ: 'Falha após as tentativas disponíveis',
    SKIPPED: 'Envio cancelado: preferências, destinatário ou link alterados',
  }[status] ?? 'Status indisponível');

  if (loading) return <div className="flex min-h-screen items-center justify-center bg-gray-50"><div className="h-12 w-12 animate-spin rounded-full border-b-2 border-brand-accent" /></div>;
  if (!contrato) return <div className="flex min-h-screen items-center justify-center bg-gray-50"><div className="text-center"><p className="mb-4 text-gray-600">Contrato não encontrado</p><Button onClick={() => router.back()}>Voltar</Button></div></div>;

  return (
    <div className="min-h-screen bg-white">
      <div className="sticky top-0 z-10 bg-white px-6 py-5">
        <div className="flex w-full min-w-0 flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={() => router.back()} className="-ml-2 hover:bg-gray-100" title="Voltar"><ArrowLeft className="h-5 w-5 text-gray-500" /></Button>
              <div>
                <div className="flex items-center gap-3"><h1 className="text-xl font-semibold tracking-tight text-gray-900">Detalhes do Contrato</h1><Badge status={contrato.status as StatusType} size="sm" /></div>
                <p className="mt-0.5 text-sm text-gray-500">Contrato #{contrato.id.slice(0, 8)} • {contrato.aluno.nome}{contrato.evento ? ` • ${contrato.evento.name}` : ''}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {(contrato.status === 'PENDENTE' || contrato.status === 'EXPIRADO') && <Button variant="outline" size="sm" onClick={handleShareContrato} disabled={sharing}><Share2 className="mr-2 h-4 w-4" />{sharing ? 'Gerando Link...' : 'Compartilhar Link'}</Button>}
              {!isEvento && contrato.status === 'PENDENTE' && <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void handleResendChannel('EMAIL')} disabled={resendingChannel !== null}>{resendingChannel === 'EMAIL' ? 'Enfileirando…' : 'Reenviar por e-mail'}</Button>
                <Button variant="outline" size="sm" onClick={() => void handleResendChannel('WHATSAPP')} disabled={resendingChannel !== null}>{resendingChannel === 'WHATSAPP' ? 'Enviando…' : 'Reenviar por WhatsApp'}</Button>
              </div>}
              {contrato.status === 'ASSINADO' && !isEvento && <Button variant="outline" size="sm" onClick={handleGerarAditivo}>Gerar aditivo</Button>}
              <Button variant="outline" size="sm" onClick={() => window.open(pdfUrl, '_blank', 'noopener,noreferrer')}><Eye className="mr-2 h-4 w-4" />Visualizar PDF</Button>
              <Button size="sm" onClick={handleDownload} className="shadow-none"><Download className="mr-2 h-4 w-4" />Baixar</Button>
            </div>
          </div>
        </div>
      </div>

      <div className="w-full min-w-0 px-6 py-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-8 xl:col-span-9"><div className="space-y-4">{pdfUrl ? <PDFViewer url={pdfUrl} title={`Contrato - ${contrato.aluno.nome}`} className="w-full" maxHeight="82vh" showDownload={false} /> : <div className="flex h-[32rem] items-center justify-center rounded-lg border bg-gray-50 font-medium text-gray-400">PDF não disponível</div>}
            {contrato.status === 'ASSINADO' && <div className="px-1 py-2"><p className="mb-1 text-sm font-semibold text-emerald-900">Assinatura Eletrônica Registrada</p><div className="space-y-1 text-sm text-emerald-800"><p><span className="font-medium">Assinado por:</span> {contrato.assinadoPor || 'N/A'}</p><p><span className="font-medium">CPF:</span> {contrato.assinadoCpf || 'N/A'}</p><p><span className="font-medium">Data:</span> {contrato.assinadoEm ? new Date(contrato.assinadoEm).toLocaleString() : 'N/A'}</p>{contrato.hashAssinatura && <p className="mt-2 break-all font-mono text-xs text-emerald-700/80">Hash: {contrato.hashAssinatura}</p>}</div></div>}
            {!isEvento && (notificationHistoryError || notificationHistory.email.length > 0 || notificationHistory.whatsapp.length > 0) && <section aria-label="Histórico de notificações de assinatura" className="rounded-lg border border-slate-200 p-4 text-sm">
              <h2 className="font-semibold text-slate-800">Histórico de notificações</h2>
              {notificationHistoryError && <div role="status" className="mt-2 flex flex-wrap items-center gap-2 text-sm text-amber-800"><span>Não foi possível carregar o histórico de notificações.</span><Button variant="outline" size="sm" onClick={() => void refreshNotificationHistory()} disabled={refreshingNotificationHistory}>{refreshingNotificationHistory ? 'Atualizando…' : 'Tentar novamente'}</Button></div>}
              <div className="mt-3 space-y-3">
                {[...notificationHistory.email.map((item) => ({ ...item, channelName: 'E-mail' })), ...notificationHistory.whatsapp.map((item) => ({ ...item, channelName: 'WhatsApp' }))].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).map((item) => (
                  <div key={`${item.channelName}-${item.id}`} className="border-t border-slate-100 pt-3 first:border-0 first:pt-0">
                    <p className="font-medium text-slate-800">{item.channelName} · {item.channelName === 'WhatsApp' && item.status === 'SENT' && !('providerAccepted' in item && item.providerAccepted) ? 'Enfileirado para envio' : notificationStatusLabel(item.status)}</p>
                    <p className="mt-1 text-xs text-slate-500">{new Date(item.createdAt).toLocaleString('pt-BR')}{item.channelName === 'E-mail' && 'recipientEmail' in item ? ` · ${item.recipientEmail}` : ''}</p>
                    {item.lastError && <p className="mt-1 text-xs text-red-700">{item.lastError}</p>}
                    {'providerEmailId' in item && item.providerEmailId ? <p className="mt-1 text-xs text-slate-500">Identificador do provedor: {item.providerEmailId}</p> : null}
                  </div>
                ))}
              </div>
            </section>}
          </div></div>
          <div className="space-y-6 lg:col-span-4 xl:col-span-3"><Card className="border-gray-200/70 shadow-sm ring-1 ring-gray-200/60"><CardHeader className="border-b border-gray-100 pb-3"><CardTitle className="text-base font-medium">Informações do Contrato</CardTitle></CardHeader><CardContent className="space-y-6 pt-6"><div className="space-y-4"><div><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Aluno</p><p className="mt-1 text-sm font-medium text-gray-900">{contrato.aluno.nome}</p></div><div className="grid grid-cols-2 gap-4"><div><p className="text-xs font-medium uppercase tracking-wide text-gray-500">CPF do Aluno</p><p className="mt-1 font-mono text-sm font-medium text-gray-900">{contrato.aluno.cpf || 'Não informado'}</p></div><div><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Status</p><div className="mt-1"><Badge status={contrato.status as StatusType} size="sm" /></div></div></div><div><p className="text-xs font-medium uppercase tracking-wide text-gray-500">Modelo Utilizado</p><p className="mt-1 text-sm font-medium text-gray-900">{contrato.modelo?.nome || 'Modelo Personalizado'}</p></div><div className="grid grid-cols-2 gap-4 border-t border-gray-100 pt-4"><div><p className="mb-1 text-xs font-medium text-gray-500">Criado em</p><p className="text-sm text-gray-700">{new Date(contrato.createdAt).toLocaleDateString()}</p><p className="text-xs text-gray-400">{new Date(contrato.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div>{contrato.tokenExpiraEm && <div><p className="mb-1 text-xs font-medium text-gray-500">Expira em</p><p className="text-sm text-gray-700">{new Date(contrato.tokenExpiraEm).toLocaleDateString()}</p><p className="text-xs text-gray-400">{new Date(contrato.tokenExpiraEm).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p></div>}</div></div>{contrato.status === 'PENDENTE' && <div className="rounded-lg border border-amber-100 bg-amber-50 p-4 text-sm"><p className="mb-1 flex items-center gap-2 font-semibold text-amber-800"><span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-75" /><span className="relative inline-flex h-2 w-2 rounded-full bg-amber-500" /></span>Aguardando Assinatura</p><p className="leading-relaxed text-amber-700/80">O link de assinatura está ativo e expira em <span className="font-medium text-amber-900">{contrato.tokenExpiraEm ? new Date(contrato.tokenExpiraEm).toLocaleDateString() : 'N/A'}</span>.</p></div>}</CardContent></Card></div>
        </div>
      </div>
      <ShareContractDialog open={shareOpen} onOpenChange={setShareOpen} tokenPublico={contrato.tokenPublico} alunoNome={contrato.aluno.nome} publicPath={isEvento ? '/p/evento-contrato' : '/p/contrato'} />
    </div>
  );
}
