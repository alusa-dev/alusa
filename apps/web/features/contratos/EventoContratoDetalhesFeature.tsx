'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Eye, Share2 } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Badge, type StatusType } from '@/components/ui/badge';
import { toast } from '@/components/ui/toast';
import { CompartilharContratoDialog } from './components/CompartilharContratoDialog';
import { PDFViewer } from './components/PDFViewer';

type EventContract = {
  id: string;
  status: string;
  modelo: { nome: string } | null;
  aluno: { nome: string; cpf: string | null } | null;
  responsavel: { nome: string; cpf: string } | null;
  evento: { name: string; startsAt: string } | null;
  arquivoPdfUrl: string;
  arquivoPdfAssinadoUrl: string | null;
  tokenPublico: string;
};

export function EventoContratoDetalhesFeature({ contratoId }: { contratoId: string }) {
  const router = useRouter();
  const [contract, setContract] = useState<EventContract | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharing, setSharing] = useState(false);

  useEffect(() => {
    fetch(`/api/event-contracts/${contratoId}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error?.message ?? 'Contrato não encontrado');
        return body.data as EventContract;
      })
      .then(setContract)
      .catch((error) => toast.error((error as Error).message))
      .finally(() => setLoading(false));
  }, [contratoId]);

  async function share() {
    if (!contract || sharing) return;
    try {
      setSharing(true);
      const response = await fetch(`/api/event-contracts/${contract.id}/regenerar`, { method: 'PATCH' });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message ?? 'Não foi possível gerar o link');
      setContract(body.data);
      setShareOpen(true);
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setSharing(false);
    }
  }

  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-b-2 border-brand-accent" /></div>;
  if (!contract) return <div className="flex min-h-screen items-center justify-center"><Button onClick={() => router.back()}>Voltar</Button></div>;

  const pdfUrl = contract.arquivoPdfAssinadoUrl || contract.arquivoPdfUrl;
  return (
    <div className="min-h-screen bg-white px-6 py-5">
      <div className="mx-auto max-w-6xl">
        <Button variant="ghost" onClick={() => router.back()}><ArrowLeft className="mr-2 h-4 w-4" /> Voltar</Button>
        <div className="mt-4 flex flex-col justify-between gap-4 border-b pb-5 sm:flex-row sm:items-center">
          <div>
            <div className="flex items-center gap-3"><h1 className="text-xl font-semibold text-gray-900">{contract.modelo?.nome ?? 'Contrato do evento'}</h1><Badge status={contract.status as StatusType} size="sm" /></div>
            <p className="mt-1 text-sm text-gray-500">{contract.aluno?.nome} · {contract.evento?.name}</p>
            {contract.responsavel && <p className="text-xs text-gray-500">Responsável: {contract.responsavel.nome}</p>}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => void share()} disabled={sharing || contract.status === 'ASSINADO'}><Share2 className="mr-2 h-4 w-4" />{sharing ? 'Gerando...' : 'Compartilhar'}</Button>
            <Button variant="outline" onClick={() => window.open(pdfUrl, '_blank', 'noopener,noreferrer')}><Eye className="mr-2 h-4 w-4" />Visualizar PDF</Button>
          </div>
        </div>
        <div className="mt-6"><PDFViewer url={pdfUrl} title={`Contrato do evento - ${contract.aluno?.nome ?? 'Aluno'}`} className="w-full" maxHeight="82vh" showDownload /></div>
      </div>
      <CompartilharContratoDialog open={shareOpen} onOpenChange={setShareOpen} tokenPublico={contract.tokenPublico} alunoNome={contract.aluno?.nome ?? 'Aluno'} publicPath="/p/evento-contrato" />
    </div>
  );
}
