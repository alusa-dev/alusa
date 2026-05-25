import { homePage } from '@/features/site/content/home';
import { ArrowRight } from '@/features/site/components/icons/icons';

import { VerticalGridLines } from '@/features/site/components/layout/VerticalGridLines';
import { ScrollReveal } from '@/features/site/components/motion/ScrollReveal';

export function FlowSection() {
  const { flow } = homePage;

  return (
    <section className="relative overflow-hidden bg-alusa-purple-deeper py-section text-white sm:py-section-lg">
      <VerticalGridLines />
      <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-white/60">Fluxo operacional</p>
          <h2 className="mt-4 font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-normal leading-[1.2] tracking-tight">
            {flow.title}
          </h2>
          <p className="mt-5 text-base leading-7 text-white/65 sm:text-lg sm:leading-8">
            {flow.body}
          </p>
        </ScrollReveal>

        <ScrollReveal delay={120} className="mt-14 flex flex-wrap items-start gap-4">
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
        </ScrollReveal>
      </div>
    </section>
  );
}
