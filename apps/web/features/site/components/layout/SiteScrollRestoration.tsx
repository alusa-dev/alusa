'use client';

import { useEffect } from 'react';

import { cleanSiteUrlPath, resolveLegacySiteHash } from '@/features/site/lib/scroll-to-section';

export function SiteScrollRestoration() {
  useEffect(() => {
    resolveLegacySiteHash();

    const onHashChange = () => {
      resolveLegacySiteHash();
    };

    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    const onPopState = () => {
      if (!window.location.hash) {
        cleanSiteUrlPath();
      }
    };

    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return null;
}
