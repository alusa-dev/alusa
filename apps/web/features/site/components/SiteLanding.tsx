import Link from 'next/link';
import type { ReactNode } from 'react';
import { ModalityCarousel } from '@/features/site/components/ModalityCarousel';

const DASHBOARD_IMAGE = '/images/site/dashboard/Dashboard.webp';
const SECTION_LINE = '/images/site/site/section-line.svg';

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
  return <Link href={href} className={`site-pill button-${variant} ${className}`}>{children}</Link>;
}

export function SiteLanding() {
  return (
    <div className="site-landing">
      <section className="site-hero">
        <div className="site-container">
          <div className="site-hero-copy">
            <h1>
              Sua escola pode ser mais
              <br />
              simples de administrar.
            </h1>
            <div className="site-hero-actions">
              <PillLink href="#modulos" variant="primary">Conhecer a Alusa</PillLink>
              <PillLink href="/register" variant="secondary">Teste grátis por 14 dias</PillLink>
            </div>
          </div>

          <p className="site-hero-description">
            Alunos, mensalidades, matrículas, turmas e<br className="site-desktop-only" /> tudo o que faz parte da rotina da escola,
            <br className="site-desktop-only" /> em um só lugar.
          </p>

          <div className="site-dashboard-frame">
            <img src={DASHBOARD_IMAGE} alt="Dashboard da Alusa" />
          </div>
        </div>
      </section>

      <img className="site-section-line" src={SECTION_LINE} alt="" aria-hidden="true" />

      <section id="modulos" className="site-section site-section-modules">
        <div className="site-container">
          <div className="site-section-intro">
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

          <div className="site-placeholder-grid" aria-label="Módulos da plataforma">
            <article />
            <article />
          </div>
        </div>
      </section>

      <img className="site-section-line" src={SECTION_LINE} alt="" aria-hidden="true" />

      <section className="site-section site-section-brand">
        <div className="site-container">
          <div className="site-brand-layout">
            <h2>
              Feita para escolas.
              <br />
              Não adaptada para elas.
            </h2>
            <div className="site-brand-copy">
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

      <img className="site-section-line" src={SECTION_LINE} alt="" aria-hidden="true" />

      <ModalityCarousel />

      <img className="site-section-line" src={SECTION_LINE} alt="" aria-hidden="true" />

      <section id="financeiro" className="site-section site-section-finance">
        <div className="site-container">
          <h2>
            Saiba quem pagou.
            <br />
            E quem ainda precisa pagar.
          </h2>
          <div className="site-finance-placeholder" />
          <div className="site-section-intro site-finance-copy">
            <p>
              Acompanhe mensalidades, pagamentos e pendências de forma clara, sem transformar todo começo de mês em uma conferência manual.
            </p>
            <PillLink href="/register" variant="primary">Conhecer a Alusa</PillLink>
          </div>
        </div>
      </section>

      <img className="site-section-line" src={SECTION_LINE} alt="" aria-hidden="true" />
    </div>
  );
}
