import { homePage } from '@/content/home';

export function ProductSection() {
  return (
    <section id="modulos" className="bg-white py-section sm:py-section-lg">
      <div className="mx-auto max-w-7xl px-6 sm:px-8">
        <div className="max-w-2xl">
          <h2 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-alusa-purple-deeper sm:text-4xl">
            Tudo que sua operação
            <br />
            precisa em um único sistema.
          </h2>
        </div>

        <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3 lg:mt-16">
          {homePage.modules.map((module) => {
            return (
              <article
                key={module.title}
                className="group flex flex-col justify-between rounded-3xl bg-alusa-purple-tint/40 p-10 transition-all duration-300 hover:bg-alusa-purple-tint/70"
              >
                <div>
                  <h3 className="font-display text-2xl font-bold leading-tight text-alusa-purple-deeper tracking-tight sm:text-3xl whitespace-pre-line">
                    {module.title}
                  </h3>
                </div>
                <p className="mt-10 text-sm font-medium leading-relaxed text-alusa-purple-muted sm:text-base">
                  {module.description}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
