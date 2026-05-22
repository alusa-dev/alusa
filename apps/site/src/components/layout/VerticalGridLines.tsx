/** Guias verticais de layout — ficam atrás do conteúdo (z-0) em cada seção. */
export function VerticalGridLines() {
  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 z-0">
      <div className="relative mx-auto h-full max-w-7xl">
        {/* fundos escuros */}
        <div className="absolute inset-y-0 left-[calc(1.5rem-55px)] w-px bg-white/10 sm:left-[calc(2rem-55px)]" />
        <div className="absolute inset-y-0 right-[calc(1.5rem-55px)] w-px bg-white/10 sm:right-[calc(2rem-55px)]" />
        {/* fundos claros */}
        <div className="absolute inset-y-0 left-[calc(1.5rem-55px)] w-px bg-alusa-grid-line-light sm:left-[calc(2rem-55px)]" />
        <div className="absolute inset-y-0 right-[calc(1.5rem-55px)] w-px bg-alusa-grid-line-light sm:right-[calc(2rem-55px)]" />
      </div>
    </div>
  );
}
