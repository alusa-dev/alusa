import React from 'react';

export interface CustomScrollAreaProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, 'children'> {
  children: React.ReactNode;
  disableInnerWrapper?: boolean;
  contentClassName?: string;
}

export const CustomScrollArea = React.forwardRef<HTMLDivElement, CustomScrollAreaProps>(
  (
    {
      children,
      className = '',
      disableInnerWrapper = false,
      contentClassName = '',
      ...divProps
    },
    ref,
  ) => {
    return (
      <>
        <style jsx>{`
          .custom-scroll-area {
            overflow-y: auto;
            overflow-x: hidden;
            scrollbar-width: thin;
            scrollbar-color: var(--brand-stroke) transparent;
          }

          .custom-scroll-area::-webkit-scrollbar {
            width: 3px;
            height: 3px;
          }

          .custom-scroll-area::-webkit-scrollbar-track {
            background: transparent;
          }

          .custom-scroll-area::-webkit-scrollbar-thumb {
            background-color: var(--brand-stroke);
            border-radius: 999px;
          }

          .custom-scroll-area::-webkit-scrollbar-thumb:hover {
            background-color: var(--brand-muted2);
          }

          .custom-scroll-area::-webkit-scrollbar-button {
            display: none;
            width: 0;
            height: 0;
          }
        `}</style>
        <div ref={ref} className={`custom-scroll-area ${className}`} {...divProps}>
          {disableInnerWrapper ? (
            <>{children}</>
          ) : (
            <div className={`px-1 -mx-1 ${contentClassName}`}>{children}</div>
          )}
        </div>
      </>
    );
  },
);

CustomScrollArea.displayName = 'CustomScrollArea';












