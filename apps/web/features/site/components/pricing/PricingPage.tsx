import Link from 'next/link';
import { Suspense } from 'react';
import { Check } from '@/features/site/components/icons/icons';
import { PricingInteractive } from '@/features/site/components/pricing/PricingInteractive';
import { PricingReveal } from '@/features/site/components/pricing/PricingReveal';
import { ExpertContactLink } from '@/features/site/components/navigation/ExpertContactLink';
import { isExternalAsaasOnboardingRolloutEnabled } from '@/lib/feature-flags/external-asaas-onboarding';

const features = [
  'Gestão de alunos e responsáveis',
  'Gestão de matrículas e rematrículas',
  'Gestão de turmas',
  'Gestão de aulas e agenda',
  'Gestão de frequência',
  'Gestão de reposições',
  'Gestão de colaboradores',
  'Gestão de contratos',
  'Gestão de cobranças e pagamentos',
  'Gestão de assinaturas e parcelamentos',
  'Gestão de caixa e extrato financeiro',
  'Gestão de relatórios financeiros',
  'Gestão de eventos',
  'Gestão de produtos, vendas e estoque',
  'Portal do aluno e responsável',
];

const questions = [
  {
    question: 'Como a Alusa conta os alunos?',
    answer:
      <>
        <p>
          Cada aluno com matrícula ativa não integralmente gratuita é contado uma vez, mesmo que
          tenha mais de uma matrícula.
        </p>
        <p className="pricing-faq-followup">
          Bolsas parciais e mensalidades em atraso continuam contando. Alunos com bolsa integral não
          contam quando não têm outra matrícula com mensalidade prevista.
        </p>
      </>,
  },
  {
    question: 'Quando a mensalidade muda de faixa?',
    answer:
      <>
        <p>A mensalidade muda de faixa após três fechamentos mensais consecutivos nessa faixa.</p>
        <p className="pricing-faq-followup">Isso vale tanto para aumentos quanto para reduções.</p>
      </>,
  },
  {
    question: 'O que acontece quando a escola passa de 500 alunos?',
    answer:
      <>
        <p>
          O crescimento acima de 500 alunos não bloqueia o uso da plataforma, novas matrículas ou
          cobranças. Após três fechamentos mensais consecutivos acima desse limite, nossa equipe
          conversa com a escola sobre uma condição comercial.
        </p>
        <p className="pricing-faq-followup">
          Até um novo acordo, vale a assinatura atual, observada a transição prevista em contrato.
        </p>
      </>,
  },
  {
    question: 'Como funcionam as operações financeiras?',
    answer:
      <>
        <p>
          A aprovação cadastral e as condições e tarifas das operações financeiras dependem dos
          provedores parceiros. A Alusa integra esses serviços à plataforma e informa as etapas do
          fluxo.
        </p>
        <p className="pricing-faq-followup">
          Consulte a <Link href="/suboperadores">Política de Suboperadores</Link> para conhecer os
          provedores utilizados.
        </p>
      </>,
  },
  {
    question: 'Há fidelidade ou cobrança por professor e usuário?',
    answer: (
      <>
        <p>A assinatura não tem fidelidade.</p>
        <p className="pricing-faq-followup">
          A mensalidade não varia pelo número de professores ou usuários.
        </p>
      </>
    ),
  },
  {
    question: 'Como funciona a migração de dados?',
    answer: (
      <>
        <p>Migrações complexas passam por avaliação.</p>
        <p className="pricing-faq-followup">
          A escola recebe uma proposta personalizada antes do início.
        </p>
      </>
    ),
  },
];

export function PricingPage() {
  return (
    <Suspense fallback={null}>
    <PricingInteractive
      selfServiceEnabled={isExternalAsaasOnboardingRolloutEnabled()}
      beforeTiers={
        <section
          className="pricing-section pricing-included pricing-rail-section"
          aria-labelledby="pricing-included-title"
        >
          <PricingReveal>
            <div className="pricing-container">
              <h2 id="pricing-included-title">O que está incluído no plano</h2>
              <p className="pricing-hero-intro pricing-included-intro">
                Todos os módulos essenciais para organizar a rotina acadêmica,
                <br className="pricing-included-break" />{' '}
                administrativa e financeira da escola.
              </p>
              <ul className="pricing-feature-grid">
                {features.map((feature) => (
                  <li key={feature}>
                    <Check aria-hidden="true" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </div>
          </PricingReveal>
        </section>
      }
      afterTiers={
        <>
          <section
            className="pricing-section pricing-faq pricing-rail-section"
            aria-labelledby="pricing-faq-title"
          >
            <PricingReveal>
              <div className="pricing-container">
                <div className="pricing-faq-layout">
                  <div className="pricing-faq-intro">
                    <h2 id="pricing-faq-title">Ficou com dúvidas sobre o plano?</h2>
                    <p>
                      Reunimos respostas para ajudar sua escola a entender a mensalidade, as faixas e
                      o que está incluído.
                    </p>
                    <Suspense fallback={<a className="site-pill button-primary pricing-faq-contact" href="/get-started">Fale com um especialista</a>}>
                      <ExpertContactLink className="site-pill button-primary pricing-faq-contact">Fale com um especialista</ExpertContactLink>
                    </Suspense>
                  </div>
                  <div className="pricing-faq-list">
                    {questions.map(({ question, answer }) => (
                      <details key={question}>
                        <summary>
                          <span>{question}</span>
                        </summary>
                        {typeof answer === 'string' ? <p>{answer}</p> : answer}
                      </details>
                    ))}
                  </div>
                </div>
              </div>
            </PricingReveal>
          </section>

          <section className="pricing-final-cta pricing-rail-section">
            <PricingReveal>
              <div className="pricing-container">
                <h2>
                  Vamos conversar
                  <br className="pricing-final-cta-break" /> sobre a realidade da sua escola?
                </h2>
                <p>
                  Escolas com mais de 500 alunos podem conversar com nosso time
                  <br className="pricing-final-cta-break" /> sobre uma condição personalizada.
                </p>
                <div className="pricing-cta-actions">
                  <Suspense fallback={<a className="site-pill button-primary" href="/get-started">Fale com um especialista</a>}>
                    <ExpertContactLink className="site-pill button-primary">Fale com um especialista</ExpertContactLink>
                  </Suspense>
                </div>
              </div>
            </PricingReveal>
          </section>
        </>
      }
    />
    </Suspense>
  );
}
