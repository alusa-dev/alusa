'use client';

import { useEffect, useRef, type MouseEvent } from 'react';

import { Check } from '@/features/site/components/icons/icons';
import { homePage } from '@/features/site/content/home';

import { VerticalGridLines } from '@/features/site/components/layout/VerticalGridLines';
import { ScrollReveal } from '@/features/site/components/motion/ScrollReveal';

const LEFT_STAGGER = ['translate-x-4', '-translate-x-3', 'translate-x-2'] as const;
const RIGHT_STAGGER = ['-translate-x-4', 'translate-x-3', '-translate-x-2'] as const;
const SPOTLIGHT_RADIUS = 220;
const SPOTLIGHT_LERP = 0.14;

const SPOTLIGHT_MASK =
  'radial-gradient(circle var(--spotlight-r, 0px) at var(--spotlight-x, 50%) var(--spotlight-y, 50%), transparent 0%, transparent 48%, black 100%)';

function AutomationPill({ label }: { label: string }) {
  return (
    <div className="inline-flex items-center gap-2 whitespace-nowrap rounded-full border border-alusa-purple-dark/8 bg-white px-2.5 py-1.5 shadow-soft transition-[transform,box-shadow] duration-300 ease-out hover:scale-[1.04] hover:shadow-md sm:px-3 sm:py-2">
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#c9f3d7] text-[#18733b]">
        <Check className="h-3.5 w-3.5" strokeWidth={2.5} />
      </span>
      <span className="text-sm font-medium text-alusa-purple-deeper">{label}</span>
    </div>
  );
}

export function AutomationSection() {
  const { automation } = homePage;
  const [titleFirstLine, titleSecondLine] = automation.title.split('\n');
  const bodyLines = automation.body.split('\n');
  const leftBullets = automation.bullets.slice(0, 3);
  const rightBullets = automation.bullets.slice(3);

  const sectionRef = useRef<HTMLElement>(null);
  const maskRef = useRef<HTMLDivElement>(null);
  const target = useRef({ x: 0, y: 0 });
  const current = useRef({ x: 0, y: 0 });
  const radiusTarget = useRef(0);
  const radiusCurrent = useRef(0);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    let frame = 0;
    const tick = () => {
      current.current.x += (target.current.x - current.current.x) * SPOTLIGHT_LERP;
      current.current.y += (target.current.y - current.current.y) * SPOTLIGHT_LERP;
      radiusCurrent.current += (radiusTarget.current - radiusCurrent.current) * SPOTLIGHT_LERP;

      const mask = maskRef.current;
      if (mask) {
        mask.style.setProperty('--spotlight-x', `${current.current.x}px`);
        mask.style.setProperty('--spotlight-y', `${current.current.y}px`);
        mask.style.setProperty('--spotlight-r', `${radiusCurrent.current}px`);
      }

      frame = requestAnimationFrame(tick);
    };

    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const handleMouseMove = (event: MouseEvent<HTMLElement>) => {
    const rect = sectionRef.current?.getBoundingClientRect();
    if (!rect) return;

    target.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top
    };
    radiusTarget.current = SPOTLIGHT_RADIUS;
  };

  const handleMouseLeave = () => {
    radiusTarget.current = 0;
  };

  return (
    <section
      ref={sectionRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative overflow-hidden border-b border-alusa-grid-line-light bg-white py-16 sm:py-20 lg:py-28"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 z-0 [background-image:radial-gradient(#d4d4d4_1px,transparent_1px)] [background-size:20px_20px]"
      />
      <div
        ref={maskRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 z-[1] bg-white"
        style={{
          maskImage: SPOTLIGHT_MASK,
          WebkitMaskImage: SPOTLIGHT_MASK
        }}
      />
      <VerticalGridLines />
      <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-8">
        <ScrollReveal className="mx-auto grid w-full max-w-7xl items-center gap-12 py-4 sm:py-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,42rem)_minmax(0,1fr)] lg:gap-6 lg:py-8 xl:gap-8">
          <ul
            className="hidden flex-col items-end gap-6 lg:flex lg:gap-8 xl:gap-10"
            aria-label="Recursos de automação — coluna esquerda"
          >
            {leftBullets.map((bullet, index) => (
              <li key={bullet} className={LEFT_STAGGER[index] ?? ''}>
                <AutomationPill label={bullet} />
              </li>
            ))}
          </ul>

          <div className="mx-auto flex w-full min-w-0 flex-col items-center text-center lg:max-w-[42rem]">
            <h2 className="font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-normal leading-[1.2] tracking-tight text-alusa-purple-deeper">
              {titleFirstLine}
              <br />
              {titleSecondLine}
            </h2>
            <p className="mt-5 w-full text-base leading-relaxed text-alusa-purple-muted sm:text-lg sm:leading-7">
              {bodyLines.map((line) => (
                <span key={line} className="block">
                  {line}
                </span>
              ))}
            </p>
          </div>

          <ul
            className="hidden flex-col items-start gap-6 lg:flex lg:gap-8 xl:gap-10"
            aria-label="Recursos de automação — coluna direita"
          >
            {rightBullets.map((bullet, index) => (
              <li key={bullet} className={RIGHT_STAGGER[index] ?? ''}>
                <AutomationPill label={bullet} />
              </li>
            ))}
          </ul>

          <ul
            className="col-span-full flex flex-wrap justify-center gap-3 sm:gap-4 lg:hidden"
            aria-label="Recursos de automação"
          >
            {automation.bullets.map((bullet) => (
              <li key={bullet}>
                <AutomationPill label={bullet} />
              </li>
            ))}
          </ul>
        </ScrollReveal>
      </div>
    </section>
  );
}
