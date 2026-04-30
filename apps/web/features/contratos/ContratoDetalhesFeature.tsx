'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeftIcon, ArrowDownTrayIcon, ShareIcon } from '@heroicons/react/24/outline';
import { getContrato, createContrato, type Contrato } from './services/contratos-service';
import { Badge, type StatusType } from '@/components/ui/badge';
import { CompartilharContratoDialog } from './components/CompartilharContratoDialog';
import { PDFViewer } from './components/PDFViewer';
import { toast } from '@/components/ui/toast';
import { EyeIcon } from '@heroicons/react/24/outline';

interface ContratoDetalhesFeatureProps {
  contratoId: string;
}

export function ContratoDetalhesFeature({ contratoId }: ContratoDetalhesFeatureProps) {
  const router = useRouter();
  const [contrato, setContrato] = useState<Contrato | null>(null);
  const [loading, setLoading] = useState(true);
  const [shareOpen, setShareOpen] = useState(false);

  useEffect(() => {
    getContrato(contratoId)
      .then(setContrato)
      .catch((err) => {
        toast.error('Erro ao carregar contrato');
        console.error(err);
      })
      .finally(() => setLoading(false));
  }, [contratoId]);

  const handleGerarAditivo = async () => {
    if (!contrato?.modeloId) {
      toast.error('Modelo do contrato não identificado');
      return;
    }
    try {
      const novo = await createContrato({
        matriculaId: contrato.matriculaId,
        modeloId: contrato.modeloId,
        contratoOrigemId: contrato.id,
      });
      setContrato(novo);
      toast.success('Aditivo gerado. Envie o novo link para assinatura.');
      setShareOpen(true);
    } catch (error) {
      toast.error((error as Error).message);
    }
  };

  const handleDownload = () => {
    if (!contrato?.arquivoPdfUrl) return;
    const link = document.createElement('a');
    link.href = contrato.arquivoPdfUrl;
    link.download = `Contrato-${contrato.matricula.aluno.nome}.pdf`;
    link.click();
  };

  const handleViewPdf = () => {
    if (!contrato?.arquivoPdfUrl) return;
    window.open(contrato.arquivoPdfUrl, '_blank');
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-accent"></div>
      </div>
    );
  }

  if (!contrato) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Contrato não encontrado</p>
          <Button onClick={() => router.back()}>Voltar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-gray-50 to-white">
      <div className="bg-white/90 backdrop-blur border-b px-6 py-5 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto flex flex-col gap-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={() => router.back()}
                className="-ml-2 hover:bg-gray-100"
                title="Voltar"
              >
                <ArrowLeftIcon className="h-5 w-5 text-gray-500" />
              </Button>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-semibold text-gray-900 tracking-tight">
                    Detalhes do Contrato
                  </h1>
                  <Badge status={contrato.status as StatusType} size="sm" />
                </div>
                <p className="text-sm text-gray-500 mt-0.5">
                  Contrato #{contrato.id.slice(0, 8)} •{' '}
                  {contrato.matricula?.aluno?.nome ?? 'Aluno indisponível'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {(contrato.status === 'PENDENTE' ||
                contrato.status === 'EXPIRADO') && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShareOpen(true)}
                >
                  <ShareIcon className="h-4 w-4 mr-2" />
                  Compartilhar Link
                </Button>
              )}

              {contrato.status === 'ASSINADO' && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGerarAditivo}
                >
                  Gerar aditivo
                </Button>
              )}

              <Button variant="outline" size="sm" onClick={handleViewPdf}>
                <EyeIcon className="h-4 w-4 mr-2" />
                Visualizar PDF
              </Button>

              <Button size="sm" onClick={handleDownload} className="shadow-none">
                <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
                Baixar
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8">
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-12">
          <div className="lg:col-span-8 xl:col-span-9">
            <Card className="flex flex-col overflow-hidden border-gray-200/70 shadow-sm ring-1 ring-gray-200/60">
              <CardHeader className="bg-gray-50 border-b py-4 flex flex-row items-center justify-between">
                <CardTitle className="text-base font-medium text-gray-900">
                  Visualização do Documento
                </CardTitle>
                <Badge variant="outline" className="bg-white text-xs">
                  PDF
                </Badge>
              </CardHeader>
              <CardContent className="bg-white p-0">
                {contrato.arquivoPdfUrl ? (
                  <PDFViewer
                    url={contrato.arquivoPdfUrl}
                    title={`Contrato - ${contrato.matricula.aluno.nome}`}
                    className="flex-1"
                    maxHeight="82vh"
                    showDownload={false}
                  />
                ) : (
                  <div className="flex items-center justify-center h-[32rem] text-gray-400 font-medium">
                    PDF não disponível
                  </div>
                )}
              </CardContent>

              {contrato.status === 'ASSINADO' && (
                <div className="border-t border-gray-200 bg-emerald-50/60 px-6 py-4">
                  <div className="flex items-start gap-3">
                    <div className="p-2 bg-emerald-100 rounded-lg text-emerald-700 mt-1">
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className="w-5 h-5"
                      >
                        <path
                          fillRule="evenodd"
                          d="M16.403 12.652a3 3 0 000-5.304 3 3 0 00-3.75-3.651 5 5 0 00-5.305 0 3 3 0 00-3.751 3.651 3 3 0 000 5.305 5 5 0 005.305 0 3 3 0 003.751 3.651zM10 8a2 2 0 100-4 2 2 0 000 4z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-emerald-900 mb-1">
                        Assinatura Eletrônica Registrada
                      </p>
                      <div className="space-y-1 text-sm text-emerald-800">
                        <p>
                          <span className="font-medium">Assinado por:</span>{' '}
                          {contrato.assinadoPor}
                        </p>
                        <p>
                          <span className="font-medium">CPF:</span>{' '}
                          {contrato.assinadoCpf}
                        </p>
                        <p>
                          <span className="font-medium">Data:</span>{' '}
                          {contrato.assinadoEm
                            ? new Date(contrato.assinadoEm).toLocaleString()
                            : 'N/A'}
                        </p>
                        <p className="text-xs text-emerald-700/80 mt-2 break-all font-mono bg-emerald-100/50 p-1.5 rounded">
                          Hash: {contrato.hashAssinatura}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </Card>
          </div>

          <div className="space-y-6 lg:col-span-4 xl:col-span-3">
            <Card className="shadow-sm border-gray-200/70 ring-1 ring-gray-200/60">
              <CardHeader className="pb-3 border-b border-gray-100">
                <CardTitle className="text-base font-medium">Informações do Contrato</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6 pt-6">
                <div className="space-y-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Aluno
                    </p>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {contrato.matricula.aluno.nome}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        CPF do Aluno
                      </p>
                      <p className="text-sm font-medium text-gray-900 mt-1 font-mono">
                        {contrato.matricula.aluno.cpf || 'Não informado'}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                        Status
                      </p>
                      <div className="mt-1">
                        <Badge status={contrato.status as StatusType} size="sm" />
                      </div>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
                      Modelo Utilizado
                    </p>
                    <p className="text-sm font-medium text-gray-900 mt-1">
                      {contrato.modelo?.nome || 'Modelo Personalizado'}
                    </p>
                  </div>

                  <div className="pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-gray-500 mb-1">
                        Criado em
                      </p>
                      <p className="text-sm text-gray-700">
                        {new Date(contrato.createdAt).toLocaleDateString()}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(contrato.createdAt).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                      </p>
                    </div>
                    {contrato.tokenExpiraEm && (
                      <div>
                        <p className="text-xs font-medium text-gray-500 mb-1">
                          Expira em
                        </p>
                        <p className="text-sm text-gray-700">
                          {new Date(contrato.tokenExpiraEm).toLocaleDateString()}
                        </p>
                        <p className="text-xs text-gray-400">
                          {new Date(contrato.tokenExpiraEm).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                {contrato.status === 'PENDENTE' && (
                  <div className="bg-amber-50 rounded-lg p-4 border border-amber-100 text-sm">
                    <p className="font-semibold text-amber-800 mb-1 flex items-center gap-2">
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                      </span>
                      Aguardando Assinatura
                    </p>
                    <p className="text-amber-700/80 leading-relaxed">
                      O link de assinatura está ativo e expira em{' '}
                      <span className="font-medium text-amber-900">
                        {contrato.tokenExpiraEm
                          ? new Date(contrato.tokenExpiraEm).toLocaleDateString()
                          : 'N/A'}
                      </span>
                      .
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      <CompartilharContratoDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        tokenPublico={contrato.tokenPublico}
        alunoNome={contrato.matricula.aluno.nome}
      />
    </div>
  );
}
