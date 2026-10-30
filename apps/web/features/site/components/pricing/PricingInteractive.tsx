'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import { SlidingNumber } from '@/components/core/sliding-number';
import { PricingReveal } from '@/features/site/components/pricing/PricingReveal';
import { getSchoolPricingTier, SCHOOL_PRICING_TIERS } from '@/lib/school-pricing-ui';

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0,
  }).format(value);
}

function simulatorMoney(value: number) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function PricingInteractive({
  beforeTiers,
  afterTiers,
  selfServiceEnabled = true,
}: {
  beforeTiers?: ReactNode;
  afterTiers?: ReactNode;
  selfServiceEnabled?: boolean;
}) {
  const searchParams = useSearchParams();
  const requestedCount = Number(searchParams.get('studentCount'));
  const initialCount = Number.isSafeInteger(requestedCount) && requestedCount >= 1 ? requestedCount : 165;
  const [students, setStudents] = useState(initialCount);
  const [studentDraft, setStudentDraft] = useState(String(initialCount));
  const selectedTier = getSchoolPricingTier(students);
  const needsSpecialist = students > 500;
  const rangeValue = Math.min(students, 501);
  const selectedPrice = selectedTier?.price ?? 0;
  const formattedPrice = simulatorMoney(selectedPrice);
  const parsedDraftCount = Number(studentDraft);
  const contactStudentCount = Number.isSafeInteger(parsedDraftCount) && parsedDraftCount >= 1 ? parsedDraftCount : students;
  const expertContactHref = `/get-started?studentCount=${contactStudentCount}`;
  const pricingCtaHref = needsSpecialist || !selfServiceEnabled
    ? expertContactHref
    : `/auth/register?studentCount=${contactStudentCount}`;
  const pricingCtaLabel = needsSpecialist || !selfServiceEnabled
    ? 'Fale com a Alusa'
    : 'Teste grátis por 14 dias';

  useEffect(() => {
    if (window.location.pathname !== '/precos') return;
    const url = new URL(window.location.href);
    url.searchParams.set('studentCount', String(contactStudentCount));
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, [contactStudentCount]);

  function updateStudentDraft(value: string) {
    if (!/^\d*$/.test(value)) return;
    setStudentDraft(value);
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed >= 1) setStudents(parsed);
  }

  function normalizeStudentDraft() {
    const parsed = Number(studentDraft);
    const normalized = Number.isSafeInteger(parsed) ? Math.max(1, parsed) : students;
    setStudents(normalized);
    setStudentDraft(String(normalized));
  }

  function updateFromRange(value: string) {
    const nextValue = Number(value);
    setStudents(nextValue);
    setStudentDraft(String(nextValue));
  }

  return (
    <article className="site-pricing">
      <section className="pricing-hero">
        <div className="pricing-container">
          <h1>
            Um plano único, ajustado à<br /> realidade da sua escola.
          </h1>
          <p className="pricing-hero-intro">
            Todos os módulos essenciais para organizar a rotina acadêmica,
            <br className="site-desktop-only" /> administrativa e financeira da escola.
          </p>

          <section className="pricing-simulator" aria-label="Simulador de mensalidade">
            <div className="pricing-inputs">
              <label className="pricing-number-label" htmlFor="pricing-student-count">
                Quantos alunos ativos pagantes sua escola tem?
              </label>
              <p className="pricing-count-explanation">
                Cada aluno conta uma vez, mesmo com mais de uma matrícula.
              </p>
              <div className="pricing-number-wrap">
                <input
                  id="pricing-student-count"
                  type="number"
                  min={1}
                  step={1}
                  inputMode="numeric"
                  style={{ width: `${Math.max(studentDraft.length, 1)}ch` }}
                  value={studentDraft}
                  onChange={(event) => updateStudentDraft(event.currentTarget.value)}
                  onBlur={normalizeStudentDraft}
                  aria-invalid={
                    studentDraft !== '' &&
                    (!Number.isInteger(Number(studentDraft)) ||
                      Number(studentDraft) < 1)
                  }
                  aria-describedby="pricing-count-help"
                />
                <span>alunos</span>
              </div>
              <input
                className="pricing-range"
                type="range"
                min={1}
                max={501}
                step={1}
                value={rangeValue}
                style={{
                  '--pricing-range-progress': `${((rangeValue - 1) / 500) * 100}%`,
                } as CSSProperties}
                onChange={(event) => updateFromRange(event.currentTarget.value)}
                aria-label="Quantidade de alunos"
                aria-valuetext={needsSpecialist ? 'Mais de 500 alunos' : `${students} alunos`}
              />
              <p id="pricing-count-help" className="pricing-range-labels">
                <span>1 aluno</span>
                <span>Mais de 500 alunos</span>
              </p>
              {studentDraft !== '' &&
                (!Number.isInteger(Number(studentDraft)) ||
                  Number(studentDraft) < 1) && (
                  <p className="pricing-input-error" role="status">
                    Digite um número inteiro maior que zero para atualizar a simulação.
                  </p>
                )}
            </div>

            <div className="pricing-result">
              <span className="pricing-result-label">{needsSpecialist ? 'Mais de 500 alunos' : selectedTier?.label}</span>
              {needsSpecialist ? (
                <strong className="pricing-result-custom">Condição personalizada</strong>
              ) : (
                <strong aria-hidden="true">
                  <span className="pricing-result-currency">R$</span>
                  <SlidingNumber value={selectedPrice} />
                  <span className="pricing-result-cents">,00</span>
                  <small>/mês</small>
                </strong>
              )}
              <span className="sr-only" aria-live="polite" aria-atomic="true">
                {needsSpecialist ? 'Mais de 500 alunos, condição personalizada.' : `${selectedTier?.label}, ${formattedPrice} por mês.`}
              </span>
              <p className="pricing-result-copy">
                Todos os módulos incluídos. A mensalidade muda após três fechamentos mensais
                consecutivos em uma nova faixa.
              </p>
              <a
                className="site-pill button-primary pricing-result-action"
                href={pricingCtaHref}
              >
                {pricingCtaLabel}
              </a>
            </div>
          </section>
        </div>
      </section>

      {beforeTiers}

      <section
        id="faixas"
        className="pricing-tiers pricing-rail-section"
        aria-labelledby="pricing-tiers-title"
      >
        <PricingReveal>
          <div className="pricing-container pricing-tiers-layout">
            <div className="pricing-tiers-copy">
              <h2 id="pricing-tiers-title">
                Encontre a faixa<br className="pricing-tiers-title-break" />{' '}da sua escola.
              </h2>
              <div className="pricing-section-lede pricing-tier-info">
                <div className="pricing-tier-paragraphs">
                  <p>
                    A faixa considera cada aluno com matrícula ativa e mensalidade prevista, contado
                    uma única vez. O valor muda após três fechamentos mensais consecutivos na nova
                    faixa.
                  </p>
                  <p>
                    Alunos com bolsa parcial e mensalidades em atraso continuam contando. Alunos com
                    bolsa integral não contam quando não têm outra matrícula com mensalidade prevista.
                  </p>
                  <p>
                    Acima de 500 alunos por três fechamentos consecutivos, nossa equipe conversa com a
                    escola sobre uma condição personalizada.
                  </p>
                </div>
                <a
                  className="site-pill button-primary pricing-tier-contact-button"
                  href={pricingCtaHref}
                >
                  {pricingCtaLabel}
                </a>
              </div>
            </div>
            <div className="pricing-table-wrap">
              <table>
                <caption>Faixas de preço mensal por quantidade de alunos</caption>
                <thead>
                  <tr>
                    <th scope="col">Alunos</th>
                    <th scope="col">Mensalidade</th>
                  </tr>
                </thead>
                <tbody>
                {SCHOOL_PRICING_TIERS.map((tier) => {
                    const isSelected = selectedTier?.min === tier.min;
                    return (
                      <tr
                        key={tier.min}
                        className={isSelected ? 'is-selected' : undefined}
                        aria-current={isSelected ? 'true' : undefined}
                      >
                        <th scope="row">
                          {tier.label}
                          {isSelected && <span className="pricing-selected-label"> · sua faixa</span>}
                        </th>
                        <td>
                          {money(tier.price)} <span>/ mês</span>
                        </td>
                      </tr>
                    );
                  })}
                  <tr
                    className={needsSpecialist ? 'is-selected' : undefined}
                    aria-current={needsSpecialist ? 'true' : undefined}
                  >
                    <th scope="row">Mais de 500 alunos</th>
                    <td>Condição personalizada</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </PricingReveal>
      </section>
      {afterTiers}
    </article>
  );
}
