import { homePage } from '@/content/home';

import { VerticalGridLines } from '@/components/layout/VerticalGridLines';
import { ScrollReveal } from '@/components/motion/ScrollReveal';

export function BenefitsSection() {
  const { benefits } = homePage;

  return (
    <section className="relative border-b border-alusa-grid-line-light bg-white py-section sm:py-section-lg">
      <VerticalGridLines />
      <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-alusa-purple">Benefícios</p>
          <h2 className="mt-4 font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-normal leading-[1.2] tracking-tight text-alusa-purple-deeper">
            {benefits.title}
          </h2>
        </ScrollReveal>

        <ScrollReveal delay={120} className="mt-12 grid gap-5 sm:grid-cols-2 lg:mt-14">
          {benefits.items.map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-alusa-purple-dark/5 bg-alusa-purple-tint/30 p-8 transition-all duration-300 hover:bg-alusa-purple-tint/60"
            >
              <h3 className="font-display text-xl font-semibold text-alusa-purple-deeper">{item.title}</h3>
              <p className="mt-3 text-base leading-relaxed text-alusa-purple-muted">{item.body}</p>
            </article>
          ))}
        </ScrollReveal>
      </div>
    </section>
  );
}
