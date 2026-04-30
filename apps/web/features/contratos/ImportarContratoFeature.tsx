'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeftIcon, DocumentArrowUpIcon, CheckCircleIcon } from '@heroicons/react/24/outline';
import { toast } from '@/components/ui/toast';
import { uploadContratoArquivo, createContratoModelo } from './services/modelos-service';
import { PDFViewer } from './components/PDFViewer';
import { cn } from '@/lib/utils';

export function ImportarContratoFeature() {
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<{
    url: string;
    hashSha256: string;
    size: number;
  } | null>(null);

  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [saving, setSaving] = useState(false);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    if (selectedFile.type !== 'application/pdf') {
      toast.error('Apenas arquivos PDF são permitidos');
      return;
    }

    if (selectedFile.size > 25 * 1024 * 1024) {
      toast.error('Arquivo muito grande. Máximo 25MB');
      return;
    }

    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setUploadResult(null);

    // Sugerir nome baseado no arquivo
    const suggestedName = selectedFile.name.replace(/\.pdf$/i, '').replace(/_/g, ' ');
    if (!nome) {
      setNome(suggestedName);
    }

    // Upload automático
    try {
      setUploading(true);
      setUploadProgress(0);

      const result = await uploadContratoArquivo(selectedFile, setUploadProgress);
      setUploadResult(result);
      toast.success('Arquivo enviado com sucesso');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao enviar arquivo';
      toast.error(message);
      setFile(null);
      setPreviewUrl(null);
    } finally {
      setUploading(false);
    }
  }, [nome]);

  const handleSave = useCallback(async () => {
    if (!uploadResult) {
      toast.error('Faça o upload do arquivo primeiro');
      return;
    }

    if (!nome.trim()) {
      toast.error('Informe o nome do modelo');
      return;
    }

    try {
      setSaving(true);

      await createContratoModelo({
        nome: nome.trim(),
        descricao: descricao.trim() || undefined,
        arquivoPdfUrl: uploadResult.url,
        hashSha256: uploadResult.hashSha256,
        tamanhoBytes: uploadResult.size,
      });

      toast.success('Modelo de contrato criado com sucesso');
      router.push('/contratos/modelos');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao salvar modelo';
      toast.error(message);
    } finally {
      setSaving(false);
    }
  }, [uploadResult, nome, descricao, router]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile) {
        const syntheticEvent = {
          target: { files: [droppedFile] },
        } as unknown as React.ChangeEvent<HTMLInputElement>;
        handleFileSelect(syntheticEvent);
      }
    },
    [handleFileSelect]
  );

  const handleDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  }, []);

  return (
    <div className="min-h-screen bg-gray-50/50 pb-20">
      {/* Header com estilo padrão */}
      <div className="sticky top-0 z-10 bg-white border-b shadow-sm">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => router.back()}
                className="-ml-2 text-gray-500 hover:text-gray-900"
              >
                <ArrowLeftIcon className="h-5 w-5" />
              </Button>
              <div className="flex flex-col">
                <h1 className="text-lg font-semibold text-gray-900 leading-tight">
                  Importar Novo Modelo
                </h1>
                <p className="text-sm text-gray-500">
                  Adicione um novo modelo de contrato ao sistema
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* Upload Section */}
          <div className="space-y-6">
            <Card className="overflow-hidden border-gray-200 shadow-sm">
              <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                    <DocumentArrowUpIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-medium">Arquivo do Contrato</CardTitle>
                    <CardDescription className="text-xs">
                      Selecione o arquivo PDF base para este modelo
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-6">
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  className={cn(
                    'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
                    uploading ? 'border-brand-accent bg-purple-50' :
                    uploadResult ? 'border-green-300 bg-green-50' : 
                    file ? 'border-blue-300 bg-blue-50' : 
                    'border-gray-300 hover:border-gray-400'
                  )}
                >
                  {uploading ? (
                    <div className="space-y-4 py-4">
                      <div className="relative">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-accent mx-auto" />
                      </div>
                      <div className="space-y-2">
                        <p className="font-medium text-gray-900 text-sm">Enviando arquivo...</p>
                        <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                          <div 
                            className="bg-brand-accent h-full rounded-full transition-all duration-300 ease-out" 
                            style={{ width: `${uploadProgress}%` }}
                          />
                        </div>
                        <p className="text-xs text-gray-500 tabular-nums">{uploadProgress}% concluído</p>
                      </div>
                    </div>
                  ) : uploadResult ? (
                    <div className="space-y-4 py-2">
                      <div className="bg-green-100 w-16 h-16 rounded-full flex items-center justify-center mx-auto mb-2">
                        <CheckCircleIcon className="h-8 w-8 text-green-600" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-900 truncate px-4" title={file?.name}>{file?.name}</p>
                        <p className="text-xs text-gray-500 mt-1">
                          {file ? (file.size / 1024 / 1024).toFixed(2) : 0} MB • PDF
                        </p>
                      </div>
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="outline"
                          size="sm"
                          className="text-xs h-8"
                          onClick={() => {
                            setFile(null);
                            setPreviewUrl(null);
                            setUploadResult(null);
                            setNome('');
                          }}
                        >
                          Substituir arquivo
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <label className="cursor-pointer">
                      <DocumentArrowUpIcon className="h-12 w-12 text-gray-400 mx-auto mb-4" />
                      <p className="text-gray-600 mb-2">
                        Arraste um arquivo PDF aqui
                      </p>
                      <p className="text-sm text-gray-400 mb-4">ou</p>
                      <Button variant="outline" asChild>
                        <span>Selecionar arquivo</span>
                      </Button>
                      <input
                        type="file"
                        accept=".pdf,application/pdf"
                        onChange={handleFileSelect}
                        className="hidden"
                      />
                    </label>
                  )}
                </div>

                {uploadResult && (
                  <div className="mt-4 p-4 bg-green-50 rounded-lg">
                    <div className="flex items-center gap-2 text-green-700">
                      <CheckCircleIcon className="h-5 w-5" />
                      <span className="font-medium">Arquivo pronto para salvar</span>
                    </div>
                    <p className="text-xs text-green-600 mt-1 font-mono truncate">
                      Hash: {uploadResult.hashSha256}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="border-gray-200 shadow-sm">
              <CardHeader className="bg-gray-50/50 border-b border-gray-100 pb-4">
                 <div className="flex items-center gap-3">
                  <div className="p-2 bg-gray-100 text-gray-600 rounded-lg">
                    <DocumentArrowUpIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-medium">Informações do Modelo</CardTitle>
                    <CardDescription className="text-xs">
                      Defina como este contrato será identificado no sistema
                    </CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-5 p-6">
                <div className="space-y-2">
                  <Label htmlFor="nome md:text-sm">Nome do Modelo <span className="text-red-500">*</span></Label>
                  <Input
                    id="nome"
                    value={nome}
                    onChange={(e) => setNome(e.target.value)}
                    placeholder="Ex: Contrato de Prestação de Serviços 2024"
                    maxLength={200}
                    disabled={saving}
                    className="h-10"
                  />
                  <p className="text-xs text-gray-500">
                    Este nome será exibido na lista de modelos e na gestão de matrículas.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="descricao">Descrição (opcional)</Label>
                  <Textarea
                    id="descricao"
                    value={descricao}
                    onChange={(e) => setDescricao(e.target.value)}
                    placeholder="Detalhes sobre a finalidade deste contrato, público alvo, etc."
                    rows={4}
                    maxLength={500}
                    disabled={saving}
                    className="resize-none"
                  />
                </div>

                <div className="pt-4 border-t border-gray-100 flex justify-end">
                   <Button
                    onClick={handleSave}
                    disabled={!uploadResult || !nome.trim() || saving}
                    className="w-full sm:w-auto min-w-[140px]"
                  >
                    {saving ? (
                      <>
                        <span className="animate-spin mr-2 h-4 w-4 border-b-2 border-white rounded-full inline-block" />
                        Salvando...
                      </>
                    ) : (
                      'Criar Modelo'
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Informações técnicas discretas */}
            {uploadResult && (
               <div className="px-1 text-center">
                <p className="text-[10px] text-gray-300 font-mono inline-flex items-center gap-1">
                  <CheckCircleIcon className="h-3 w-3" />
                  Integridade verificada (SHA-256)
                </p>
              </div>
            )}
          </div>

          {/* Preview Section */}
          <div className="hidden lg:block relative">
             {/* Sticky só funciona se o pai tiver altura, mas aqui estamos em grid */}
             <div className="sticky top-24 space-y-4">
              <div className="bg-white p-1 rounded-xl border shadow-sm">
                <div className="bg-gray-50 rounded-lg p-4 text-center border-b border-gray-100 mb-0">
                  <h3 className="text-sm font-medium text-gray-900">Prévia do Documento</h3>
                  <p className="text-xs text-gray-500">O que será exibido para assinatura</p>
                </div>
                 <div className="bg-gray-100 min-h-[400px] rounded-b-lg overflow-hidden flex flex-col items-center justify-center">
                  {previewUrl ? (
                    <PDFViewer
                      url={previewUrl}
                      showDownload={false}
                      className="w-full h-full"
                      maxHeight="600px"
                    />
                  ) : (
                    <div className="text-center p-8">
                       <DocumentArrowUpIcon className="h-16 w-16 text-gray-300 mx-auto mb-3" />
                       <p className="text-gray-400 text-sm">Nenhum arquivo selecionado</p>
                    </div>
                  )}
                 </div>
              </div>
              
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-4">
                  <h4 className="text-blue-800 text-sm font-medium mb-1">Dica Importante</h4>
                  <p className="text-blue-600 text-xs leading-relaxed">
                    Certifique-se de que o PDF contém todos os campos necessários preenchidos ou placeholders claros. O sistema não preenche campos automaticamente dentro do PDF.
                  </p>
              </div>
             </div>
          </div>

        </div>
      </div>
    </div>
  );
}
