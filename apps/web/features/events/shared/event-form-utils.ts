export const FILTER_INPUT_CLASS =
  'h-10 rounded-lg border-slate-200 bg-white text-sm shadow-none focus-visible:ring-brand-accent/30';
export const SELECT_CLASS =
  'h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 shadow-none outline-none focus:ring-2 focus:ring-brand-accent/25';
export const LABEL_CLASS = 'text-xs font-medium text-slate-600';
export const PRIMARY_BUTTON_CLASS = 'h-10 bg-brand-accent px-4 text-white shadow-none hover:bg-brand-accent/90';
export const OUTLINE_BUTTON_CLASS = 'h-10 border-slate-200 bg-white px-4 text-slate-700 shadow-sm shadow-slate-200/40 hover:bg-slate-50';

export const TIME_OPTIONS = Array.from({ length: 24 * 4 }, (_, index) => {
  const hour = String(Math.floor(index / 4)).padStart(2, '0');
  const minute = String((index % 4) * 15).padStart(2, '0');
  return hour + ':' + minute;
});

export function toDatetimeLocal(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function toDateOnly(value?: string | null) {
  const local = toDatetimeLocal(value);
  return local ? local.slice(0, 10) : '';
}

export function toTimeOnly(value?: string | null) {
  const local = toDatetimeLocal(value);
  return local ? local.slice(11, 16) : '';
}

export function formatDateInputValue(date?: Date) {
  if (!date || Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return year + '-' + month + '-' + day;
}

export function getRoundedNowISOString() {
  const now = new Date();
  const minutes = now.getMinutes();
  const rounded = Math.round(minutes / 15) * 15;
  if (rounded === 60) {
    now.setHours(now.getHours() + 1);
    now.setMinutes(0);
  } else {
    now.setMinutes(rounded);
  }
  now.setSeconds(0);
  now.setMilliseconds(0);
  return now.toISOString();
}

export function datetimeValue(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').trim();
  return raw ? new Date(raw).toISOString() : undefined;
}

export function nullableString(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').trim();
  return raw || undefined;
}

export function numberValue(form: FormData, key: string) {
  const raw = String(form.get(key) ?? '').replace(',', '.').trim();
  return raw ? Number(raw) : undefined;
}

export function booleanValue(form: FormData, key: string) {
  return form.get(key) === 'on';
}
