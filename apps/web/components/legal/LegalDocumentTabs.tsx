'use client';

import React, { type ReactNode } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function LegalTextBlock({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-slate-950">{title}</h3>
      <div className="space-y-2 text-sm leading-relaxed text-slate-600">{children}</div>
    </section>
  );
}

export function LegalDocumentTabs() {
  return (
    <Tabs defaultValue="terms" className="w-full">
      <TabsList className="grid h-auto w-full grid-cols-2 gap-1 rounded-lg bg-slate-100 p-1 sm:grid-cols-4">
        <TabsTrigger value="terms" className="min-h-9 text-xs">Termos</TabsTrigger>
        <TabsTrigger value="privacy" className="min-h-9 text-xs">Privacidade</TabsTrigger>
        <TabsTrigger value="dpa" className="min-h-9 text-xs">DPA</TabsTrigger>
        <TabsTrigger value="asaas" className="min-h-9 text-xs">Asaas</TabsTrigger>
      </TabsList>

      <TabsContent value="terms" className="mt-4 space-y-3">
        <LegalTextBlock title="Uso da Alusa">
          <p>
            A Alusa e um ERP Educacional multi-tenant para escolas, cursos e instituicoes de ensino
            gerenciarem alunos, responsaveis, matriculas, contratos, cobrancas, pagamentos e operacao escolar.
          </p>
          <p>
            A escola e responsavel pela veracidade dos dados cadastrados, pela autorizacao de seus usuarios
            e pelo uso da plataforma de acordo com a legislacao aplicavel.
          </p>
        </LegalTextBlock>
        <LegalTextBlock title="Financeiro e Asaas">
          <p>
            Recursos financeiros white label dependem de integracao com Asaas, webhooks, reconciliacao e
            regras operacionais da conta da escola. A Alusa nao deve ser usada para burlar controles de
            cobranca, compliance ou seguranca financeira.
          </p>
        </LegalTextBlock>
      </TabsContent>

      <TabsContent value="privacy" className="mt-4 space-y-3">
        <LegalTextBlock title="Papeis na LGPD">
          <p>
            Em dados academicos de alunos, responsaveis e colaboradores, a escola normalmente atua como
            controladora e a Alusa como operadora. Em dados proprios de conta, faturamento SaaS, suporte,
            seguranca e operacao, a Alusa pode atuar como controladora.
          </p>
        </LegalTextBlock>
        <LegalTextBlock title="Dados tratados">
          <p>
            A plataforma pode tratar dados cadastrais, academicos, contratuais, financeiros, logs tecnicos,
            dados de suporte e evidencias de aceite, sempre de acordo com as finalidades do ERP Educacional.
          </p>
        </LegalTextBlock>
      </TabsContent>

      <TabsContent value="dpa" className="mt-4 space-y-3">
        <LegalTextBlock title="Contrato de tratamento de dados">
          <p>
            O DPA define objeto, duracao, natureza, finalidades, categorias de dados, titulares, medidas de
            seguranca, suboperadores, cooperacao com titulares e regras para termino do tratamento.
          </p>
        </LegalTextBlock>
        <LegalTextBlock title="Instrucoes documentadas">
          <p>
            A Alusa trata dados em nome da escola conforme configuracoes, contratos, fluxos de matricula,
            cobranca, portal e suporte, preservando isolamento por conta e rastreabilidade.
          </p>
        </LegalTextBlock>
      </TabsContent>

      <TabsContent value="asaas" className="mt-4 space-y-3">
        <LegalTextBlock title="Servicos financeiros">
          <p>
            Ao usar cobrancas, assinaturas, parcelamentos, pagamentos, KYC, transferencias ou reconciliacao,
            a escola reconhece que dados cadastrais e financeiros podem ser compartilhados com o Asaas para
            executar esses servicos.
          </p>
        </LegalTextBlock>
        <LegalTextBlock title="Seguranca operacional">
          <p>
            Webhooks Asaas sao fonte primaria de mudanca de estado financeiro. A Alusa mantem registros
            sanitizados e hashes para idempotencia, auditoria e investigacao de divergencias.
          </p>
        </LegalTextBlock>
      </TabsContent>
    </Tabs>
  );
}
