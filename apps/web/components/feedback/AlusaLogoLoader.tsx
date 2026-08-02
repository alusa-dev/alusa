import React from 'react';
import type { HTMLAttributes } from 'react';

import { cn } from '@/lib/utils';

type AlusaLogoLoaderProps = HTMLAttributes<HTMLDivElement> & {
  fullScreen?: boolean;
};

export function AlusaLogoLoader({
  fullScreen = false,
  className,
  ...props
}: AlusaLogoLoaderProps): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="Carregando"
      className={cn(
        'flex items-center justify-center bg-white',
        fullScreen ? 'fixed inset-0 z-50 min-h-dvh' : 'min-h-40 w-full',
        className,
      )}
      {...props}
    >
      <span
        data-testid="alusa-loader-logo"
        aria-hidden="true"
        className="block aspect-[1734.07/527.81] w-32 bg-[#dfe4e9] animate-pulse [mask-image:url('/brand/logo-sidebar-mask.svg')] [mask-position:center] [mask-repeat:no-repeat] [mask-size:contain] motion-reduce:animate-none motion-reduce:opacity-70 sm:w-36"
      />
    </div>
  );
}
