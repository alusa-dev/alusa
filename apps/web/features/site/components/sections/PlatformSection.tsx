import { homePage } from '@/features/site/content/home';
import { VerticalGridLines } from '@/features/site/components/layout/VerticalGridLines';
import { PreviewSlideIn } from '@/features/site/components/motion/PreviewSlideIn';
import { ScrollReveal } from '@/features/site/components/motion/ScrollReveal';
import { ChargesPreviewCard } from '@/features/site/components/visual/ChargesPreviewCard';
import { SITE_SECTION_SCROLL_MARGIN_CLASS } from '@/features/site/lib/sections';

export function PlatformSection() {
  const { financial } = homePage;
  const [financialTitleFirstLine, financialTitleSecondLine] = financial.title.split('\n');

  return (
    <section
      id="financeiro"
      className={`relative bg-[#430D88] py-section text-white sm:py-section-lg ${SITE_SECTION_SCROLL_MARGIN_CLASS}`}
    >
      <VerticalGridLines />
      <div className="relative z-10 mx-auto grid max-w-7xl items-center gap-12 px-6 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)] lg:gap-14">
        <ScrollReveal className="max-w-[760px]">
          <h2 className="max-w-[720px] font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-normal leading-[1.2] tracking-tight">
            {financialTitleFirstLine}
            <br />
            {financialTitleSecondLine}
          </h2>
          <p className="mt-6 max-w-[780px] text-base leading-7 text-white/70 sm:text-lg sm:leading-8">
            {financial.body}
          </p>
        </ScrollReveal>

        <PreviewSlideIn className="lg:-mr-36">
          <ChargesPreviewCard />
        </PreviewSlideIn>
      </div>
    </section>
  );
}
