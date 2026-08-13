'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CheckCircle, DocumentText, Eye } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/components/ui/toast';
import { getContratoModelo, updateContratoModelo, type ContratoModelo } from './services/modelos-service';
import { PDFSignatureEditor, type SignatureField } from './components/PDFSignatureEditor';
import { PDFViewer } from './components/PDFViewer';

type Step = 1 | 2 | 3;

interface ModeloDetalhesFeatureProps {
  modeloId: string;
}

export function ModeloDetalhesFeature({ modeloId }: ModeloDetalhesFeatureProps) {
  const router = useRouter();
  const [modelo, setModelo] = useState<ContratoModelo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [editNome, setEditNome] = useState('');
  const [editDescricao, setEditDescricao] = useState('');
  const [editFields, setEditFields] = useState<SignatureField[]>([]);

  useEffect(() => {
    getContratoModelo(modeloId)
      .then((data) => {
        setModelo(data);
        setEditNome(data.nome);
        setEditDescricao(data.descricao || '');
        setEditFields(data.campos);
      })
      .catch((error) => {
        toast.error('Erro ao carregar modelo');
        console.error(error);
      })
      .finally(() => setLoading(false));
  }, [modeloId]);

  const resetChanges = useCallback(() => {
    if (!modelo) return;
    setEditNome(modelo.nome);
    setEditDescricao(modelo.descricao || '');
    setEditFields(modelo.campos);
    setStep(1);
  }, [modelo]);

  const handleSave = useCallback(async () => {
    if (!modelo) return;
    try {
      setSaving(true);
      const updated = await updateContratoModelo(modelo.id, {
        nome: editNome.trim(),
        descricao: editDescricao.trim() || null,
        campos: editFields.map(({ id: _id, ...field }) => field),
      });
      setModelo({ ...modelo, ...updated });
      setStep(1);
      toast.success('Modelo atualizado com sucesso.');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Erro ao salvar modelo');
    } finally {
      setSaving(false);
    }
  }, [modelo, editNome, editDescricao, editFields]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center"><div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-accent border-t-transparent" /></div>;
  }

  if (!modelo) {
    return <div className="flex min-h-screen items-center justify-center p-6"><div className="text-center"><p className="mb-4 text-slate-600">Modelo não encontrado</p><Button onClick={() => router.push('/contratos/modelos')}>Voltar para modelos</Button></div></div>;
  }

  const hasRequiredRoles = editFields.some((field) => field.papel === 'ESCOLA') && editFields.some((field) => field.papel === 'RESPONSAVEL_OU_ALUNO');
  const canContinue = step === 1 ? Boolean(editNome.trim()) : hasRequiredRoles;

  return (
    <div className="min-h-screen bg-white text-slate-900">
      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-7">
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">Editar contrato</h1>
          <p className="mt-1 text-sm text-slate-500">Atualize os dados do modelo e revise os campos de assinatura antes de salvar.</p>
        </div>

        {step === 1 && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-6">
            <Card><CardHeader><CardTitle>Documento do contrato</CardTitle><CardDescription>Este é o PDF utilizado como base para o modelo.</CardDescription></CardHeader><CardContent><div className="flex items-center justify-between gap-4 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-4"><div className="flex min-w-0 items-center gap-3"><div className="rounded-lg bg-white p-2 text-emerald-600"><DocumentText className="h-5 w-5" /></div><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{modelo.nome}.pdf</p><p className="text-xs text-slate-500">{modelo.tamanhoBytes ? `${(modelo.tamanhoBytes / 1024 / 1024).toFixed(2)} MB` : 'PDF'} · Arquivo preservado</p></div></div><Button type="button" variant="outline" size="sm" className="shrink-0 bg-white" onClick={() => window.open(modelo.arquivoPdfUrl, '_blank', 'noopener,noreferrer')}><Eye className="mr-2 h-4 w-4" />Abrir</Button></div></CardContent></Card>
            <Card><CardHeader><CardTitle>Informações do modelo</CardTitle><CardDescription>Esses dados identificam o modelo na Alusa.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="space-y-2"><Label htmlFor="modelo-edit-nome">Nome do modelo <span className="text-red-500">*</span></Label><Input id="modelo-edit-nome" value={editNome} onChange={(event) => setEditNome(event.target.value)} maxLength={200} /></div><div className="space-y-2"><Label htmlFor="modelo-edit-descricao">Descrição <span className="text-xs font-normal text-slate-400">(opcional)</span></Label><Textarea id="modelo-edit-descricao" value={editDescricao} onChange={(event) => setEditDescricao(event.target.value)} maxLength={500} rows={4} placeholder="Informe quando este modelo deve ser utilizado." /></div></CardContent></Card>
          </div>
          <div className="space-y-4"><div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50"><PDFViewer url={modelo.arquivoPdfUrl} title={modelo.nome} maxHeight="380px" /></div><div className="rounded-xl bg-[#d8f3f5] px-4 py-3 text-sm text-slate-700"><p className="font-semibold text-slate-900">Sobre o modelo</p><p className="mt-1 text-xs leading-4">O modelo será reutilizado nas matrículas. Os campos de assinatura podem ser revisados na próxima etapa.</p></div></div>
        </div>}

        {step === 2 && <div><div className="mb-5"><h2 className="text-lg font-semibold text-slate-900">Definir campos de assinatura</h2><p className="text-sm text-slate-500">Posicione os campos no PDF. Você pode ajustar este modelo mesmo que ele já tenha contratos gerados.</p></div><PDFSignatureEditor url={modelo.arquivoPdfUrl} fields={editFields} onFieldsChange={setEditFields} /></div>}

        {step === 3 && <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="border-slate-200 shadow-sm"><CardHeader><CardTitle>Revise as alterações</CardTitle><CardDescription>Confira os dados e a configuração antes de salvar.</CardDescription></CardHeader><CardContent className="space-y-5"><div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nome do modelo</p><p className="mt-1 font-semibold text-slate-900">{editNome}</p><p className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Descrição</p><p className="mt-1 text-sm text-slate-600">{editDescricao || 'Sem descrição'}</p></div><div><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Campos de assinatura</p><div className="mt-2 space-y-2">{editFields.map((field) => <div key={field.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"><span className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-emerald-600" />{field.papel === 'ESCOLA' ? 'Escola' : 'Responsável / aluno'}</span><span className="text-xs text-slate-500">Página {field.pagina}</span></div>)}</div></div></CardContent></Card>
          <div className="space-y-4"><PDFViewer url={modelo.arquivoPdfUrl} title={modelo.nome} maxHeight="620px" /><div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-950">As alterações serão usadas nas próximas matrículas e nos contratos pendentes vinculados a este modelo.</div></div>
        </div>}

        <div className="mt-8 flex items-center justify-between border-t border-slate-200 pt-5"><Button variant="outline" onClick={() => step === 1 ? resetChanges() : setStep((step - 1) as Step)} disabled={saving}>{step === 1 ? 'Cancelar' : 'Voltar'}</Button>{step < 3 ? <Button onClick={() => canContinue && setStep((step + 1) as Step)} disabled={!canContinue}>{step === 1 ? 'Continuar para campos' : 'Revisar modelo'}</Button> : <Button onClick={() => void handleSave()} disabled={saving || !hasRequiredRoles}>{saving ? 'Salvando...' : 'Salvar alterações'}</Button>}</div>
      </main>
    </div>
  );
}
