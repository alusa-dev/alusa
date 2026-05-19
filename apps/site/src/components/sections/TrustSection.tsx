import { homePage } from '@/content/home';
import { ButtonLink } from '@/components/ui/ButtonLink';

export function TrustSection() {
  const { trust, cta } = homePage;

  return (
    <section id="seguranca" className="bg-alusa-purple-tint py-section sm:py-section-lg relative overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 sm:px-8 relative z-10">
        <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr] lg:items-end lg:gap-10">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-alusa-purple">{trust.eyebrow}</p>
            <h2 className="mt-4 font-display text-4xl font-bold leading-[1.1] tracking-tight text-alusa-purple-deeper sm:text-5xl">
              {trust.title}
            </h2>
          </div>
          <p className="text-base leading-7 text-alusa-purple-muted sm:text-lg sm:leading-8 pb-2">
            {trust.body}
          </p>
        </div>

        <div className="mt-14 grid gap-5 lg:mt-16 lg:grid-cols-3">
          {trust.items.map((item) => (
            <article
              key={item.title}
              className="group rounded-2xl border border-alusa-purple-dark/5 bg-white p-8 shadow-sm transition-all duration-300 hover:shadow-lg hover:-translate-y-1 relative"
            >
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-alusa-purple to-indigo-400 opacity-0 group-hover:opacity-100 transition-opacity rounded-t-2xl"></div>
              <h3 className="font-display text-xl font-semibold text-alusa-purple-deeper tracking-tight">{item.title}</h3>
              <p className="mt-4 text-sm leading-relaxed text-alusa-purple-muted/80 sm:text-base">{item.body}</p>
            </article>
          ))}
        </div>

        <div
          id="contato"
          className="mt-16 overflow-hidden relative grid gap-8 rounded-3xl bg-alusa-purple-deeper p-8 text-white sm:p-12 lg:mt-20 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-12"
        >
          <div className="absolute inset-0 z-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAiIGhlaWdodD0iMjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGNpcmNsZSBjeD0iMiIgY3k9IjIiIHI9IjEiIGZpbGw9InJnYmEoMjU1LDI1NSwyNTUsMC4wNykiLz48L3N2Zz4=')] [mask-image:linear-gradient(to_bottom_right,white,transparent)]"></div>
          
          <div className="relative z-10">
            <h2 className="font-display text-3xl font-bold leading-tight tracking-tight sm:text-4xl text-white">
              {cta.title}
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-white/70 sm:text-lg">
              {cta.body}
            </p>
          </div>
          <div className="relative z-10 flex flex-col gap-3 sm:flex-row">
            {cta.ctas.map((ctaItem, i) => (
              <ButtonLink
                key={ctaItem.href + i}
                href={ctaItem.href}
                variant={i === 0 ? 'primary' : 'ghost'}
                tone="dark"
                event="contact_cta_clicked"
                className={`h-12 px-6 text-base font-medium ${
                  i === 0
                    ? 'bg-white text-alusa-purple-deeper hover:bg-white/90 shadow-none'
                    : 'border border-white/20 text-white hover:bg-white/10'
                }`}
              >
                {ctaItem.label}
              </ButtonLink>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
