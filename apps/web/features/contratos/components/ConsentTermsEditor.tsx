'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash as Trash2 } from '@/components/icons/icons';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { FieldHelpTooltip } from '@/components/ui/field-help-tooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { getConsentimentoTemplates, type ConsentimentoTemplate } from '../services/modelos-service';

export type EditableConsentTerm = {
  templateId?: string | null;
  templateVersao?: number | null;
  finalidade: 'IMAGE_USE' | 'MARKETING' | 'COMMUNICATIONS' | 'OTHER';
  titulo: string;
  texto: string;
  papel: 'RESPONSAVEL_OU_ALUNO';
  obrigatorio: boolean;
  /** @deprecated Persisted only for legacy records; refusals never block signing. */
  recusaImpedeAssinatura?: boolean;
  ordem: number;
};

type ConsentTermsEditorProps = {
  enabled: boolean;
  terms: EditableConsentTerm[];
  onEnabledChange: (enabled: boolean) => void;
  onTermsChange: (terms: EditableConsentTerm[]) => void;
  showToggle?: boolean;
};

export function ConsentTermsEditor(props: ConsentTermsEditorProps) {
  const { onEnabledChange, onTermsChange, showToggle = true } = props;
  const [templates, setTemplates] = useState<ConsentimentoTemplate[]>([]);
  const [templatesError, setTemplatesError] = useState(false);

  useEffect(() => {
    let active = true;
    void getConsentimentoTemplates()
      .then((items) => {
        if (!active) return;
        setTemplates(items);
        setTemplatesError(false);
      })
      .catch(() => {
        if (active) setTemplatesError(true);
      });
    return () => { active = false; };
  }, []);

  const updateTerm = (index: number, patch: Partial<EditableConsentTerm>) => {
    onTermsChange(props.terms.map((term, termIndex) => termIndex === index ? { ...term, ...patch } : term));
  };

  const addTerm = () => {
    onTermsChange([
      ...props.terms,
      {
        finalidade: 'IMAGE_USE',
        titulo: '',
        texto: '',
        papel: 'RESPONSAVEL_OU_ALUNO',
        obrigatorio: true,
        ordem: props.terms.length,
      },
    ]);
  };

  const removeTerm = (index: number) => {
    onTermsChange(props.terms.filter((_, termIndex) => termIndex !== index).map((term, ordem) => ({ ...term, ordem })));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Termos de consentimento</CardTitle>
        <CardDescription>Configure o termo de consentimento separado do aceite geral do contrato.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {showToggle && <div className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
          <Checkbox
            id="modelo-edit-tem-consentimentos"
            className="mt-1"
            checked={props.enabled}
            onCheckedChange={onEnabledChange}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="modelo-edit-tem-consentimentos" className="cursor-pointer text-sm font-semibold leading-5 text-slate-800">
                Este contrato possui termos de consentimento
              </Label>
              <FieldHelpTooltip label="Sobre o termo de consentimento" content="O assinante poderá autorizar ou recusar este termo durante a assinatura." />
            </div>
          </div>
        </div>}

        {props.enabled && (
          <div className="space-y-4">
            {templatesError && (
              <p className="text-xs leading-5 text-amber-700">Não foi possível carregar os modelos padrão. Atualize a página ou tente novamente.</p>
            )}

            {props.terms.length === 0 && (
              <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center text-sm text-slate-500">
                Nenhum termo configurado. Adicione uma autorização para começar.
              </div>
            )}

            {props.terms.map((term, index) => (
              <div key={`${term.titulo || 'consentimento'}-${index}`} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-4 flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-accent">Consentimento {index + 1}</p>
                    <p className="mt-1 text-sm text-slate-500">A resposta será registrada no contrato assinado.</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="text-slate-400 hover:text-red-600" onClick={() => removeTerm(index)} aria-label={`Remover consentimento ${index + 1}`}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={`consent-template-${index}`}>Template do termo</Label>
                    <Select
                      value={term.templateId ?? '__CUSTOM__'}
                      disabled={Boolean(term.templateId)}
                      onValueChange={(value) => {
                        if (value === '__CUSTOM__') {
                          updateTerm(index, { templateId: null, templateVersao: null });
                          return;
                        }
                        const template = templates.find((item) => item.id === value);
                        if (!template) return;
                        updateTerm(index, {
                          templateId: template.id,
                          templateVersao: template.versao,
                          finalidade: template.finalidade,
                          titulo: template.titulo,
                          texto: template.texto,
                        });
                      }}
                    >
                      <SelectTrigger id={`consent-template-${index}`}>
                        <SelectValue placeholder="Selecione um template" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__CUSTOM__">Novo</SelectItem>
                        {templates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>{template.nome} · v{template.versao}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`consent-finalidade-${index}`}>Finalidade</Label>
                    <Select value={term.finalidade} onValueChange={(value) => updateTerm(index, { finalidade: value as EditableConsentTerm['finalidade'] })} disabled={Boolean(term.templateId)}>
                      <SelectTrigger id={`consent-finalidade-${index}`}>
                        <SelectValue placeholder="Selecione a finalidade" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="IMAGE_USE">Uso de imagem</SelectItem>
                        <SelectItem value="MARKETING">Comunicações promocionais</SelectItem>
                        <SelectItem value="COMMUNICATIONS">Comunicações operacionais</SelectItem>
                        <SelectItem value="OTHER">Outra finalidade</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={`consent-titulo-${index}`}>Título da cláusula</Label>
                    <Input id={`consent-titulo-${index}`} value={term.titulo} onChange={(event) => updateTerm(index, { titulo: event.target.value })} placeholder="Autorização de uso de imagem" disabled={Boolean(term.templateId)} />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor={`consent-texto-${index}`}>Texto apresentado ao assinante</Label>
                    <Textarea id={`consent-texto-${index}`} value={term.texto} onChange={(event) => updateTerm(index, { texto: event.target.value })} rows={5} placeholder="Autorizo a utilização da imagem do aluno..." disabled={Boolean(term.templateId)} />
                  </div>
                </div>

                {term.templateId && (
                  <p className="mt-3 text-xs leading-5 text-slate-500">
                    Este termo segue o conteúdo do template selecionado. Escolha <span className="font-medium text-slate-700">Novo</span> para liberar a edição.
                  </p>
                )}

                <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
                  <label className="flex items-start gap-3 text-sm text-slate-600">
                    <Checkbox className="mt-0.5" checked={term.obrigatorio} onCheckedChange={(checked) => updateTerm(index, { obrigatorio: checked })} disabled={Boolean(term.templateId)} />
                    <span className="flex items-center gap-1.5"><span className="font-medium text-slate-800">Exigir uma resposta</span><FieldHelpTooltip label="Sobre exigir uma resposta" content="Quando ativado, o assinante deverá escolher uma opção antes de concluir a assinatura." /></span>
                  </label>
                </div>
              </div>
            ))}

            <Button type="button" variant="outline" className="w-full border-dashed" onClick={addTerm}>
              <Plus className="mr-2 h-4 w-4" />Adicionar termo de consentimento
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
