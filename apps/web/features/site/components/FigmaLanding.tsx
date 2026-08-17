import Link from 'next/link';
import type { ReactNode } from 'react';
import { ModalityCarousel } from '@/features/site/components/ModalityCarousel';

const DASHBOARD_IMAGE = '/images/site/figma/dashboard.png';
const SECTION_LINE = '/images/site/figma/section-line.svg';

function PillLink({
  children,
  href,
  variant = 'secondary',
  className = '',
}: {
  children: ReactNode;
  href: string;
  variant?: 'primary' | 'secondary';
  className?: string;
}) {
  return <Link href={href} className={`figma-pill button-${variant} ${className}`}>{children}</Link>;
}

export function FigmaLanding() {
  return (
    <div className="figma-landing">
      <section className="figma-hero">
        <div className="figma-container">
          <div className="figma-hero-copy">
            <h1>
              Sua escola pode ser mais
              <br />
              simples de administrar.
            </h1>
            <div className="figma-hero-actions">
              <PillLink href="#modulos" variant="primary">Conhecer a Alusa</PillLink>
              <PillLink href="/register" variant="secondary">Teste grátis por 14 dias</PillLink>
            </div>
          </div>

          <p className="figma-hero-description">
            Alunos, mensalidades, matrículas, turmas e<br className="figma-desktop-only" /> tudo o que faz parte da rotina da escola,
            <br className="figma-desktop-only" /> em um só lugar.
          </p>

          <div className="figma-dashboard-frame">
            <img src={DASHBOARD_IMAGE} alt="Dashboard da Alusa" />
          </div>
        </div>
      </section>

      <img className="figma-section-line" src={SECTION_LINE} alt="" aria-hidden="true" />

      <section id="modulos" className="figma-section figma-section-modules">
        <div className="figma-container">
          <div className="figma-section-intro">
            <div>
              <h2>
                Cuide da escola sem passar
                <br />
                o dia organizando a escola.
              </h2>
              <PillLink href="/register" variant="primary">Conhecer a Alusa</PillLink>
            </div>
            <p>
              A Alusa reúne as informações que sua equipe precisa para acompanhar alunos, famílias, turmas e o dia a dia sem depender de vários lugares diferentes.
            </p>
          </div>

          <div className="figma-placeholder-grid" aria-label="Módulos da plataforma">
            <article />
            <article />
          </div>
        </div>
      </section>

      <img className="figma-section-line" src={SECTION_LINE} alt="" aria-hidden="true" />

      <section className="figma-section figma-section-brand">
        <div className="figma-container">
          <div className="figma-brand-layout">
            <h2>
              Feita para escolas.
              <br />
              Não adaptada para elas.
            </h2>
            <div className="figma-brand-copy">
              <p>
                Sua escola <strong>não funciona como uma academia, um CRM ou uma empresa qualquer.</strong> Ela tem{' '}
                <strong>alunos, famílias, turmas, mensalidades, aulas, rematrículas</strong> e uma{' '}
                <strong>rotina própria</strong> que exige outro tipo de organização. Foi entendendo essa realidade de
                perto que a <strong>Alusa começou a ser construída.</strong>
              </p>
            </div>
          </div>
        </div>
      </section>

      <img className="figma-section-line" src={SECTION_LINE} alt="" aria-hidden="true" />

      <ModalityCarousel />

      <img className="figma-section-line" src={SECTION_LINE} alt="" aria-hidden="true" />

      <section id="financeiro" className="figma-section figma-section-finance">
        <div className="figma-container">
          <h2>
            Saiba quem pagou.
            <br />
            E quem ainda precisa pagar.
          </h2>
          <div className="figma-finance-placeholder" />
          <div className="figma-section-intro figma-finance-copy">
            <p>
              Acompanhe mensalidades, pagamentos e pendências de forma clara, sem transformar todo começo de mês em uma conferência manual.
            </p>
            <PillLink href="/register" variant="primary">Conhecer a Alusa</PillLink>
          </div>
        </div>
      </section>

      <img className="figma-section-line" src={SECTION_LINE} alt="" aria-hidden="true" />
    </div>
  );
}
