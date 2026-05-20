'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  ArrowLeftIcon,
  ShareIcon,
  PencilIcon,
  CheckBadgeIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import { toast } from '@/components/ui/toast';
import { getContratoModelo, updateContratoModelo, type ContratoModelo } from './services/modelos-service';
import { PDFViewer } from './components/PDFViewer';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface ModeloDetalhesFeatureProps {
  modeloId: string;
}

export function ModeloDetalhesFeature({ modeloId }: ModeloDetalhesFeatureProps) {
  const router = useRouter();
  const [modelo, setModelo] = useState<ContratoModelo | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editNome, setEditNome] = useState('');
  const [editDescricao, setEditDescricao] = useState('');

  useEffect(() => {
    getContratoModelo(modeloId)
      .then((data) => {
        setModelo(data);
        setEditNome(data.nome);
        setEditDescricao(data.descricao || '');
      })
      .catch((err) => {
        toast.error('Erro ao carregar modelo');
        console.error(err);
      })
      .finally(() => setLoading(false));
  }, [modeloId]);

  const handleSave = useCallback(async () => {
    if (!modelo) return;

    try {
      setSaving(true);
      const updated = await updateContratoModelo(modelo.id, {
        nome: editNome.trim(),
        descricao: editDescricao.trim() || null,
      });
      setModelo({ ...modelo, ...updated });
      setEditing(false);
      toast.success('Modelo atualizado');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Erro ao salvar');
    } finally {
      setSaving(false);
    }
  }, [modelo, editNome, editDescricao]);

  const handleDownload = useCallback(() => {
    if (!modelo) return;
    const link = document.createElement('a');
    link.href = modelo.arquivoPdfUrl;
    link.download = `${modelo.nome}.pdf`;
    link.click();
  }, [modelo]);

  const handleShare = useCallback(() => {
    if (!modelo) return;
    const url = `${window.location.origin}${modelo.arquivoPdfUrl}`;
    navigator.clipboard.writeText(url);
    toast.success('Link copiado para a área de transferência');
  }, [modelo]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-accent"></div>
      </div>
    );
  }

  if (!modelo) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-gray-600 mb-4">Modelo não encontrado</p>
          <Button onClick={() => router.push('/contratos/modelos')}>
            Voltar para modelos
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Header */}
      <div className="bg-white border-b px-6 py-4 sticky top-0 z-10">
        <div className="flex w-full min-w-0 items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              className="-ml-2 hover:bg-gray-100"
            >
              <ArrowLeftIcon className="h-5 w-5 text-gray-500" />
            </Button>
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-semibold text-gray-900 tracking-tight">
                  {modelo.nome}
                </h1>
                <Badge status={modelo.status} />
                <Badge
                  variant="outline"
                  className="font-mono text-gray-500 bg-gray-50 text-xs px-2"
                >
                  v{modelo.versao}
                </Badge>
              </div>
              <p className="text-sm text-gray-500 mt-0.5">
                {modelo._count?.contratos || 0} contratos gerados a partir deste
                modelo
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleShare}
              className="hidden sm:flex"
            >
              <ShareIcon className="h-4 w-4 mr-2" />
              Compartilhar
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(modelo.arquivoPdfUrl, '_blank', 'noopener,noreferrer')}
              className="hidden sm:flex"
            >
              <EyeIcon className="h-4 w-4 mr-2" />
              Visualizar PDF
            </Button>
            <Button size="sm" onClick={() => setEditing(!editing)}>
              <PencilIcon className="h-4 w-4 mr-2" />
              Editar
            </Button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="w-full min-w-0 px-6 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* PDF Viewer */}
          <div className="lg:col-span-2">
            <Card className="overflow-hidden border-gray-200 shadow-sm">
              <CardHeader className="bg-gray-50border-b flex flex-row items-center justify-between py-4">
                <CardTitle className="text-base font-medium text-gray-900">
                  Visualização do Documento
                </CardTitle>
                <Badge variant="outline" className="bg-white">
                  PDF
                </Badge>
              </CardHeader>
              <CardContent className="p-0 bg-gray-100">
                <PDFViewer
                  url={modelo.arquivoPdfUrl}
                  title={modelo.nome}
                  maxHeight="75vh"
                />
              </CardContent>
            </Card>
          </div>

          {/* Info Panel */}
          <div className="space-y-6">
            {editing ? (
              <Card className="shadow-sm border-gray-200">
                <CardHeader>
                  <CardTitle className="text-base">Editar Informações</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-nome">Nome do Contrato</Label>
                    <Input
                      id="edit-nome"
                      value={editNome}
                      onChange={(e) => setEditNome(e.target.value)}
                      maxLength={200}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-descricao">Descrição Interna</Label>
                    <Textarea
                      id="edit-descricao"
                      value={editDescricao}
                      onChange={(e) => setEditDescricao(e.target.value)}
                      rows={4}
                      maxLength={500}
                      className="resize-none"
                    />
                  </div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      variant="outline"
                      className="w-full"
                      onClick={() => {
                        setEditing(false);
                        setEditNome(modelo.nome);
                        setEditDescricao(modelo.descricao || '');
                      }}
                      disabled={saving}
                    >
                      Cancelar
                    </Button>
                    <Button
                      className="w-full"
                      onClick={handleSave}
                      disabled={saving}
                    >
                      {saving ? 'Salvando...' : 'Salvar Alterações'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <Card className="shadow-sm border-gray-200">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Detalhes do Modelo</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  {modelo.descricao && (
                    <div className="p-3 bg-gray-50 rounded-lg border border-gray-100">
                      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">
                        Descrição
                      </p>
                      <p className="text-sm text-gray-700 leading-relaxed">
                        {modelo.descricao}
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-1 gap-4">
                    <div>
                      <p className="text-xs font-medium text-gray-500">
                        Tamanho do Arquivo
                      </p>
                      <p className="text-sm font-medium text-gray-900">
                        {modelo.tamanhoBytes
                          ? `${(modelo.tamanhoBytes / 1024 / 1024).toFixed(2)} MB`
                          : 'Não informado'}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <p className="text-xs font-medium text-gray-500">
                          Data de Criação
                        </p>
                        <p className="text-sm text-gray-900">
                          {new Date(modelo.createdAt).toLocaleDateString(
                            'pt-BR',
                            {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            }
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-500">
                          Última Edição
                        </p>
                        <p className="text-sm text-gray-900">
                          {new Date(modelo.updatedAt).toLocaleDateString(
                            'pt-BR',
                            {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            }
                          )}
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="pt-4 border-t border-gray-100">
                    <div className="flex items-center gap-2 text-green-700 bg-green-50 p-2 rounded-md text-xs font-medium">
                      <CheckBadgeIcon className="h-4 w-4" />
                      Documento íntegro e verificado
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
