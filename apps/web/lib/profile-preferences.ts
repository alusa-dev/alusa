export const PROFILE_LOCALE_VALUES = ['pt-BR', 'en-US'] as const;
export type ProfileLocale = (typeof PROFILE_LOCALE_VALUES)[number];

export const PROFILE_LOCALE_OPTIONS = [
  { value: 'pt-BR', label: 'Portugues (Brasil)' },
  { value: 'en-US', label: 'English (United States)' },
] satisfies ReadonlyArray<{ value: ProfileLocale; label: string }>;

export const PROFILE_THEME_VALUES = ['system', 'light', 'dark'] as const;
export type ProfileTheme = (typeof PROFILE_THEME_VALUES)[number];

export const PROFILE_THEME_OPTIONS = [
  { value: 'system', label: 'Seguir sistema' },
  { value: 'light', label: 'Modo claro' },
  { value: 'dark', label: 'Modo escuro' },
] satisfies ReadonlyArray<{ value: ProfileTheme; label: string }>;
