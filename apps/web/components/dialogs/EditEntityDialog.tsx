'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
      <DialogContent className="w-full max-w-[520px] gap-0 overflow-hidden p-0">
        <div className="border-b border-slate-200 px-6 py-5">
          <DialogTitle className="text-lg font-semibold text-slate-900">{title}</DialogTitle>
          {description && (
            <p className="mt-1 text-sm text-slate-600 leading-relaxed whitespace-pre-wrap">
              {description}
            </p>
          )}
        </div>
        <div className="px-6 py-6">
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
                      'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30',
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
                      'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 shadow-sm transition focus:border-[#A94DFF] focus:outline-none focus:ring-2 focus:ring-[#A94DFF]/30',
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
        <div className="flex items-center justify-end gap-3 border-t border-slate-200 bg-slate-50 px-6 py-4">
          <Button
            type="button"
            variant="outline"
            disabled={saving}
            onClick={() => !saving && onOpenChange(false)}
            className="min-w-[120px] border-slate-200 text-slate-600 hover:bg-slate-100"
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            disabled={saving}
            onClick={() => {
              void handleSubmit();
            }}
            className="min-w-[132px] bg-brand-accent text-white shadow-none hover:bg-brand-accent/90"
          >
            {saving ? savingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default EditEntityDialog;
