import { homePage } from '@/content/home';
import { VerticalGridLines } from '@/components/layout/VerticalGridLines';
import { ScrollReveal } from '@/components/motion/ScrollReveal';
import { ButtonLink } from '@/components/ui/ButtonLink';
import { cn } from '@/lib/cn';
import { ProofStrip } from './ProofStrip';

export function HeroSection() {
  return (
    <section className="relative overflow-hidden bg-[var(--alusa-purple-dark)] text-white">
      <VerticalGridLines />
      <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-8 flex min-h-[75vh] flex-col justify-center py-20 lg:py-32">
        <ScrollReveal onMount className="max-w-4xl py-12">
          <h1 className="mt-8 font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-normal leading-[1.2] tracking-tight text-white mb-5">
            {homePage.hero.title}
            <br />
            {homePage.hero.accent}
          </h1>

          <p className="text-lg leading-relaxed text-white/70 sm:text-xl sm:leading-8 max-w-2xl">
            {homePage.hero.description}
          </p>

          <div className="mt-10 flex flex-col gap-4 sm:flex-row sm:items-center justify-start">
            {homePage.hero.ctas.map((cta, i) => (
              <ButtonLink
                key={cta.href}
                href={cta.href}
                variant={i === 0 ? 'primary' : 'secondary'}
                tone="dark"
                event={cta.href.startsWith('mailto:') ? 'sales_cta_clicked' : 'hero_cta_clicked'}
                className={cn(
                  'h-12 w-full rounded-full text-sm font-medium sm:w-auto sm:min-w-[12rem]',
                  i === 0 ? 'bg-white text-[#430D88] shadow-none' : 'border border-white/20 text-white'
                )}
              >
                {cta.label}
              </ButtonLink>
            ))}
          </div>
        </ScrollReveal>

        {/* Floating Loop Proof Strip */}
        <ScrollReveal onMount delay={180} className="absolute bottom-12 left-0 right-0 z-20 md:bottom-16">
          <ProofStrip />
        </ScrollReveal>
      </div>
    </section>
  );
}
