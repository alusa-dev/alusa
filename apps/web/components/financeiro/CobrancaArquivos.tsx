'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ArrowUpTrayIcon, DocumentIcon, TrashIcon } from '@heroicons/react/24/outline';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';

interface ArquivoCobranca {
  id: string;
  nomeOriginal: string;
  nomeArquivo: string;
  mimetype: string;
  tamanho: number;
  url: string;
  createdAt: string;
}

interface CobrancaArquivosProps {
  cobrancaId: string;
  sectionClassName?: string;
}

export function CobrancaArquivos({ cobrancaId, sectionClassName }: CobrancaArquivosProps) {
  const [arquivos, setArquivos] = useState<ArquivoCobranca[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Carregar arquivos ao montar o componente
  const loadArquivos = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/cobrancas/${cobrancaId}/arquivos`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao carregar arquivos');
      }
      const data = await res.json();
      setArquivos(data.arquivos || []);
    } catch (error) {
      console.error('Error loading arquivos:', error);
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao carregar arquivos"
          description={error instanceof Error ? error.message : 'Erro desconhecido'}
          onClose={() => {
            toast.dismiss(t);
          }}
        />
      ));
    } finally {
      setLoading(false);
    }
  }, [cobrancaId]);

  // Carregar arquivos na montagem
  useEffect(() => {
    loadArquivos();
  }, [loadArquivos]);

  // Upload de arquivo
  const handleUpload = async (file: File) => {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch(`/api/cobrancas/${cobrancaId}/arquivos`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao fazer upload');
      }

      const data = await res.json();
      setArquivos((prev) => [data.arquivo, ...prev]);

      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Arquivo enviado"
          description={`${file.name} foi enviado com sucesso`}
          onClose={() => {
            toast.dismiss(t);
          }}
        />
      ));
    } catch (error) {
      console.error('Error uploading file:', error);
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro no upload"
          description={error instanceof Error ? error.message : 'Erro desconhecido'}
          onClose={() => {
            toast.dismiss(t);
          }}
        />
      ));
    } finally {
      setUploading(false);
    }
  };

  // Remover arquivo
  const handleDelete = async (arquivoId: string, nomeOriginal: string) => {
    if (!confirm(`Deseja realmente remover o arquivo "${nomeOriginal}"?`)) {
      return;
    }

    try {
      const res = await fetch(`/api/cobrancas/${cobrancaId}/arquivos?arquivoId=${arquivoId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Erro ao remover arquivo');
      }

      setArquivos((prev) => prev.filter((a) => a.id !== arquivoId));

      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Arquivo removido"
          description={`${nomeOriginal} foi removido`}
          onClose={() => {
            toast.dismiss(t);
          }}
        />
      ));
    } catch (error) {
      console.error('Error deleting file:', error);
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao remover"
          description={error instanceof Error ? error.message : 'Erro desconhecido'}
          onClose={() => {
            toast.dismiss(t);
          }}
        />
      ));
    }
  };

  // Handlers de drag and drop
  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDragActive(false);

      if (e.dataTransfer.files && e.dataTransfer.files[0]) {
        void handleUpload(e.dataTransfer.files[0]);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      handleUpload(e.target.files[0]);
    }
  };

  const onButtonClick = () => {
    inputRef.current?.click();
  };

  // Formatar tamanho do arquivo
  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Formatar data
  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const sectionClass =
    sectionClassName ??
    cn(
      'space-y-4 rounded-xl border border-slate-200 bg-slate-50 px-5 py-4',
      'mx-auto w-full max-w-4xl',
    );

  if (loading) {
    return (
      <section className={sectionClass}>
        <div className="mb-4">
          <span className="text-sm font-semibold text-slate-700">Arquivos e Documentos</span>
          <p className="mt-1 text-sm text-slate-600">Carregando arquivos anexados...</p>
        </div>
        <div className="flex items-center justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
        </div>
      </section>
    );
  }

  return (
    <section className={sectionClass}>
      <div className="mb-4">
        <span className="text-sm font-semibold text-slate-700">Arquivos e Documentos</span>
        <p className="mt-1 text-sm text-slate-600">
          Adicione recibos, comprovantes ou documentos relacionados à cobrança
        </p>
      </div>

      <div className="space-y-6">
        {/* Área de upload drag-and-drop */}
        <div
          className={`
            relative border-2 border-dashed rounded-xl p-10 text-center transition-all duration-200
            ${dragActive ? 'border-indigo-500 bg-indigo-50 scale-[1.02]' : 'border-gray-300 bg-gray-50'}
            ${uploading ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer hover:border-indigo-400 hover:bg-indigo-50/50'}
          `}
          onDragEnter={handleDrag}
          onDragLeave={handleDrag}
          onDragOver={handleDrag}
          onDrop={handleDrop}
          onClick={uploading ? undefined : onButtonClick}
        >
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={handleChange}
            disabled={uploading}
            accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx"
          />

          <div className="flex flex-col items-center">
            <div
              className={`flex items-center justify-center w-16 h-16 mb-4 rounded-full transition-colors duration-200 ${
                dragActive ? 'bg-indigo-100' : 'bg-gray-100'
              }`}
            >
              <ArrowUpTrayIcon
                className={`h-8 w-8 transition-colors duration-200 ${
                  dragActive ? 'text-indigo-600' : 'text-gray-400'
                }`}
              />
            </div>

            {uploading ? (
              <div className="space-y-2">
                <p className="text-base font-medium text-gray-900">Enviando arquivo...</p>
                <div className="w-48 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-indigo-600 rounded-full animate-pulse"></div>
                </div>
              </div>
            ) : (
              <>
                <p className="text-base font-medium text-gray-900 mb-1">
                  <span className="font-semibold text-indigo-600">Clique para selecionar</span> ou
                  arraste o arquivo
                </p>
                <p className="text-sm text-gray-600">
                  Formatos aceitos: PDF, JPG, PNG, DOC, DOCX, XLS, XLSX
                </p>
                <p className="mt-1 text-xs text-gray-500">Tamanho máximo: 10MB</p>
              </>
            )}
          </div>
        </div>

        {/* Lista de arquivos */}
        {arquivos.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-gray-700">
                {arquivos.length} {arquivos.length === 1 ? 'arquivo anexado' : 'arquivos anexados'}
              </p>
            </div>

            <div className="space-y-2.5">
              {arquivos.map((arquivo) => (
                <div
                  key={arquivo.id}
                  className="group flex items-center justify-between p-4 bg-gray-50 border border-gray-200 rounded-xl hover:bg-gray-100 hover:border-gray-300 transition-all duration-200"
                >
                  <div className="flex items-center gap-4 flex-1 min-w-0">
                    <div className="flex items-center justify-center w-12 h-12 bg-white border border-gray-200 rounded-lg flex-shrink-0 group-hover:border-gray-300 transition-colors">
                      <DocumentIcon className="h-6 w-6 text-indigo-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate leading-relaxed">
                        {arquivo.nomeOriginal}
                      </p>
                      <p className="mt-1 text-xs text-gray-600 flex items-center gap-1.5">
                        <span className="font-medium">{formatSize(arquivo.tamanho)}</span>
                        <span className="text-gray-400">•</span>
                        <span>{formatDate(arquivo.createdAt)}</span>
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-shrink-0 ml-4">
                    <a
                      href={arquivo.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center px-3.5 py-2 text-sm font-medium text-indigo-700 bg-indigo-50 rounded-lg hover:bg-indigo-100 transition-colors"
                    >
                      Abrir
                    </a>
                    <button
                      type="button"
                      onClick={() => handleDelete(arquivo.id, arquivo.nomeOriginal)}
                      className="inline-flex items-center justify-center w-9 h-9 text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg transition-colors"
                      title="Remover arquivo"
                    >
                      <TrashIcon className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-6">
            <div className="flex items-center justify-center w-12 h-12 mb-3 bg-gray-100 rounded-full">
              <DocumentIcon className="h-6 w-6 text-gray-400" />
            </div>
            <p className="text-sm font-medium text-gray-900">Nenhum arquivo anexado</p>
            <p className="mt-1 text-xs text-gray-600">
              Faça upload de documentos relacionados à cobrança
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
