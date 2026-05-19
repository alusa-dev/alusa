import { homePage } from '@/content/home';
import { ArrowRight } from '@/components/icons/icons';

export function FlowSection() {
  const { flow } = homePage;

  return (
    <section className="bg-alusa-purple-deeper py-section text-white sm:py-section-lg relative overflow-hidden">
      <div className="relative mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">Fluxo operacional</p>
          <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {flow.title}
          </h2>
          <p className="mt-5 text-base leading-7 text-white/65 sm:text-lg sm:leading-8">
            {flow.body}
          </p>
        </div>

        <div className="mt-14 flex flex-wrap items-start gap-4">
          {flow.steps.map((step, i) => {
            const Icon = step.icon;
            return (
              <div key={step.label} className="flex items-center gap-4">
                <div className="flex flex-col items-center gap-2">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-white/15 bg-white/8 backdrop-blur-sm">
                    <Icon className="h-5 w-5 text-white" aria-hidden="true" />
                  </div>
                  <span className="text-xs font-medium text-white/70 text-center max-w-[80px] leading-tight">
                    {step.label}
                  </span>
                </div>
                {i < flow.steps.length - 1 && (
                  <ArrowRight className="h-4 w-4 text-white/30 flex-shrink-0 mb-5" aria-hidden="true" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
