export const MAP_TEXT_FONT_OPTIONS = [
  { value: 'Inter, sans-serif', label: 'Inter' },
  { value: 'Arial, sans-serif', label: 'Arial' },
  { value: 'Helvetica, Arial, sans-serif', label: 'Helvetica' },
  { value: 'Georgia, serif', label: 'Georgia' },
  { value: "'Times New Roman', serif", label: 'Times New Roman' },
  { value: "'Courier New', monospace", label: 'Courier New' },
] as const;

const MAP_PANEL_FIELD_BASE =
  'h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-950 shadow-none transition-colors focus-visible:border-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-accent/30 disabled:cursor-not-allowed disabled:opacity-50';

export const MAP_PANEL_FIELD_CLASS = MAP_PANEL_FIELD_BASE;

/** @deprecated Use MAP_PANEL_FIELD_CLASS */
export const MAP_TEXT_FIELD_CLASS = MAP_PANEL_FIELD_CLASS;

export const MAP_PANEL_SELECT_TRIGGER_CLASS = [
  MAP_PANEL_FIELD_BASE,
  'h-9',
  'flex items-center justify-between gap-2',
  'border-slate-200 text-slate-950',
  'hover:border-slate-300 data-[state=open]:border-slate-300',
  'focus:ring-1 focus:ring-brand-accent/30 focus:ring-offset-0',
  '[&_svg]:text-slate-500',
].join(' ');

export const MAP_PANEL_SECTION_CLASS = 'space-y-3 rounded-xl border border-slate-200 bg-white p-3.5';

export const MAP_PANEL_SECTION_TITLE_CLASS =
  'text-[11px] font-semibold uppercase tracking-wide text-slate-500';

export const MAP_PANEL_GRID_CLASS = 'grid grid-cols-2 gap-2.5';

export const MAP_TEXT_AREA_CLASS =
  'min-h-24 w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-950 shadow-none focus-visible:border-slate-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand-accent/30';

export const MAP_PANEL_COLOR_INPUT_CLASS =
  'h-9 w-11 shrink-0 rounded-lg border border-slate-200 bg-white p-1';
