import { cn } from '@/lib/utils';

/** Canonical control styling shared by the student and collaborator wizards. */
export const wizardFieldInputClass = cn(
  'wizard-field-input flex h-10 w-full rounded-md border border-transparent bg-[#eff3f8] px-3 py-2 text-[13px] leading-5 text-slate-900 shadow-none placeholder:text-slate-400',
  'focus:border-[#9ca3af] focus:bg-transparent focus:outline-none focus-visible:outline-none focus-visible:ring-0',
  'alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-input-text)]',
  'alusa-dark:placeholder:text-[color:var(--color-input-placeholder)] alusa-dark:focus:bg-transparent',
);

export const wizardTextareaFieldClass = cn(
  'wizard-field-input min-h-24 w-full rounded-md border border-transparent bg-[#eff3f8] px-3 py-2 text-[13px] leading-5 text-slate-900 shadow-none placeholder:text-slate-400',
  'focus:border-[#9ca3af] focus:bg-transparent focus:outline-none focus-visible:outline-none focus-visible:ring-0',
  'alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-input-text)]',
  'alusa-dark:placeholder:text-[color:var(--color-input-placeholder)] alusa-dark:focus:bg-transparent',
);

/** Filled fields used by the compact registration modals, matching the responsible form. */
export const wizardSoftFieldInputClass = cn(
  'wizard-field-input h-10 w-full rounded-[10px] border-0 bg-[#eff3f8] px-3 py-2 text-[13px] leading-5 text-[#30333b] shadow-none placeholder:text-[#8a9bb2] transition-colors duration-150',
  'hover:border-0 hover:bg-[#e7edf5] focus:border-0 focus:bg-transparent focus:shadow-[inset_0_0_0_1px_#9ca3af] focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0',
  'data-[state=open]:border-0 data-[state=open]:bg-transparent data-[state=open]:text-[#30333b] data-[state=open]:ring-0 data-[state=open]:shadow-[inset_0_0_0_1px_#9ca3af]',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-input-text)]',
  'alusa-dark:placeholder:text-[color:var(--color-input-placeholder)] alusa-dark:focus:bg-transparent',
);

export const wizardSoftTextareaFieldClass = cn(
  'wizard-field-input min-h-24 w-full rounded-[10px] border-0 bg-[#eff3f8] px-3 py-2 text-[13px] leading-5 text-[#30333b] shadow-none placeholder:text-[#8a9bb2] transition-colors duration-150',
  'hover:border-0 hover:bg-[#e7edf5] focus:border-0 focus:bg-transparent focus:shadow-[inset_0_0_0_1px_#9ca3af] focus:outline-none focus:ring-0 focus-visible:border-0 focus-visible:outline-none focus-visible:ring-0',
  'disabled:cursor-not-allowed disabled:opacity-60',
  'alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-input-text)]',
  'alusa-dark:placeholder:text-[color:var(--color-input-placeholder)] alusa-dark:focus:bg-transparent',
);

export const wizardSoftCheckboxClass =
  'rounded-[4px] border-slate-300 bg-white text-brand-accent shadow-none focus-visible:ring-brand-accent/35 focus-visible:ring-offset-2 data-[state=checked]:border-brand-accent data-[state=checked]:bg-brand-accent alusa-dark:border-[color:var(--color-border-strong)] alusa-dark:bg-[color:var(--color-input-bg)] alusa-dark:data-[state=checked]:border-[color:var(--color-sidebar-accent)] alusa-dark:data-[state=checked]:bg-[color:var(--color-sidebar-accent)]';

export const wizardFieldInvalidClass = 'wizard-field-input--error';
