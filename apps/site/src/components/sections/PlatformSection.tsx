import { homePage } from '@/content/home';
import { ChargesPreviewCard } from '@/components/visual/ChargesPreviewCard';

export function PlatformSection() {
  const { financial } = homePage;

  return (
    <section id="financeiro" className="bg-[#1F1266] py-section text-white sm:py-section-lg relative overflow-hidden">
      <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-6 sm:px-8 lg:grid-cols-[minmax(0,0.9fr)_minmax(520px,1.1fr)] lg:gap-14">
        <div className="max-w-[760px]">
          <h2 className="max-w-[720px] font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {financial.title}
          </h2>
          <p className="mt-6 max-w-[780px] text-base leading-7 text-white/70 sm:text-lg sm:leading-8">
            {financial.body}
          </p>
        </div>

        <div className="lg:-mr-36">
          <ChargesPreviewCard />
        </div>
      </div>
    </section>
  );
}
