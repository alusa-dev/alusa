import type { Metadata } from 'next';
import Image from 'next/image';

export const metadata: Metadata = {
  title: 'Ajuda',
};

type HelpCardProps = {
  title: string;
  description: string;
  image?: string;
  imageAlt?: string;
};

function HelpCard({ title, description, image, imageAlt = '' }: HelpCardProps) {
  const hasImage = Boolean(image);

  return (
    <section
      style={{ transition: 'transform 650ms cubic-bezier(0.22, 0.61, 0.36, 1)' }}
      className={`relative flex aspect-square flex-col items-start justify-end overflow-hidden rounded-lg p-8 text-left hover:z-10 hover:scale-[1.045] motion-reduce:transform-none ${
        hasImage ? 'text-white' : 'bg-gray-50 alusa-dark:bg-[color:var(--color-bg-card)]'
      }`}
    >
      {image ? (
        <>
          <div className="absolute inset-0">
            <Image src={image} alt={imageAlt} fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover object-center" />
          </div>
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/25 to-transparent"
          />
        </>
      ) : null}
      <div className="relative z-10 space-y-3">
        <h2
          className={`text-xl font-semibold leading-tight ${
            hasImage ? 'text-white' : 'text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]'
          }`}
        >
          {title}
        </h2>
        <p
          className={`text-sm leading-6 ${
            hasImage ? 'text-white/90' : 'text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]'
          }`}
        >
          {description}
        </p>
      </div>
    </section>
  );
}

export default function AjudaPage() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center gap-8 py-8">
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold text-gray-900 alusa-dark:text-[color:var(--color-text-primary)]">
          Como podemos ajudar você?
        </h1>
        <p className="text-sm text-gray-600 alusa-dark:text-[color:var(--color-text-secondary)]">
          Encontre respostas rápidas ou entre em contato com nosso time de suporte.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
        <HelpCard
          title="Fale com o suporte"
          description="Nossa equipe pode ajudar. Ao escrever, informe sua escola e descreva o que aconteceu."
          image="/images/help/remote-support.webp"
          imageAlt="Profissional de suporte atendendo pelo computador"
        />
        <HelpCard
          title="Central de ajuda"
          description="Encontre orientações para usar os recursos da plataforma e esclarecer dúvidas do dia a dia."
          image="/images/help/help-center.webp"
          imageAlt="Lupa sobre um livro aberto em tons de púrpura"
        />
        <HelpCard
          title="Blog da Alusa"
          description="Acompanhe novidades, dicas e conteúdos sobre educação e gestão escolar."
          image="/images/help/alusa-blog.webp"
          imageAlt="Notebook exibindo um blog ilustrado em tons de púrpura"
        />
      </div>

    </div>
  );
}
