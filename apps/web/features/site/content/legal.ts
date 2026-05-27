import { COOKIE_POLICY_VERSION, LEGAL_DOCUMENT_VERSION } from '@/lib/privacy/legal-versions';

export type LegalSection = {
  title: string;
  body: string[];
};

export type LegalPageContent = {
  slug: string;
  title: string;
  version: string;
  updatedAt: string;
  intro: string;
  sections: LegalSection[];
};

const updatedAt = '27 de maio de 2026';

export const legalPages = {
  privacidade: {
    slug: 'privacidade',
    title: 'Política de Privacidade',
    version: LEGAL_DOCUMENT_VERSION,
    updatedAt,
    intro:
      'Esta política explica como a Alusa trata dados no contexto de um ERP Educacional multi-tenant usado por escolas, alunos, responsáveis, colaboradores e equipes administrativas.',
    sections: [
      {
        title: 'Quem somos',
        body: [
          'A Alusa é uma plataforma de gestão educacional que centraliza rotinas administrativas, acadêmicas, operacionais e financeiras de instituições de ensino.',
          'A Conta da escola é o tenant principal da plataforma. Os dados devem permanecer isolados por contaId e acessíveis apenas a usuários autorizados.',
        ],
      },
      {
        title: 'Papéis da Alusa e da escola',
        body: [
          'Em dados acadêmicos de alunos, responsáveis e colaboradores, a escola normalmente atua como controladora e define as finalidades do tratamento.',
          'A Alusa atua como operadora quando trata dados em nome da escola. Em dados próprios de conta, faturamento, suporte, segurança, operação e melhoria do serviço, a Alusa pode atuar como controladora.',
        ],
      },
      {
        title: 'Dados tratados',
        body: [
          'Podemos tratar dados cadastrais, contatos, documentos, endereços, matrículas, contratos, frequência, cobranças, pagamentos, logs técnicos, registros de suporte e evidências de aceite.',
          'Dados de alunos podem incluir data de nascimento, responsáveis vinculados, observações acadêmicas, restrições médicas, alergias e consentimento de imagem quando a escola cadastrar essas informações.',
        ],
      },
      {
        title: 'Dados financeiros e Asaas',
        body: [
          'A integração financeira white label com Asaas pode exigir o compartilhamento de dados cadastrais e financeiros necessários para customers, cobranças, assinaturas, parcelamentos, KYC, pagamentos, transferências e reconciliação.',
          'A Alusa não deve armazenar token local de cartão. Metadados seguros, como bandeira e últimos quatro dígitos, podem ser mantidos para exibição e suporte.',
        ],
      },
      {
        title: 'Finalidades e bases legais',
        body: [
          'Tratamos dados para cadastro da escola, gestão de usuários, matrícula/rematrícula, contratos, cobranças, portal do responsável/aluno, suporte, segurança, auditoria, prevenção a fraude e cumprimento de obrigações legais.',
          'As bases legais podem incluir execução de contrato, cumprimento de obrigação legal ou regulatória, legítimo interesse, exercício regular de direitos e consentimento quando aplicável.',
        ],
      },
      {
        title: 'Compartilhamento, cookies e segurança',
        body: [
          'Dados podem ser compartilhados com suboperadores necessários, como Asaas, hospedagem, observabilidade e e-mails transacionais, sempre conforme a finalidade contratada.',
          'Usamos cookies essenciais e, no site público, cookies não essenciais apenas com consentimento. Adotamos medidas técnicas e organizacionais para reduzir riscos, sem prometer segurança absoluta.',
        ],
      },
      {
        title: 'Retenção e direitos dos titulares',
        body: [
          'Mantemos dados pelo tempo necessário às finalidades, obrigações legais, financeiras, contratuais, acadêmicas e de auditoria. Exclusão ou anonimização será avaliada caso a caso.',
          'Titulares podem solicitar confirmação, acesso, correção, anonimização, bloqueio, eliminação quando aplicável, portabilidade, informação sobre compartilhamento, revogação de consentimento, oposição e revisão de decisões automatizadas quando houver.',
        ],
      },
      {
        title: 'Crianças e adolescentes, transferência internacional e contato',
        body: [
          'Dados de crianças e adolescentes devem ser cadastrados e tratados pela escola conforme o contexto educacional, a LGPD, o ECA e demais normas aplicáveis.',
          'Suboperadores podem operar em diferentes regiões conforme seus contratos. O canal de privacidade da Alusa é privacidade@alusa.app.',
        ],
      },
    ],
  },
  termos: {
    slug: 'termos',
    title: 'Termos de Uso',
    version: LEGAL_DOCUMENT_VERSION,
    updatedAt,
    intro:
      'Estes termos regulam o uso da Alusa por escolas, colaboradores, responsáveis, alunos e demais usuários autorizados.',
    sections: [
      {
        title: 'Aceitação e definições',
        body: [
          'Ao criar conta, acessar ou usar a Alusa, a escola e seus usuários aceitam estes termos, a Política de Privacidade e, quando aplicável, o DPA.',
          'Conta é o tenant principal da escola. Usuário é a pessoa autorizada a acessar a plataforma. Responsável financeiro é quem pode receber ou pagar cobranças vinculadas a alunos e matrículas.',
        ],
      },
      {
        title: 'Descrição da Alusa',
        body: [
          'A Alusa é um ERP Educacional multi-tenant para gestão de cadastro, matrícula/rematrícula, contratos, cobranças, assinaturas, parcelamentos, pagamentos, reconciliação financeira, portal do responsável/aluno e suporte operacional.',
          'Funcionalidades financeiras podem depender de integração com Asaas, disponibilidade de subconta, configuração correta de webhooks e validações de compliance.',
        ],
      },
      {
        title: 'Cadastro e responsabilidades',
        body: [
          'A escola deve fornecer dados verdadeiros, manter usuários e permissões atualizados e garantir que possui base legal para cadastrar dados de alunos, responsáveis e colaboradores.',
          'Usuários devem proteger credenciais, respeitar permissões, não tentar acessar dados de outra conta e não praticar uso abusivo, fraudulento ou ilegal.',
        ],
      },
      {
        title: 'Financeiro, planos e inadimplência',
        body: [
          'Matrículas, contratos, cobranças, pagamentos e reconciliação devem observar regras configuradas pela escola e eventos recebidos via Asaas.',
          'Planos, cobrança da Alusa, cancelamento, suspensão e inadimplência podem seguir condições comerciais vigentes, comunicações contratuais e obrigações legais aplicáveis.',
        ],
      },
      {
        title: 'Segurança, disponibilidade e suporte',
        body: [
          'A Alusa adota controles de acesso, isolamento por conta, logs, auditoria e medidas de segurança proporcionais ao risco. Interrupções podem ocorrer por manutenção, incidentes ou serviços de terceiros.',
          'O suporte poderá acessar informações necessárias para diagnóstico, respeitando permissões, trilhas auditáveis e minimização de dados.',
        ],
      },
      {
        title: 'Responsabilidade, propriedade intelectual e foro',
        body: [
          'A Alusa não substitui obrigações pedagógicas, jurídicas, contábeis ou fiscais da escola. A escola continua responsável por suas decisões acadêmicas, contratuais e financeiras.',
          'A marca, interfaces, código, documentação e demais ativos da Alusa são protegidos por propriedade intelectual. A lei brasileira rege estes termos.',
        ],
      },
    ],
  },
  cookies: {
    slug: 'cookies',
    title: 'Política de Cookies',
    version: COOKIE_POLICY_VERSION,
    updatedAt,
    intro:
      'Esta política detalha como cookies e tecnologias similares podem ser usados no site público da Alusa.',
    sections: [
      {
        title: 'O que são cookies',
        body: [
          'Cookies são pequenos arquivos ou identificadores armazenados no navegador para viabilizar funcionamento, segurança, preferências e medições.',
          'O banner resume as escolhas disponíveis; esta política apresenta informações mais detalhadas.',
        ],
      },
      {
        title: 'Categorias usadas',
        body: [
          'Cookies essenciais são necessários para sessão, autenticação, segurança, prevenção de fraude, preferências indispensáveis e operação básica.',
          'Cookies de análise, marketing e preferências não essenciais ficam desativados por padrão e só devem ser carregados após consentimento.',
        ],
      },
      {
        title: 'Como alterar preferências',
        body: [
          'No site público, você pode aceitar todos, rejeitar cookies não necessários ou abrir preferências por categoria.',
          'Também é possível bloquear cookies pelo navegador, mas isso pode afetar recursos essenciais como login, sessão e segurança.',
        ],
      },
      {
        title: 'Retenção e atualizações',
        body: [
          'A preferência de consentimento é mantida pelo prazo necessário para respeitar sua escolha e poderá ser solicitada novamente quando houver mudança relevante.',
          'Esta política poderá ser atualizada para refletir novos recursos, suboperadores ou exigências regulatórias.',
        ],
      },
    ],
  },
  seguranca: {
    slug: 'seguranca',
    title: 'Segurança',
    version: LEGAL_DOCUMENT_VERSION,
    updatedAt,
    intro:
      'Adotamos medidas técnicas e organizacionais para reduzir riscos e proteger os dados tratados na plataforma.',
    sections: [
      {
        title: 'Isolamento multi-tenant',
        body: [
          'A Conta é o tenant principal. Dados tenant-scoped devem ser criados, consultados, alterados e removidos dentro do contexto da contaId.',
          'Consultas sensíveis devem filtrar por contaId e, em produção, a Alusa busca reforçar isolamento com RLS e validações de autorização.',
        ],
      },
      {
        title: 'Credenciais e controle de acesso',
        body: [
          'Credenciais de integração, como chaves Asaas, devem ser mantidas fora do client e armazenadas com proteção adequada.',
          'Sessões, papéis, conta ativa e vínculo UsuarioConta devem ser considerados antes de operações protegidas.',
        ],
      },
      {
        title: 'Auditoria e financeiro Asaas',
        body: [
          'Ações críticas devem gerar logs úteis sem expor segredos. Webhooks Asaas são tratados com validação, idempotência, hash de payload, retry e reconciliação.',
          'Não alteramos estado financeiro crítico apenas por ação de tela sem considerar webhook, auditoria e consistência local.',
        ],
      },
      {
        title: 'Continuidade e reporte',
        body: [
          'Backups, monitoramento, resposta a incidentes, rotação de chaves e runbooks são práticas esperadas na operação da Alusa.',
          'Vulnerabilidades podem ser reportadas para seguranca@alusa.app com detalhes técnicos suficientes para triagem.',
        ],
      },
    ],
  },
  suboperadores: {
    slug: 'suboperadores',
    title: 'Suboperadores',
    version: LEGAL_DOCUMENT_VERSION,
    updatedAt,
    intro:
      'Suboperadores ajudam a Alusa a hospedar, observar, enviar comunicações e processar rotinas financeiras necessárias ao ERP Educacional.',
    sections: [
      {
        title: 'Lista atual',
        body: [
          'Asaas: processamento financeiro; dados cadastrais e financeiros; Brasil; ativo.',
          'Vercel: hospedagem e infraestrutura de aplicação; dados técnicos e aplicação; conforme contrato; ativo.',
          'Sentry: observabilidade; eventos técnicos sanitizados; conforme contrato; ativo.',
          'Resend/e-mail: e-mails transacionais; nome, e-mail e conteúdo transacional; conforme contrato; ativo.',
        ],
      },
      {
        title: 'Autorização e mudanças',
        body: [
          'A contratação de suboperadores deve observar o DPA, as finalidades do tratamento e medidas compatíveis de segurança.',
          'Mudanças relevantes serão refletidas nesta página e poderão exigir comunicação adicional conforme contrato ou lei aplicável.',
        ],
      },
    ],
  },
  dpa: {
    slug: 'dpa',
    title: 'DPA / Contrato de Tratamento de Dados',
    version: LEGAL_DOCUMENT_VERSION,
    updatedAt,
    intro:
      'Este DPA complementa os Termos de Uso quando a Alusa trata dados pessoais em nome da escola contratante.',
    sections: [
      {
        title: 'Partes, papéis e objeto',
        body: [
          'A escola é controladora dos dados acadêmicos, administrativos e financeiros cadastrados para sua operação educacional. A Alusa é operadora quando trata esses dados conforme instruções da escola.',
          'A Alusa pode atuar como controladora em dados próprios de conta, faturamento SaaS, suporte, segurança, operação, prevenção a abuso e analytics próprio consentido.',
        ],
      },
      {
        title: 'Categorias de dados e titulares',
        body: [
          'O tratamento pode envolver alunos, responsáveis, colaboradores, usuários administrativos, pagadores, visitantes do site público e contatos de suporte.',
          'As categorias incluem dados cadastrais, acadêmicos, contratuais, financeiros, logs, evidências de aceite, solicitações LGPD e informações necessárias para integração com Asaas.',
        ],
      },
      {
        title: 'Instruções, confidencialidade e segurança',
        body: [
          'A Alusa tratará dados conforme funcionalidades configuradas, contratos, fluxos de suporte e instruções documentadas da escola.',
          'Pessoas autorizadas devem observar confidencialidade, controle de acesso, segregação por conta, auditoria e minimização de dados.',
        ],
      },
      {
        title: 'Suboperadores, incidentes e direitos',
        body: [
          'Suboperadores podem ser usados para hospedagem, observabilidade, e-mail e financeiro, desde que compatíveis com as finalidades e obrigações contratuais.',
          'A Alusa cooperará de forma razoável com a escola em incidentes, solicitações de titulares, auditoria, retenção, devolução, exclusão ou anonimização quando aplicável.',
        ],
      },
      {
        title: 'Término',
        body: [
          'Ao término do contrato, dados poderão ser devolvidos, exportados, excluídos ou anonimizados conforme viabilidade técnica, instruções válidas, obrigações legais, financeiras, contratuais e de auditoria.',
        ],
      },
    ],
  },
  direitosLgpd: {
    slug: 'direitos-lgpd',
    title: 'Direitos LGPD',
    version: LEGAL_DOCUMENT_VERSION,
    updatedAt,
    intro:
      'Esta página orienta titulares sobre solicitações relacionadas aos seus dados pessoais tratados na Alusa.',
    sections: [
      {
        title: 'Direitos disponíveis',
        body: [
          'Você pode solicitar confirmação de tratamento, acesso, correção, anonimização, bloqueio, eliminação quando aplicável, portabilidade, informação sobre compartilhamento, revogação de consentimento, oposição e revisão de decisões automatizadas quando houver.',
          'Alguns pedidos podem depender de validação de identidade, análise da escola controladora ou preservação por obrigação legal, financeira, contratual ou de auditoria.',
        ],
      },
      {
        title: 'Como solicitar',
        body: [
          'Use o formulário público de solicitação LGPD ou entre em contato pelo canal privacidade@alusa.app.',
          'Quando a solicitação envolver dados acadêmicos controlados pela escola, a Alusa poderá encaminhar ou cooperar com a instituição responsável.',
        ],
      },
    ],
  },
} as const satisfies Record<string, LegalPageContent>;
