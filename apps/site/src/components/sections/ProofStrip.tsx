'use client';

import { homePage } from '@/content/home';

function ProofStripTrack({
  items,
  copyIndex
}: {
  items: readonly string[];
  copyIndex: number;
}) {
  return (
    <div
      className="flex shrink-0 items-center gap-12 pr-12 sm:gap-20 sm:pr-20"
      aria-hidden={copyIndex === 1 ? true : undefined}
    >
      {items.map((item) => (
        <div
          key={`${copyIndex}-${item}`}
          className="flex items-center whitespace-nowrap text-xs font-bold uppercase tracking-[0.2em] text-white/40 transition-colors hover:text-white/80 sm:text-sm"
        >
          {item}
        </div>
      ))}
    </div>
  );
}

export function ProofStrip() {
  const items = homePage.proof.items;

  return (
    <div className="group relative w-full overflow-hidden">
      <div className="pointer-events-none absolute inset-y-0 left-0 z-20 w-32 bg-gradient-to-r from-[var(--alusa-purple-dark)] to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-20 w-32 bg-gradient-to-l from-[var(--alusa-purple-dark)] to-transparent" />

      <div className="flex w-max animate-proof-strip">
        <ProofStripTrack items={items} copyIndex={0} />
        <ProofStripTrack items={items} copyIndex={1} />
      </div>
    </div>
  );
}
