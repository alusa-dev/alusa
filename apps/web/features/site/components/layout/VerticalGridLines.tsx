export function VerticalGridLines({
  showSidebarLine = false,
  tone = 'light'
}: {
  showSidebarLine?: boolean;
  tone?: 'light' | 'dark';
}) {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      <div className="relative mx-auto h-full max-w-7xl">
        {tone === 'dark' ? (
          <>
            {/* fundos escuros */}
            <div className="absolute inset-y-0 left-[calc(1.5rem-55px)] w-px bg-white/10 sm:left-[calc(2rem-55px)]" />
            <div className="absolute inset-y-0 right-[calc(1.5rem-55px)] w-px bg-white/10 sm:right-[calc(2rem-55px)]" />
            {showSidebarLine && <div className="hidden absolute inset-y-0 left-[240px] w-px bg-white/10 lg:block" />}
          </>
        ) : (
          <>
            {/* fundos claros */}
            <div className="absolute inset-y-0 left-[calc(1.5rem-55px)] w-px bg-slate-200 sm:left-[calc(2rem-55px)]" />
            <div className="absolute inset-y-0 right-[calc(1.5rem-55px)] w-px bg-slate-200 sm:right-[calc(2rem-55px)]" />
            {showSidebarLine && <div className="hidden absolute inset-y-0 left-[240px] w-px bg-slate-200 lg:block" />}
          </>
        )}
      </div>
    </div>
  );
}
