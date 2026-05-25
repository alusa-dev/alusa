import { VerticalGridLines } from '@/features/site/components/layout/VerticalGridLines';
import { ScrollReveal } from '@/features/site/components/motion/ScrollReveal';
import { homePage } from '@/features/site/content/home';

export function ProductSection() {
  return (
    <section id="modulos" className="relative bg-white py-section sm:py-section-lg">
      <VerticalGridLines />
      <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="max-w-2xl">
          <h2 className="mt-4 font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-normal leading-[1.2] tracking-tight text-alusa-purple-deeper">
            Tudo que sua operação
            <br />
            precisa em um único sistema.
          </h2>
        </ScrollReveal>

        <ScrollReveal delay={120} className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:mt-16">
          {homePage.modules.map((module) => {
            return (
              <article
                key={module.title}
                className="group flex flex-col justify-between rounded-3xl bg-alusa-purple-tint/40 p-10 transition-all duration-300 hover:bg-alusa-purple-tint/70"
              >
                <div>
                  <h3 className="whitespace-pre-line font-display text-2xl font-bold leading-tight tracking-tight text-alusa-purple-deeper sm:text-3xl">
                    {module.title}
                  </h3>
                </div>
                <p className="mt-10 text-sm font-medium leading-relaxed text-alusa-purple-muted sm:text-base">
                  {module.description}
                </p>
              </article>
            );
          })}
        </ScrollReveal>
      </div>
    </section>
  );
}
