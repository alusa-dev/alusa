import { homePage } from '@/features/site/content/home';
import { ScrollReveal } from '@/features/site/components/motion/ScrollReveal';
import { VerticalGridLines } from '@/features/site/components/layout/VerticalGridLines';

export function HighlightsSection() {
  return (
    <section
      aria-label="Benefícios da Alusa"
      className="relative overflow-hidden border-b border-alusa-grid-line-light bg-white"
    >
      <VerticalGridLines />

      <div className="relative z-10 mx-auto grid max-w-7xl px-6 sm:px-8 md:grid-cols-3 lg:max-w-[82.875rem] lg:px-0">
        {homePage.highlights.map((highlight, index) => (
          <ScrollReveal key={highlight.title} delay={index * 100} className="h-full">
            <article
              className={`flex min-h-[26rem] flex-col justify-end border-alusa-purple-deeper/10 px-7 py-9 sm:px-9 sm:py-10 md:min-h-[30rem] md:border-r md:px-8 lg:px-9 ${
                index === 0
                  ? 'bg-[#e7ddf1]'
                  : index === 1
                    ? 'bg-[#f7f4fb]'
                    : 'bg-[#e7ddf1] md:border-r-0'
              }`}
            >
              <div className="max-w-[14rem]">
                <h2
                  className={`font-display text-[1.2rem] font-medium leading-tight tracking-[-0.02em] text-alusa-purple-deeper ${
                    index === 2 ? 'whitespace-nowrap' : ''
                  }`}
                >
                  {highlight.title}
                </h2>
                <p className="mt-3 max-w-[15rem] text-sm leading-[1.25] text-alusa-purple-deeper/75">
                  {highlight.description}
                </p>
              </div>
            </article>
          </ScrollReveal>
        ))}
      </div>
    </section>
  );
}
