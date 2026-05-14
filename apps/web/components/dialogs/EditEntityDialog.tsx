'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/cn';

/**
 * EditEntityDialog
 * Dialog genérico para edição simples de entidades com campos básicos.
 * Focado em consistência de espaçamentos, tipografia e acessibilidade.
 */
export interface EditFieldConfig {
  name: string;
  label: string;
  type?: 'text' | 'textarea' | 'number' | 'select';
  placeholder?: string;
  readOnly?: boolean;
  disabled?: boolean;
  /** Somente para selects */
  options?: { value: string; label: string }[];
  /** Valor inicial */
  initialValue?: string | number | null;
  /** Validação inline opcional */
  validate?: (_value: string) => string | null;
  /** Transform para salvar */
  transform?: (_value: string) => unknown;
  /** Linha separada inteira (textarea etc) */
  fullWidth?: boolean;
}

export interface EditEntityDialogProps<TPayload = unknown> {
  open: boolean;
  title: string;
  description?: string;
  fields: EditFieldConfig[];
  confirmLabel?: string;
  cancelLabel?: string;
  savingLabel?: string;
  onBuildPayload?: (_raw: Record<string, unknown>) => TPayload;
  onSubmit: (_payload: TPayload) => Promise<void> | void;
  onOpenChange: (_open: boolean) => void;
}

export function EditEntityDialog<TPayload = unknown>({
  open,
  title,
  description,
  fields,
  confirmLabel = 'Salvar',
  cancelLabel = 'Cancelar',
  savingLabel = 'Salvando...',
  onBuildPayload,
  onSubmit,
  onOpenChange,
}: EditEntityDialogProps<TPayload>) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const acc: Record<string, string> = {};
    fields.forEach((f) => {
      const v = f.initialValue;
      acc[f.name] = v === null || v === undefined ? '' : String(v);
    });
    return acc;
  });
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [saving, setSaving] = useState(false);

  function updateField(name: string, value: string) {
    setValues((v) => ({ ...v, [name]: value }));
  }

  function runValidation(): boolean {
    const next: Record<string, string | null> = {};
    fields.forEach((f) => {
      if (f.validate) next[f.name] = f.validate(values[f.name]);
      else next[f.name] = null;
    });
    setErrors(next);
    return Object.values(next).every((e) => !e);
  }

  async function handleSubmit() {
    if (saving) return;
    if (!runValidation()) return;
    try {
      setSaving(true);
      const raw: Record<string, unknown> = {};
      fields.forEach((f) => {
        const val = values[f.name];
        raw[f.name] = f.transform ? f.transform(val) : val;
      });
      const payload = onBuildPayload ? onBuildPayload(raw) : (raw as TPayload);
      await onSubmit(payload);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !saving) onOpenChange(false);
      }}
    >
      <DialogContent
        fullScreenMobile
        className="w-full max-w-[520px] gap-0 overflow-hidden bg-slate-50 p-0 max-md:flex max-md:h-[100dvh] max-md:max-h-[100dvh] max-md:flex-col max-md:min-h-0 md:rounded-2xl"
      >
        <div className="relative shrink-0 border-b border-slate-200 bg-slate-50 px-4 py-4 max-md:pb-4 max-md:pl-4 max-md:pr-14 max-md:pt-[calc(3rem+env(safe-area-inset-top,0px))] md:px-6 md:py-5">
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-brand-accent/40 to-transparent" />
          <DialogTitle className="pr-2 text-lg font-semibold text-slate-900 md:pr-0">{title}</DialogTitle>
          {description ? (
            <DialogDescription className="mt-1 text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
              {description}
            </DialogDescription>
          ) : (
            <DialogDescription className="sr-only">
              Formulário de edição. Revise os campos e salve para aplicar as alterações.
            </DialogDescription>
          )}
        </div>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden max-md:min-h-0">
          <div className="flex-1 overflow-y-auto px-4 py-6 max-md:min-h-0 md:px-6">
          <div className="grid gap-4 md:grid-cols-2">
            {fields.map((f) => (
              <div
                key={f.name}
                className={cn(
                  'flex flex-col gap-1',
                  f.fullWidth ? 'md:col-span-2' : 'md:col-span-1',
                )}
              >
                <label className="text-xs font-medium text-slate-600" htmlFor={f.name}>
                  {f.label}
                </label>
                {f.type === 'textarea' ? (
                  <textarea
                    id={f.name}
                    value={values[f.name]}
                    onChange={(e) => updateField(f.name, e.target.value)}
                    rows={4}
                    placeholder={f.placeholder}
                    readOnly={f.readOnly}
                    disabled={f.disabled}
                    className={cn(
                      'w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30',
                      (f.readOnly || f.disabled) &&
                        'bg-slate-100 text-slate-500 cursor-not-allowed focus:border-slate-200 focus:ring-0',
                    )}
                  />
                ) : f.type === 'select' ? (
                  <select
                    id={f.name}
                    value={values[f.name]}
                    onChange={(e) => updateField(f.name, e.target.value)}
                    disabled={f.disabled}
                    className={cn(
                      'h-11 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 md:h-10 md:min-h-0',
                      f.disabled &&
                        'bg-slate-100 text-slate-500 cursor-not-allowed focus:border-slate-200 focus:ring-0',
                    )}
                  >
                    {(f.options || []).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={f.name}
                    type={f.type === 'number' ? 'number' : 'text'}
                    value={values[f.name]}
                    onChange={(e) => updateField(f.name, e.target.value)}
                    placeholder={f.placeholder}
                    readOnly={f.readOnly}
                    disabled={f.disabled}
                    className={cn(
                      'h-11 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30 md:h-10 md:min-h-0',
                      (f.readOnly || f.disabled) &&
                        'bg-slate-100 text-slate-500 cursor-not-allowed focus:border-slate-200 focus:ring-0',
                    )}
                  />
                )}
                {errors[f.name] && (
                  <p className="text-[11px] font-medium text-[#DC2626]" role="alert">
                    {errors[f.name]}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="flex shrink-0 flex-col-reverse gap-3 border-t border-slate-200 bg-slate-50 px-4 py-4 md:flex-row md:items-center md:justify-end md:gap-3 md:px-6 md:py-4">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => !saving && onOpenChange(false)}
            className="h-11 min-h-11 w-full min-w-0 border-slate-200 text-slate-600 shadow-none hover:bg-slate-100 md:h-10 md:min-h-0 md:w-auto md:min-w-[120px]"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              void handleSubmit();
            }}
            className="h-11 min-h-11 w-full min-w-0 bg-brand-accent text-white shadow-none hover:bg-brand-accent/90 md:h-10 md:min-h-0 md:w-auto md:min-w-[132px]"
          >
            {saving ? savingLabel : confirmLabel}
          </Button>
        </div>
      </div>
      </DialogContent>
    </Dialog>
  );
}

export default EditEntityDialog;
