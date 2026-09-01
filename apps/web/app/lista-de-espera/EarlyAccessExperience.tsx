'use client';

import { useState } from 'react';
import { EarlyAccessForm } from './EarlyAccessForm';

export function EarlyAccessExperience() {
  const [mobileFormOpen, setMobileFormOpen] = useState(false);

  return (
    <main className={`early-access-page${mobileFormOpen ? ' mobile-form-open' : ''}`}>
      <div className="early-access-glow early-access-glow-one" aria-hidden="true" />
      <div className="early-access-glow early-access-glow-two" aria-hidden="true" />

      <div className="early-access-shell">
        <section className="early-access-card" aria-labelledby="early-access-title">
          <div className="early-access-intro">
            <header className="early-access-brand" aria-label="Alusa">
              <img src="/brand/logo-light.svg" alt="Alusa" />
            </header>
            <div className="early-access-intro-copy">
              <h1 id="early-access-title">
                A gestão da sua escola está prestes a ficar <span className="early-access-highlight">mais simples.</span>
              </h1>
              <p className="early-access-description">
                Cadastre-se para ter prioridade quando a Alusa for lançada e acompanhar de perto as novidades.
              </p>
              <button className="early-access-mobile-cta" type="button" onClick={() => setMobileFormOpen(true)}>
                Entrar na lista de espera
                <span aria-hidden="true">↗</span>
              </button>
            </div>
          </div>
          <EarlyAccessForm />
        </section>
      </div>
    </main>
  );
}
