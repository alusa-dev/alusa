'use client';

import { homePage } from '@/content/home';

export function ProofStrip() {
  const items = [...homePage.proof.items, ...homePage.proof.items, ...homePage.proof.items];

  return (
    <div className="w-full overflow-hidden relative group">
      {/* Side Masks for Fade Effect */}
      <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#1F1266] to-transparent z-20 pointer-events-none"></div>
      <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#1F1266] to-transparent z-20 pointer-events-none"></div>

      <div className="flex animate-[scroll_40s_linear_infinite] whitespace-nowrap gap-12 sm:gap-20 items-center">
        {items.map((item, i) => (
          <div
            key={`${item}-${i}`}
            className="flex items-center text-xs sm:text-sm font-bold text-white/40 tracking-[0.2em] uppercase transition-colors hover:text-white/80"
          >
            {item}
          </div>
        ))}
      </div>

      <style jsx global>{`
        @keyframes scroll {
          0% { transform: translateX(0); }
          100% { transform: translateX(-33.33%); }
        }
      `}</style>
    </div>
  );
}
