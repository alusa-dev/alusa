'use client';

import { useSyncExternalStore } from 'react';

export type SurfaceTheme = 'auto' | 'dark' | 'light';

const DARK_QUERY = '(prefers-color-scheme: dark)';

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'data-theme'] });
  const mq = typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null;
  mq?.addEventListener('change', onChange);
  return () => {
    observer.disconnect();
    mq?.removeEventListener('change', onChange);
  };
}

function read(): 'dark' | 'light' {
  const theme = document.documentElement.getAttribute('data-theme');
  if (theme === 'dark' || theme === 'light') return theme;
  const list = document.documentElement.classList;
  if (list.contains('dark')) return 'dark';
  if (list.contains('light')) return 'light';
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

const onServer = () => 'dark' as const;

export function useSurfaceTheme(theme: SurfaceTheme = 'auto'): 'dark' | 'light' {
  const resolved = useSyncExternalStore(subscribe, read, onServer);
  return theme === 'auto' ? resolved : theme;
}
