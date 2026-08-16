import type { Metadata } from 'next';
import { EarlyAccessForm } from './EarlyAccessForm';

export const metadata: Metadata = {
  title: 'Acesso antecipado',
  description: 'Entre para a lista de acesso antecipado da Alusa.',
  robots: { index: true, follow: true },
};

export default function EarlyAccessPage() {
  return (
    <main className="early-access-page">
      <div className="early-access-glow early-access-glow-one" aria-hidden="true" />
      <div className="early-access-glow early-access-glow-two" aria-hidden="true" />

      <div className="early-access-shell">
        <header className="early-access-brand" aria-label="Alusa">
          <img src="/brand/logo-light.svg" alt="Alusa" />
        </header>

        <section className="early-access-card" aria-labelledby="early-access-title">
          <div className="early-access-intro">
            <p className="early-access-eyebrow">Lista de acesso antecipado</p>
            <h1 id="early-access-title">A gestão da sua escola está prestes a ficar mais simples.</h1>
            <p className="early-access-description">
              Cadastre-se para ter prioridade quando a Alusa for lançada e acompanhar de perto as novidades.
            </p>
          </div>
          <EarlyAccessForm />
        </section>

        <p className="early-access-footer">Alusa · Gestão escolar com mais clareza e controle.</p>
      </div>
    </main>
  );
}
