import { homePage } from '@/features/site/content/home';
import { VerticalGridLines } from '@/features/site/components/layout/VerticalGridLines';
import { PreviewSlideIn } from '@/features/site/components/motion/PreviewSlideIn';
import { ScrollReveal } from '@/features/site/components/motion/ScrollReveal';
import { DashboardMock } from '@/features/site/components/visual/DashboardMock';

export function ProblemSection() {
  const { problem } = homePage;

  return (
    <section className="relative overflow-hidden border-b border-alusa-grid-line-light bg-white">
      <VerticalGridLines />
      <div className="relative z-10 lg:grid lg:grid-cols-[1.2fr_0.9fr] lg:items-stretch">
        <div className="flex justify-end lg:items-center">
          <div className="w-full max-w-[calc(1280px*0.6)] px-6 py-20 sm:px-8 lg:py-32 xl:pr-16">
            <ScrollReveal className="max-w-3xl">
              <h2 className="mb-5 font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-normal leading-[1.2] tracking-tight text-alusa-purple-deeper">
                {problem.title}
              </h2>
              <p className="max-w-2xl text-lg leading-relaxed text-alusa-purple-muted sm:text-xl sm:leading-8">
                A Alusa centraliza gestão acadêmica, financeira e operacional para eliminar retrabalho,
                reduzir atrasos e dar mais controle à rotina da sua escola.
              </p>
            </ScrollReveal>
          </div>
        </div>

        <PreviewSlideIn className="hidden justify-end lg:flex lg:h-full lg:pt-16">
          <div className="h-[480px] w-full overflow-hidden rounded-tl-[2.5rem] border border-[#e6e4ea] bg-[#f2f2f2] shadow-2xl shadow-alusa-purple/10 lg:h-full lg:min-h-[720px]">
            <DashboardMock />
          </div>
        </PreviewSlideIn>
      </div>
    </section>
  );
}
