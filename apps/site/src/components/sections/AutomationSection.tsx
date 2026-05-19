import { homePage } from '@/content/home';
import { ShieldCheck } from '@/content/home';

export function AutomationSection() {
  const { automation } = homePage;

  return (
    <section className="bg-white py-section sm:py-section-lg border-b border-alusa-purple-dark/5">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="grid gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center lg:gap-16">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-alusa-purple">Automação</p>
            <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-alusa-purple-deeper sm:text-4xl">
              {automation.title}
            </h2>
            <p className="mt-6 text-base leading-7 text-alusa-purple-muted sm:text-lg sm:leading-8">
              {automation.body}
            </p>
          </div>

          <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {automation.bullets.map((bullet) => (
              <li
                key={bullet}
                className="flex items-center gap-3 rounded-xl border border-alusa-purple-dark/5 bg-alusa-purple-tint/40 px-4 py-3.5"
              >
                <ShieldCheck className="h-4 w-4 flex-shrink-0 text-alusa-purple" aria-hidden="true" />
                <span className="text-sm font-medium text-alusa-purple-deeper">{bullet}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
