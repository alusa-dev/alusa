import React from 'react';
import type { LegalPageContent } from '@/features/site/content/legal';

export function LegalPage({ content }: { content: LegalPageContent }) {
  return (
    <article className="bg-white text-[#1d1230]">
      <header className="border-b border-slate-200 bg-[#f8f5ff]">
        <div className="mx-auto max-w-4xl px-6 py-16 sm:px-8 lg:py-20">
          <p className="text-sm font-semibold uppercase tracking-[0.16em] text-[#6b3bb1]">
            Versao {content.version}
          </p>
          <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-5xl">{content.title}</h1>
          <p className="mt-5 max-w-3xl text-lg leading-relaxed text-slate-700">{content.intro}</p>
          <p className="mt-5 text-sm font-medium text-slate-500">Ultima atualizacao: {content.updatedAt}</p>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-6 py-12 sm:px-8 lg:py-16">
        <div className="space-y-10">
          {content.sections.map((section) => (
            <section key={section.title} className="border-b border-slate-200 pb-8 last:border-b-0">
              <h2 className="text-2xl font-semibold tracking-tight text-[#2a1744]">{section.title}</h2>
              <div className="mt-4 space-y-4 text-base leading-8 text-slate-700">
                {section.body.map((paragraph) => (
                  <p key={paragraph}>{paragraph}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}
