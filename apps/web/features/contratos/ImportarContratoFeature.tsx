'use client';

import { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, DocumentText } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { InfoCallout } from '@/components/ui/info-callout';
import { toast } from '@/components/ui/toast';
import { cn } from '@/lib/utils';
import { PDFViewer } from './components/PDFViewer';
import { PDFSignatureEditor, type SignatureField } from './components/PDFSignatureEditor';
import { uploadContratoArquivo, createContratoModelo } from './services/modelos-service';

type Step = 1 | 2 | 3;

export function ImportarContratoFeature() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadResult, setUploadResult] = useState<{ url: string; hashSha256: string; size: number } | null>(null);
  const [nome, setNome] = useState('');
  const [descricao, setDescricao] = useState('');
  const [fields, setFields] = useState<SignatureField[]>([]);
  const [saving, setSaving] = useState(false);

  const selectFile = useCallback(async (selectedFile: File) => {
    if (selectedFile.type !== 'application/pdf') return toast.error('Apenas arquivos PDF são permitidos.');
    if (selectedFile.size > 25 * 1024 * 1024) return toast.error('Arquivo muito grande. Máximo 25MB.');
    setFile(selectedFile);
    setPreviewUrl(URL.createObjectURL(selectedFile));
    setUploadResult(null);
    if (!nome) setNome(selectedFile.name.replace(/\.pdf$/i, '').replace(/[_-]+/g, ' '));
    try {
      setUploading(true);
      const result = await uploadContratoArquivo(selectedFile, setUploadProgress);
      setUploadResult(result);
      toast.success('Documento enviado. Continue para configurar as assinaturas.');
    } catch (error) {
      setFile(null); setPreviewUrl(null);
      toast.error(error instanceof Error ? error.message : 'Erro ao enviar documento.');
    } finally { setUploading(false); }
  }, [nome]);

  const canContinueBasic = Boolean(uploadResult && nome.trim() && !uploading);
  const hasRequiredFields = fields.some((field) => field.papel === 'ESCOLA' && field.obrigatorio) && fields.some((field) => field.papel === 'RESPONSAVEL_OU_ALUNO' && field.obrigatorio);
  const fieldSummary = useMemo(() => fields.map((field) => field.papel === 'ESCOLA' ? 'Escola · assinatura automática' : 'Responsável / aluno · definido na matrícula'), [fields]);

  const finish = useCallback(async () => {
    if (!uploadResult || !nome.trim() || !hasRequiredFields) return;
    try {
      setSaving(true);
      await createContratoModelo({ nome: nome.trim(), descricao: descricao.trim() || undefined, arquivoPdfUrl: uploadResult.url, hashSha256: uploadResult.hashSha256, tamanhoBytes: uploadResult.size, campos: fields });
      toast.success('Modelo de contrato criado com sucesso.');
      router.push('/contratos/modelos');
    } catch (error) { toast.error(error instanceof Error ? error.message : 'Erro ao salvar modelo.'); }
    finally { setSaving(false); }
  }, [descricao, fields, hasRequiredFields, nome, router, uploadResult]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>) => { event.preventDefault(); const dropped = event.dataTransfer.files[0]; if (dropped) void selectFile(dropped); }, [selectFile]);

  return <div className="min-h-screen pb-20">
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-7">
        <h1 className="text-2xl font-bold tracking-tight text-slate-950">Importar contrato</h1>
        <p className="mt-1 text-sm text-slate-500">Adicione um novo modelo de contrato e configure os campos de assinatura.</p>
      </div>
      {step === 1 && <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-6">
          <Card><CardHeader><CardTitle>Documento do contrato</CardTitle><CardDescription>Envie o PDF que será usado como modelo.</CardDescription></CardHeader><CardContent>
            <div onDrop={handleDrop} onDragOver={(event) => event.preventDefault()} className={cn('rounded-xl border-2 border-dashed p-10 text-center transition-colors', uploading ? 'border-brand-accent bg-brand-accent/5' : uploadResult ? 'border-emerald-300 bg-emerald-50' : 'border-slate-300 hover:border-brand-accent')}>
              {uploading ? <div className="space-y-3"><div className="mx-auto h-9 w-9 animate-spin rounded-full border-2 border-brand-accent border-t-transparent" /><p className="text-sm font-medium">Enviando documento... {uploadProgress}%</p></div> : uploadResult ? <div className="space-y-3"><CheckCircle className="mx-auto h-10 w-10 text-emerald-600" /><p className="truncate text-sm font-semibold">{file?.name}</p><p className="text-xs text-slate-500">{((file?.size ?? 0) / 1024 / 1024).toFixed(2)} MB · PDF</p><Button type="button" variant="outline" size="sm" onClick={() => document.getElementById('contract-file-input')?.click()}>Substituir arquivo</Button></div> : <label htmlFor="contract-file-input" className="cursor-pointer"><DocumentText className="mx-auto mb-3 h-12 w-12 text-slate-400" /><p className="text-sm font-medium text-slate-700">Arraste um arquivo PDF aqui</p><p className="my-2 text-xs text-slate-400">ou selecione do seu computador</p><Button type="button" variant="outline" asChild><span>Selecionar arquivo</span></Button></label>}
              <input id="contract-file-input" type="file" accept=".pdf,application/pdf" className="hidden" onChange={(event) => { const selected = event.target.files?.[0]; if (selected) void selectFile(selected); }} />
            </div>
          </CardContent></Card>
          <Card><CardHeader><CardTitle>Informações do modelo</CardTitle><CardDescription>Esses dados identificam o modelo na Alusa.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="space-y-2"><Label htmlFor="modelo-nome">Nome do modelo <span className="text-red-500">*</span></Label><Input id="modelo-nome" value={nome} onChange={(event) => setNome(event.target.value)} maxLength={200} placeholder="Ex.: Contrato de matrícula 2026" /></div><div className="space-y-2"><Label htmlFor="modelo-descricao">Descrição <span className="text-xs font-normal text-slate-400">(opcional)</span></Label><Textarea id="modelo-descricao" value={descricao} onChange={(event) => setDescricao(event.target.value)} maxLength={500} rows={4} placeholder="Informe quando este modelo deve ser utilizado." /></div></CardContent></Card>
        </div>
        <div className="space-y-4 lg:sticky lg:top-24">{previewUrl ? <PDFViewer url={previewUrl} showControls={false} showDownload={false} maxHeight="560px" /> : <div className="flex min-h-[400px] items-center justify-center rounded-xl border border-slate-200 bg-slate-50 text-sm text-slate-400"><DocumentText className="mr-2 h-5 w-5" />A prévia aparecerá aqui</div>}<InfoCallout title="Sobre o modelo" size="sm" showIcon={false}>O modelo será reutilizado nas matrículas. Os campos de assinatura serão configurados na próxima etapa.</InfoCallout></div>
      </div>}

      {step === 2 && uploadResult && <div><div className="mb-5"><h2 className="text-lg font-semibold text-slate-900">Definir campos de assinatura</h2><p className="text-sm text-slate-500">Posicione os campos no PDF. Nenhuma pessoa real é vinculada nesta etapa.</p></div><PDFSignatureEditor url={uploadResult.url} fields={fields} onFieldsChange={setFields} /></div>}

      {step === 3 && uploadResult && <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_400px]"><Card><CardHeader><CardTitle>Confirme o modelo</CardTitle><CardDescription>Revise as configurações antes de concluir.</CardDescription></CardHeader><CardContent className="space-y-5"><div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Nome</p><p className="mt-1 font-semibold text-slate-900">{nome}</p></div><div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Descrição</p><p className="mt-1 text-sm text-slate-600">{descricao || 'Sem descrição'}</p></div><div><p className="text-xs font-medium uppercase tracking-wide text-slate-400">Campos configurados</p><div className="mt-2 space-y-2">{fieldSummary.map((summary, index) => <div key={`${summary}-${index}`} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-700"><CheckCircle className="h-4 w-4 text-emerald-600" />{summary}</div>)}</div></div><InfoCallout title="Regra da assinatura" size="sm" showIcon={false}>Na matrícula, a Alusa definirá automaticamente se o campo será preenchido pelo responsável financeiro ou pelo aluno maior de idade.</InfoCallout></CardContent></Card><div className="lg:sticky lg:top-24"><PDFViewer url={uploadResult.url} showControls={false} showDownload={false} maxHeight="620px" /></div></div>}

      <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-5"><Button type="button" variant="outline" onClick={() => step === 1 ? router.back() : setStep((step - 1) as Step)}>{step === 1 ? 'Cancelar' : 'Voltar'}</Button>{step < 3 ? <Button type="button" disabled={step === 1 ? !canContinueBasic : !hasRequiredFields} onClick={() => setStep((step + 1) as Step)}>{step === 1 ? 'Continuar para campos' : 'Revisar modelo'}</Button> : <Button type="button" disabled={saving || !hasRequiredFields} onClick={() => void finish()}>{saving ? 'Salvando...' : 'Concluir modelo'}</Button>}</div>
    </div>
  </div>;
}
