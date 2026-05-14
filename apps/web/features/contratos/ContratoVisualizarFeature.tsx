'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  ArrowLeftIcon,
  ArrowDownTrayIcon,
  ShareIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/components/ui/toast';
import { getContrato, type Contrato } from './services/modelos-service';
import { PDFViewer } from './components/PDFViewer';
import { Badge, type StatusType } from '@/components/ui/badge';
import { CompartilharContratoDialog } from './components/CompartilharContratoDialog';

interface ContratoVisualizarFeatureProps {
  contratoId: string;
}

export function ContratoVisualizarFeature({ contratoId }: ContratoVisualizarFeatureProps) {
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

  const handleDownload = useCallback(() => {
    if (!contrato) return;
    const link = document.createElement('a');
    link.href = contrato.arquivoPdfUrl;
    link.download = `Contrato-${contrato.matricula.aluno.nome}.pdf`;
    link.click();
  }, [contrato]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-accent"></div>
      </div>
    );
  }

  if (!contrato) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Contrato não encontrado</p>
          <Button onClick={() => router.push('/contratos')}>
            Voltar para contratos
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4">
        <div className="flex w-full min-w-0 items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeftIcon className="h-5 w-5" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-gray-900">
                  Contrato - {contrato.matricula.aluno.nome}
                </h1>
                <Badge status={contrato.status as StatusType} size="sm" />
              </div>
              {contrato.modelo && (
                <p className="text-sm text-gray-500">
                  Modelo: {contrato.modelo.nome}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {contrato.status === 'PENDENTE' && (
              <Button variant="outline" onClick={() => setShareOpen(true)}>
                <ShareIcon className="h-4 w-4 mr-2" />
                Compartilhar
              </Button>
            )}
            <Button onClick={handleDownload}>
              <ArrowDownTrayIcon className="h-4 w-4 mr-2" />
              Baixar PDF
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="w-full min-w-0 px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* PDF Viewer */}
          <div className="lg:col-span-2">
            <Card>
              <CardContent className="p-0">
                <PDFViewer
                  url={contrato.arquivoPdfUrl}
                  title={`Contrato-${contrato.matricula.aluno.nome}`}
                  maxHeight="75vh"
                />
              </CardContent>
            </Card>
          </div>

          {/* Info Panel */}
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Informações</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="text-sm font-medium text-gray-500">Aluno</p>
                  <p className="text-gray-900">{contrato.matricula.aluno.nome}</p>
                </div>
                {contrato.matricula.aluno.cpf && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">CPF</p>
                    <p className="text-gray-900">{contrato.matricula.aluno.cpf}</p>
                  </div>
                )}
                {contrato.matricula.turma && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Turma</p>
                    <p className="text-gray-900">{contrato.matricula.turma.nome}</p>
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-gray-500">Criado em</p>
                  <p className="text-gray-900">
                    {new Date(contrato.createdAt).toLocaleDateString('pt-BR', {
                      day: '2-digit',
                      month: 'long',
                      year: 'numeric',
                    })}
                  </p>
                </div>
                {contrato.tokenExpiraEm && contrato.status === 'PENDENTE' && (
                  <div>
                    <p className="text-sm font-medium text-gray-500">Expira em</p>
                    <p className="text-gray-900">
                      {new Date(contrato.tokenExpiraEm).toLocaleDateString('pt-BR')}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {contrato.status === 'ASSINADO' && (
              <Card>
                <CardHeader>
                  <CardTitle>Assinatura</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-sm font-medium text-gray-500">Assinado por</p>
                    <p className="text-gray-900">{contrato.assinadoPor}</p>
                  </div>
                  {contrato.assinadoCpf && (
                    <div>
                      <p className="text-sm font-medium text-gray-500">CPF</p>
                      <p className="text-gray-900">{contrato.assinadoCpf}</p>
                    </div>
                  )}
                  {contrato.assinadoEm && (
                    <div>
                      <p className="text-sm font-medium text-gray-500">Data/Hora</p>
                      <p className="text-gray-900">
                        {new Date(contrato.assinadoEm).toLocaleString('pt-BR')}
                      </p>
                    </div>
                  )}
                  {contrato.assinadoIp && (
                    <div>
                      <p className="text-sm font-medium text-gray-500">IP</p>
                      <p className="text-gray-900 font-mono text-sm">{contrato.assinadoIp}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            <Card>
              <CardHeader>
                <CardTitle>Integridade</CardTitle>
              </CardHeader>
              <CardContent>
                <div>
                  <p className="text-sm font-medium text-gray-500 mb-1">Hash do PDF</p>
                  <code className="text-xs text-gray-600 break-all font-mono bg-gray-100 p-2 rounded block">
                    {contrato.hashPdf}
                  </code>
                </div>
                {contrato.hashAssinatura && (
                  <div className="mt-4">
                    <p className="text-sm font-medium text-gray-500 mb-1">Hash da Assinatura</p>
                    <code className="text-xs text-gray-600 break-all font-mono bg-gray-100 p-2 rounded block">
                      {contrato.hashAssinatura}
                    </code>
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
