'use client';

import { useId, useState } from 'react';
import { VerticalGridLines } from '@/features/site/components/layout/VerticalGridLines';
import { ScrollReveal } from '@/features/site/components/motion/ScrollReveal';
import { Plus, X } from '@/features/site/components/icons/icons';
import { homePage } from '@/features/site/content/home';
import { cn } from '@/features/site/lib/cn';

function FaqAccordion() {
  const { items } = homePage.faq;
  const baseId = useId();
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  return (
    <div className="overflow-hidden rounded-2xl border border-alusa-purple-dark/10 bg-white">
      {items.map((item, index) => {
        const isOpen = openIndex === index;
        const panelId = `${baseId}-panel-${index}`;
        const triggerId = `${baseId}-trigger-${index}`;

        return (
          <div key={item.question} className="border-t border-alusa-purple-dark/10 first:border-t-0">
            <button
              type="button"
              id={triggerId}
              aria-expanded={isOpen}
              aria-controls={panelId}
              onClick={() => setOpenIndex(isOpen ? null : index)}
              className="flex w-full items-start gap-4 px-5 py-5 text-left transition-colors hover:bg-alusa-purple-tint/40 sm:gap-5 sm:px-6 sm:py-6"
            >
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center text-alusa-purple" aria-hidden="true">
                {isOpen ? <X className="h-5 w-5" /> : <Plus className="h-5 w-5" />}
              </span>
              <span className="font-display text-base font-semibold leading-snug text-alusa-purple-deeper sm:text-lg">
                {item.question}
              </span>
            </button>
            <div
              id={panelId}
              role="region"
              aria-labelledby={triggerId}
              hidden={!isOpen}
              className={cn(!isOpen && 'hidden')}
            >
              <div className="space-y-3 border-t border-alusa-purple-dark/5 px-5 pb-6 pt-4 pl-[3.25rem] pr-5 sm:px-6 sm:pb-7 sm:pt-5 sm:pl-[3.75rem]">
                {item.answer.split('\n\n').map((paragraph) => (
                  <p
                    key={paragraph.slice(0, 32)}
                    className="text-sm leading-7 text-alusa-purple-muted sm:text-base"
                  >
                    {paragraph}
                  </p>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function FaqSection() {
  const { faq } = homePage;
  const [faqTitleFirstLine, faqTitleSecondLine] = faq.title.split('\n');
  const faqTitleQuestionEnd = faqTitleFirstLine.indexOf('?');
  const faqTitleHighlight =
    faqTitleQuestionEnd >= 0 ? faqTitleFirstLine.slice(0, faqTitleQuestionEnd + 1) : faqTitleFirstLine;
  const faqTitleFirstLineRest =
    faqTitleQuestionEnd >= 0 ? faqTitleFirstLine.slice(faqTitleQuestionEnd + 1) : '';

  return (
    <section id="contato" className="relative overflow-hidden border-t border-alusa-grid-line-light bg-white py-section sm:py-section-lg">
      <VerticalGridLines />
      <div className="relative z-10 mx-auto max-w-7xl px-6 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-start lg:gap-14 xl:gap-16">
          <ScrollReveal className="min-w-0 lg:sticky lg:top-28">
            <h2 className="font-display text-[clamp(1.75rem,3.4vw,2.5rem)] font-normal leading-[1.2] tracking-tight text-alusa-purple-deeper">
              <span className="block whitespace-nowrap">
                <span className="text-[#1F1266]">{faqTitleHighlight}</span>
                {faqTitleFirstLineRest}
              </span>
              <span className="block whitespace-nowrap">{faqTitleSecondLine}</span>
            </h2>
            <p className="mt-5 text-base leading-7 text-alusa-purple-muted sm:text-lg">
              {faq.description}
            </p>
          </ScrollReveal>
          <ScrollReveal delay={120}>
            <FaqAccordion />
          </ScrollReveal>
        </div>
      </div>
    </section>
  );
}
