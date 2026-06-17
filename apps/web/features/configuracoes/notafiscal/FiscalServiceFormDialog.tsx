'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { InfoCallout, InfoCalloutItem } from '@/components/ui/info-callout';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { FiscalCodeKind } from '@alusa/asaas';
import { normalizeNbsCodeForAsaas } from '@alusa/finance/fiscal-wizard-client';

import type { FiscalServiceInputDTO } from './dtos';
import {
  formatMunicipalServiceCode,
  formatTaxPercent,
  parseTaxPercent,
} from './fiscal-form-utils';
import { FiscalAnchoredDropdownPanel } from './FiscalAnchoredDropdownPanel';
import { FiscalDropdownScope } from './FiscalDropdownScope';
import { FiscalNbsCodeField } from './FiscalNbsCodeField';
import { FiscalPisCofinsTaxStatusField } from './FiscalPisCofinsTaxStatusField';
import { FiscalReferenceCodeField } from './FiscalReferenceCodeField';
import {
  FISCAL_WIZARD_FIELD_CLASS,
  FiscalFieldLabel,
  FiscalTextField,
  fiscalInputClass,
} from './FiscalWizardFields';

type ProviderMunicipalService = { id?: string; description?: string; issTax?: number };

const SEARCH_DEBOUNCE_MS = 400;

type FiscalServiceFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<FiscalServiceInputDTO> & { id?: string };
  onSaved: () => void;
  onSearchMunicipalServices: (description?: string) => Promise<{
    data: ProviderMunicipalService[];
    portalManualMode: boolean;
  }>;
  onSearchNbsCodes: (query?: string) => Promise<{
    data: Array<{ nbsCode?: string; codeDescription?: string }>;
  }>;
  onSearchFiscalReferenceCodes: (
    kind: FiscalCodeKind,
    query?: string,
  ) => Promise<{ data: Array<{ code?: string; description?: string }> }>;
  useNationalPortal?: boolean;
  simplesNacional?: boolean;
};

const emptyForm: FiscalServiceInputDTO = {
  name: '',
  source: 'MUNICIPAL_LIST',
  municipalServiceCode: '',
  nationalTaxCode: '',
  nbsCode: '',
  defaultDescription: '',
  isDefault: false,
  iss: 2,
  pis: 0.65,
  cofins: 3,
  csll: 0,
  inss: 0,
  ir: 0,
  retainIss: false,
  useTaxSystemReformNT007: false,
};

const TAX_FIELDS = [
  { key: 'iss' as const, label: 'ISS (%)' },
  { key: 'pis' as const, label: 'PIS (%)' },
  { key: 'cofins' as const, label: 'COFINS (%)' },
  { key: 'csll' as const, label: 'CSLL (%)' },
  { key: 'inss' as const, label: 'INSS (%)' },
  { key: 'ir' as const, label: 'IR (%)' },
];

export function FiscalServiceFormDialog({
  open,
  onOpenChange,
  initial,
  onSaved,
  onSearchMunicipalServices,
  onSearchNbsCodes,
  onSearchFiscalReferenceCodes,
  useNationalPortal = false,
  simplesNacional = true,
}: FiscalServiceFormDialogProps) {
  const [form, setForm] = useState<FiscalServiceInputDTO>(emptyForm);
  const [taxPercents, setTaxPercents] = useState<Record<(typeof TAX_FIELDS)[number]['key'], string>>({
    iss: '2',
    pis: '0.65',
    cofins: '3',
    csll: '0',
    inss: '0',
    ir: '0',
  });
  const [saving, setSaving] = useState(false);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [services, setServices] = useState<ProviderMunicipalService[]>([]);
  const [loadingServices, setLoadingServices] = useState(false);
  const [portalManualMode, setPortalManualMode] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const nameInputAnchorRef = useRef<HTMLDivElement>(null);

  const searchFederalServiceCodes = useCallback(
    async (query?: string) => {
      const result = await onSearchFiscalReferenceCodes('federalServiceCodes', query);
      return { data: result.data };
    },
    [onSearchFiscalReferenceCodes],
  );

  const searchTaxSituationCodes = useCallback(
    async (query?: string) => {
      const result = await onSearchFiscalReferenceCodes('taxSituationCodes', query);
      return { data: result.data };
    },
    [onSearchFiscalReferenceCodes],
  );

  const searchTaxClassificationCodes = useCallback(
    async (query?: string) => {
      const result = await onSearchFiscalReferenceCodes('taxClassificationCodes', query);
      return { data: result.data };
    },
    [onSearchFiscalReferenceCodes],
  );

  const searchOperationIndicatorCodes = useCallback(
    async (query?: string) => {
      const result = await onSearchFiscalReferenceCodes('operationIndicatorCodes', query);
      return { data: result.data };
    },
    [onSearchFiscalReferenceCodes],
  );

  const searchServiceNbsCodes = useCallback(
    async (query?: string) => {
      const result = await onSearchNbsCodes(query);
      return {
        data: result.data.map((item) => ({
          nbsCode: item.nbsCode,
          codeDescription: item.codeDescription,
        })),
      };
    },
    [onSearchNbsCodes],
  );

  useEffect(() => {
    if (open) {
      const nextForm = {
        ...emptyForm,
        ...initial,
        source: initial?.source ?? (initial?.asaasMunicipalServiceId ? 'MUNICIPAL_LIST' : 'MANUAL'),
        isDefault: initial?.isDefault ?? false,
      };
      setForm(nextForm);
      setTaxPercents({
        iss: String(nextForm.iss ?? 0),
        pis: String(nextForm.pis ?? 0),
        cofins: String(nextForm.cofins ?? 0),
        csll: String(nextForm.csll ?? 0),
        inss: String(nextForm.inss ?? 0),
        ir: String(nextForm.ir ?? 0),
      });
      setDebouncedSearch(initial?.name ?? '');
      setSuggestionsOpen(false);
      setPortalManualMode(false);
      setShowAdvanced(
        Boolean(
          initial?.pisCofinsTaxStatus ||
            initial?.nationalTaxCode ||
            initial?.nbsCode ||
            initial?.taxSituationCode ||
            initial?.taxClassificationCode ||
            initial?.operationIndicatorCode ||
            initial?.useTaxSystemReformNT007 ||
            useNationalPortal,
        ),
      );
    }
  }, [open, initial, useNationalPortal]);

  // Detecta Portal Nacional / indisponibilidade da lista municipal assim que o modal abre.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    onSearchMunicipalServices(undefined)
      .then((result) => {
        if (cancelled) return;
        setPortalManualMode(result.portalManualMode);
        if (result.portalManualMode) {
          setForm((f) => ({ ...f, source: 'MANUAL', asaasMunicipalServiceId: undefined }));
          setSuggestionsOpen(false);
        } else {
          setServices(result.data);
        }
      })
      .catch(() => {
        if (!cancelled) setPortalManualMode(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open, onSearchMunicipalServices]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      setDebouncedSearch(form.name.trim());
    }, SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [open, form.name]);

  useEffect(() => {
    if (!open || portalManualMode || form.source === 'MANUAL') return;
    let cancelled = false;
    setLoadingServices(true);
    onSearchMunicipalServices(debouncedSearch || undefined)
      .then((result) => {
        if (cancelled) return;
        setServices(result.data);
        setPortalManualMode(result.portalManualMode);
        if (result.portalManualMode) {
          setForm((f) => ({ ...f, source: 'MANUAL', asaasMunicipalServiceId: undefined }));
          setSuggestionsOpen(false);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingServices(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, debouncedSearch, form.source, portalManualMode, onSearchMunicipalServices]);

  function selectProviderService(service: ProviderMunicipalService) {
    setForm((f) => ({
      ...f,
      source: 'MUNICIPAL_LIST',
      name: service.description ?? '',
      municipalServiceCode: '',
      asaasMunicipalServiceId: service.id,
      iss: service.issTax ?? f.iss,
    }));
    if (service.issTax != null) {
      setTaxPercents((prev) => ({ ...prev, iss: String(service.issTax) }));
    }
    setSuggestionsOpen(false);
  }

  const showMunicipalSuggestions =
    !portalManualMode &&
    form.source !== 'MANUAL' &&
    suggestionsOpen &&
    (loadingServices || services.length > 0 || form.name.trim().length > 0);

  function updateTaxPercent(key: (typeof TAX_FIELDS)[number]['key'], raw: string) {
    const formatted = formatTaxPercent(raw);
    setTaxPercents((prev) => ({ ...prev, [key]: formatted }));
    setForm((f) => ({ ...f, [key]: parseTaxPercent(formatted, f[key] ?? 0) }));
  }

  async function handleSubmit() {
    setSaving(true);
    setSubmitError(null);
    try {
      const isEdit = Boolean(initial?.id);
      const url = isEdit
        ? `/api/configuracoes/notafiscal/servicos/${initial!.id}`
        : '/api/configuracoes/notafiscal/servicos';
      const payload = {
        ...form,
        nbsCode: form.nbsCode ? normalizeNbsCodeForAsaas(form.nbsCode) : undefined,
        iss: parseTaxPercent(taxPercents.iss, form.iss ?? 0),
        pis: parseTaxPercent(taxPercents.pis, form.pis ?? 0),
        cofins: parseTaxPercent(taxPercents.cofins, form.cofins ?? 0),
        csll: parseTaxPercent(taxPercents.csll, form.csll ?? 0),
        inss: parseTaxPercent(taxPercents.inss, form.inss ?? 0),
        ir: parseTaxPercent(taxPercents.ir, form.ir ?? 0),
        municipalServiceCode:
          form.source === 'MUNICIPAL_LIST' ? undefined : form.municipalServiceCode,
      };
      const res = await fetch(url, {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(
          typeof json.message === 'string'
            ? json.message
            : typeof json.error === 'string'
              ? json.error
              : 'Erro ao salvar serviço',
        );
      }
      onSaved();
      onOpenChange(false);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Erro ao salvar serviço');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'flex max-h-[min(90dvh,calc(100dvh-4rem))] w-[calc(100vw-2rem)] max-w-lg flex-col gap-0 overflow-hidden p-0',
          'alusa-modal-surface border-[#e5e7eb]',
        )}
      >
        <DialogHeader className="shrink-0 border-b border-[#e5e7eb] px-5 py-4 text-left">
          <DialogTitle className="text-lg font-semibold text-gray-900">
            {initial?.id ? 'Editar serviço' : 'Adicionar serviço'}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {portalManualMode ? (
            <InfoCallout variant="warning" size="sm">
              <InfoCalloutItem label="Portal Nacional" labelTone="warning">
                Sua conta utiliza o Portal Nacional de NFSe. A lista de serviços municipais não está
                disponível nesta configuração. Informe o nome e o código do serviço manualmente,
                conforme orientação da sua contabilidade.
              </InfoCalloutItem>
            </InfoCallout>
          ) : (
            <InfoCallout variant="info" size="sm">
              <InfoCalloutItem label="Lista municipal">
                Digite no campo de nome para buscar serviços na lista municipal da sua cidade.
                Selecione uma sugestão abaixo ou marque &quot;Informar código manualmente&quot;.
              </InfoCalloutItem>
            </InfoCallout>
          )}

          {submitError ? (
            <InfoCallout variant="warning" size="sm">
              <InfoCalloutItem label="Revise o serviço fiscal" labelTone="danger">
                {submitError}
              </InfoCalloutItem>
            </InfoCallout>
          ) : null}

          {!portalManualMode ? (
            <label className="flex items-center gap-2 text-sm text-gray-900">
              <Checkbox
                checked={form.source === 'MANUAL'}
                onCheckedChange={(checked) => {
                  const manual = checked === true;
                  setForm((f) => ({
                    ...f,
                    source: manual ? 'MANUAL' : 'MUNICIPAL_LIST',
                    asaasMunicipalServiceId: manual ? undefined : f.asaasMunicipalServiceId,
                  }));
                  if (!manual) setSuggestionsOpen(true);
                }}
              />
              Informar código manualmente
            </label>
          ) : null}

          <div className={FISCAL_WIZARD_FIELD_CLASS}>
            <FiscalFieldLabel
              label="Nome do serviço municipal"
              help={
                portalManualMode || form.source === 'MANUAL'
                  ? 'Nome descritivo do serviço prestado.'
                  : 'A lista municipal é carregada automaticamente conforme você digita.'
              }
            />
            <div ref={nameInputAnchorRef}>
              <Input
                value={form.name}
                placeholder={
                  portalManualMode || form.source === 'MANUAL'
                    ? 'Ex.: Ensino regular — mensalidade'
                    : 'Ex.: 8.02, mensalidade, educação'
                }
                className={fiscalInputClass(false)}
                onFocus={() => {
                  if (!portalManualMode && form.source !== 'MANUAL') setSuggestionsOpen(true);
                }}
                onChange={(e) => {
                  const value = e.target.value;
                  setForm((f) => ({
                    ...f,
                    name: value,
                    asaasMunicipalServiceId:
                      f.source === 'MANUAL' ? f.asaasMunicipalServiceId : undefined,
                  }));
                  if (!portalManualMode && form.source !== 'MANUAL') setSuggestionsOpen(true);
                }}
              />
            </div>
            {form.source === 'MUNICIPAL_LIST' && form.asaasMunicipalServiceId ? (
              <p className="text-xs text-green-700">Serviço selecionado da lista municipal.</p>
            ) : null}
            <FiscalAnchoredDropdownPanel
              open={showMunicipalSuggestions}
              anchorRef={nameInputAnchorRef}
              onClose={() => setSuggestionsOpen(false)}
            >
              {loadingServices ? (
                <p className="px-2 py-2 text-xs text-gray-500">Buscando serviços…</p>
              ) : services.length === 0 ? (
                <p className="px-2 py-2 text-xs text-gray-500">
                  Nenhum serviço encontrado. Tente outro termo ou use o modo manual.
                </p>
              ) : (
                services.map((service) => (
                  <button
                    key={service.id ?? service.description}
                    type="button"
                    role="option"
                    aria-selected={form.asaasMunicipalServiceId === service.id}
                    className={cn(
                      'w-full rounded-md px-2 py-2 text-left text-xs transition-colors hover:bg-purple-50',
                      form.asaasMunicipalServiceId === service.id &&
                        'bg-purple-50 ring-1 ring-purple-200',
                    )}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => selectProviderService(service)}
                  >
                    <span className="font-medium text-gray-900">{service.description}</span>
                    {service.issTax != null ? (
                      <span className="ml-2 text-gray-500">ISS {service.issTax}%</span>
                    ) : null}
                  </button>
                ))
              )}
            </FiscalAnchoredDropdownPanel>
          </div>

          {form.source === 'MANUAL' ? (
            <FiscalTextField
              label="Código de serviço municipal"
              help="Formato com pontos — ex.: 08.01.01"
              value={form.municipalServiceCode ?? ''}
              placeholder="08.01.01"
              inputMode="numeric"
              onChange={(value) =>
                setForm((f) => ({
                  ...f,
                  municipalServiceCode: formatMunicipalServiceCode(value),
                }))
              }
            />
          ) : null}

          <div className="space-y-3">
            <p className="text-sm font-medium text-gray-900">Alíquotas (%)</p>
            <div className="grid gap-4 sm:grid-cols-2">
              {TAX_FIELDS.map(({ key, label }) => (
                <div key={key} className={FISCAL_WIZARD_FIELD_CLASS}>
                  <FiscalFieldLabel label={label} />
                  <Input
                    inputMode="decimal"
                    value={taxPercents[key]}
                    className={fiscalInputClass(false)}
                    onChange={(e) => updateTaxPercent(key, e.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className={FISCAL_WIZARD_FIELD_CLASS}>
            <FiscalFieldLabel
              label="Descrição padrão"
              help="Texto usado na NFSe. Você pode usar variáveis como {aluno} e {competencia}."
            />
            <Textarea
              rows={2}
              value={form.defaultDescription ?? ''}
              className={cn(fiscalInputClass(false), 'min-h-[4.5rem] resize-none py-2')}
              placeholder="Mensalidade escolar referente a {competencia} — Aluno: {aluno}"
              onChange={(e) => setForm((f) => ({ ...f, defaultDescription: e.target.value }))}
            />
          </div>

          <label className="flex items-center gap-2 text-sm text-gray-900">
            <Checkbox
              checked={form.isDefault ?? false}
              onCheckedChange={(checked) =>
                setForm((f) => ({ ...f, isDefault: checked === true }))
              }
            />
            Serviço padrão para emissão
          </label>

          <div className="rounded-lg border border-[#e5e7eb]">
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-2.5 text-left text-sm font-medium text-gray-900 hover:bg-gray-50"
              onClick={() => setShowAdvanced((current) => !current)}
            >
              Portal Nacional e reforma tributária
              <span className="text-xs font-normal text-gray-500">
                {showAdvanced ? 'Ocultar' : 'Opcional'}
              </span>
            </button>
            {showAdvanced ? (
              <FiscalDropdownScope>
                <div className="space-y-4 border-t border-[#e5e7eb] px-3 py-4">
                <InfoCallout variant="info" size="sm">
                  <InfoCalloutItem label="Referências fiscais">
                    Códigos oficiais do Portal Nacional e da reforma tributária, atualizados
                    automaticamente. Consulte sua contabilidade em caso de dúvida.
                  </InfoCalloutItem>
                </InfoCallout>

                <FiscalReferenceCodeField
                  label="Código federal de serviço"
                  help="Código federal do serviço — ex.: 080101 (ensino regular). Busque por descrição ou digite o código."
                  placeholder="080101"
                  value={form.nationalTaxCode ?? ''}
                  onChange={(value) => setForm((f) => ({ ...f, nationalTaxCode: value }))}
                  onSearch={searchFederalServiceCodes}
                />

                <FiscalNbsCodeField
                  value={form.nbsCode ?? ''}
                  onChange={(value) => setForm((f) => ({ ...f, nbsCode: value }))}
                  onSearch={searchServiceNbsCodes}
                />

                <FiscalPisCofinsTaxStatusField
                  value={form.pisCofinsTaxStatus ?? ''}
                  simplesNacional={simplesNacional}
                  useNationalPortal={useNationalPortal}
                  onChange={(value) => setForm((f) => ({ ...f, pisCofinsTaxStatus: value }))}
                />

                <div className="grid gap-4 sm:grid-cols-2">
                  <FiscalReferenceCodeField
                    label="Situação tributária"
                    help="Código da situação tributária conforme tabela oficial do Portal Nacional."
                    placeholder="200001"
                    value={form.taxSituationCode ?? ''}
                    onChange={(value) => setForm((f) => ({ ...f, taxSituationCode: value }))}
                    onSearch={searchTaxSituationCodes}
                  />
                  <FiscalReferenceCodeField
                    label="Classificação tributária"
                    help="Código da classificação tributária conforme tabela oficial do Portal Nacional."
                    placeholder="011001"
                    value={form.taxClassificationCode ?? ''}
                    onChange={(value) => setForm((f) => ({ ...f, taxClassificationCode: value }))}
                    onSearch={searchTaxClassificationCodes}
                  />
                </div>

                <FiscalReferenceCodeField
                  label="Indicador de operação"
                  help="Código do indicador de operação conforme tabela oficial do Portal Nacional."
                  placeholder="020101"
                  value={form.operationIndicatorCode ?? ''}
                  onChange={(value) => setForm((f) => ({ ...f, operationIndicatorCode: value }))}
                  onSearch={searchOperationIndicatorCodes}
                />

                <label className="flex items-start gap-2 text-sm text-gray-900">
                  <Checkbox
                    checked={form.useTaxSystemReformNT007 ?? false}
                    onCheckedChange={(checked) =>
                      setForm((f) => ({ ...f, useTaxSystemReformNT007: checked === true }))
                    }
                  />
                  <span>
                    Usar validações NT-007 (PIS/COFINS)
                    <span className="mt-0.5 block text-xs font-normal text-gray-500">
                      Permite antecipar as regras de PIS/COFINS da NT-007 durante a migração ao
                      Portal Nacional.
                    </span>
                  </span>
                </label>
                </div>
              </FiscalDropdownScope>
            ) : null}
          </div>
        </div>

        <DialogFooter className="shrink-0 gap-2 border-t border-[#e5e7eb] px-5 py-4 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              saving ||
              !form.name ||
              (form.source === 'MUNICIPAL_LIST'
                ? !form.asaasMunicipalServiceId
                : !form.municipalServiceCode)
            }
          >
            {saving ? 'Salvando…' : 'Salvar serviço'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
