import { homePage } from '@/content/home';
import { DashboardMock } from '@/components/visual/DashboardMock';

export function ProblemSection() {
  const { problem } = homePage;

  return (
    <section className="bg-white border-b border-alusa-purple-dark/5 overflow-hidden">
      <div className="lg:grid lg:grid-cols-[1.2fr_0.9fr] lg:items-stretch">
        {/* Lado Esquerdo: Texto - Alinhado com o Hero (max-w-7xl + px-6/sm:px-8) */}
        <div className="flex justify-end lg:items-center">
          <div className="w-full max-w-[calc(1280px*0.6)] px-6 py-20 sm:px-8 lg:py-32 xl:pr-16">
            <div className="max-w-3xl">
              <h2 className="font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-normal leading-[1.2] tracking-tight text-alusa-purple-deeper mb-5">
                {problem.title}
              </h2>

              <p className="text-lg leading-relaxed text-alusa-purple-muted sm:text-xl sm:leading-8 max-w-2xl">
                A Alusa centraliza gestão acadêmica, financeira e operacional para eliminar retrabalho, reduzir atrasos e dar mais controle à rotina da sua escola.
              </p>
            </div>
          </div>
        </div>

        {/* Lado Direito: Box Cinza encostado no canto superior direito sem padding */}
        <div className="hidden justify-end lg:flex lg:h-full lg:pt-16">
          <div className="h-[480px] w-full bg-[#f2f2f2] rounded-tl-[2.5rem] lg:h-full lg:min-h-[720px] shadow-2xl shadow-alusa-purple/10 overflow-hidden border border-[#e6e4ea]">
            <DashboardMock />
          </div>
        </div>
      </div>
    </section>
  );
}
