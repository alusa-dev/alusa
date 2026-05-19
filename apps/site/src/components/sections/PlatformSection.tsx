import { homePage } from '@/content/home';
import { ArrowRight } from '@/components/icons/icons';

export function PlatformSection() {
  const { financial } = homePage;

  return (
    <section id="financeiro" className="bg-alusa-purple-deeper py-section text-white sm:py-section-lg relative overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-3xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">
            {financial.eyebrow}
          </p>
          <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {financial.title}
          </h2>
          <div className="mt-6 space-y-4">
            {financial.body.map((paragraph, i) => (
              <p key={i} className="text-base leading-7 text-white/70 sm:text-lg sm:leading-8">
                {paragraph}
              </p>
            ))}
          </div>
        </div>

        <div className="mt-14 flex flex-wrap items-center gap-3 sm:gap-0">
          {financial.steps.map((step, i) => (
            <div key={step} className="flex items-center gap-3">
              <div className="rounded-xl border border-white/15 bg-white/8 px-5 py-3 text-sm font-medium text-white backdrop-blur-sm">
                {step}
              </div>
              {i < financial.steps.length - 1 && (
                <ArrowRight className="h-4 w-4 text-white/40 flex-shrink-0" aria-hidden="true" />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
