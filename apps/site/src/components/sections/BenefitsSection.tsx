import { homePage } from '@/content/home';

export function BenefitsSection() {
  const { benefits } = homePage;

  return (
    <section className="bg-white py-section sm:py-section-lg border-b border-alusa-purple-dark/5">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-alusa-purple">Benefícios</p>
          <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-alusa-purple-deeper sm:text-4xl">
            {benefits.title}
          </h2>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:mt-14">
          {benefits.items.map((item) => (
            <article
              key={item.title}
              className="rounded-2xl border border-alusa-purple-dark/5 bg-alusa-purple-tint/30 p-8 transition-all duration-300 hover:bg-alusa-purple-tint/60"
            >
              <h3 className="font-display text-xl font-semibold text-alusa-purple-deeper">{item.title}</h3>
              <p className="mt-3 text-base leading-relaxed text-alusa-purple-muted">{item.body}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
