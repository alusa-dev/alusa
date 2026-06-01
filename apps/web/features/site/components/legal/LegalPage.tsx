import React from 'react';
import type { LegalPageContent } from '@/features/site/content/legal';
import { VerticalGridLines } from '@/features/site/components/layout/VerticalGridLines';
import { LegalSidebarNav } from '@/features/site/components/legal/LegalSidebarNav';
import Link from 'next/link';
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

export function LegalPage({ content, footer }: { content: LegalPageContent; footer?: React.ReactNode }) {
  return (
    <article className="relative overflow-hidden bg-white text-[#1d1230]">
      <VerticalGridLines showSidebarLine />
      <div className="relative z-10 mx-auto max-w-7xl px-6 py-16 sm:px-8 lg:py-20">
        <div className="grid gap-10 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-12">
          <aside className="lg:sticky lg:top-28 lg:self-start lg:-ml-[35px]">
            <LegalSidebarNav activeHref={`/${content.slug}`} />
          </aside>

          <div className="lg:-ml-[40px] lg:-mr-[55px]">
            <header className="max-w-3xl mx-auto">
              <Breadcrumb className="mb-6">
                <BreadcrumbList>
                  <BreadcrumbItem>
                    <BreadcrumbLink asChild>
                      <Link href="/legal">Legal</Link>
                    </BreadcrumbLink>
                  </BreadcrumbItem>
                  <BreadcrumbSeparator />
                  <BreadcrumbItem>
                    <BreadcrumbPage>{content.title}</BreadcrumbPage>
                  </BreadcrumbItem>
                </BreadcrumbList>
              </Breadcrumb>
              <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">{content.title}</h1>
              <p className="mt-5 max-w-3xl text-lg leading-relaxed text-slate-700">{content.intro}</p>
              <p className="mt-5 text-sm font-medium text-slate-500">Última atualização: {content.updatedAt}</p>
            </header>

            <div className="mt-12 border-t border-slate-200">
              {content.sections.map((section) => (
                <section key={section.title} className="border-b border-slate-200 py-10 sm:py-12">
                  <div className="max-w-3xl mx-auto">
                    <h2 className="text-2xl font-semibold tracking-tight text-[#2a1744]">{section.title}</h2>
                    <div className="mt-4 space-y-4 text-base leading-8 text-slate-700">
                      {section.body.map((paragraph) => (
                        <p key={paragraph}>{paragraph}</p>
                      ))}
                      {section.table && (
                        <div className="mt-6 overflow-x-auto">
                          <table className="min-w-full border-collapse border border-slate-200 text-sm">
                            <thead className="bg-[#f8f5ff]">
                              <tr>
                                {section.table.headers.map((h) => (
                                  <th
                                    key={h}
                                    className="border border-slate-200 px-3 py-2 text-left font-semibold text-[#2a1744]"
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {section.table.rows.map((row, ri) => (
                                <tr key={ri} className="even:bg-slate-50">
                                  {row.map((cell, ci) => (
                                    <td
                                      key={ci}
                                      className="border border-slate-200 px-3 py-2 align-top text-slate-700"
                                    >
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
              ))}
            </div>
            {footer && (
              <div className="border-b border-slate-200 py-10 sm:py-12">
                <div className="max-w-3xl mx-auto">
                  {footer}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
}
