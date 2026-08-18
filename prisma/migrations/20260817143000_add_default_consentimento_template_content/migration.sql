-- Evolui os templates unitários para suportar grupos de termos e o conteúdo
-- padrão completo de consentimento de imagem e voz.

ALTER TABLE "ContratoConsentimentoTemplate"
  ADD COLUMN "grupoSlug" TEXT,
  ADD COLUMN "grupoNome" TEXT,
  ADD COLUMN "grupoDescricao" TEXT,
  ADD COLUMN "introducao" TEXT,
  ADD COLUMN "encerramento" TEXT,
  ADD COLUMN "ordem" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "idx_contrato_consentimento_template_grupo_versao_ativo"
  ON "ContratoConsentimentoTemplate"("grupoSlug", "versao", "ativo");

UPDATE "ContratoConsentimentoTemplate"
SET "ativo" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "slug" = 'uso-imagem'
  AND "versao" = 1
  AND "origem" = 'SISTEMA';

INSERT INTO "ContratoConsentimentoTemplate"
  ("id", "slug", "nome", "finalidade", "titulo", "texto", "variaveis", "grupoSlug", "grupoNome", "grupoDescricao", "introducao", "encerramento", "ordem", "versao", "origem", "ativo", "updatedAt")
VALUES
  (
    'consentimento-sistema-uso-imagem-padrao-registro-v1',
    'uso-imagem-padrao-registro',
    'Termo padrão de uso de imagem e voz',
    'IMAGE_USE',
    'Registro interno de atividades e eventos',
    'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo a captação e o armazenamento de fotografias, vídeos e registros de voz de {{nome_aluno}} realizados em aulas, treinamentos, apresentações, eventos, competições e demais atividades educacionais, exclusivamente para organização, memória e documentação interna da instituição.',
    ARRAY['nome_assinante', 'qualificacao_assinante', 'nome_aluno', 'cpf_assinante', 'cpf_aluno']::TEXT[],
    'uso-imagem-padrao',
    'Termo padrão de consentimento e autorização para uso de imagem e voz',
    'Modelo oficial da Alusa com autorizações separadas por finalidade. Cada item pode ser autorizado ou recusado sem impedir a assinatura do contrato.',
    'Este termo registra as escolhas de {{nome_assinante}} sobre a captação e o uso da imagem e da voz de {{nome_aluno}}. As autorizações são específicas por finalidade e não substituem o aceite geral do contrato.',
    'A autorização é gratuita e poderá ser revogada pelos canais de privacidade da instituição, respeitados os usos realizados antes do recebimento da solicitação. A recusa não poderá impedir a participação do aluno nas atividades educacionais. A instituição deverá preservar a dignidade, a privacidade, a segurança e o melhor interesse do aluno.',
    1,
    1,
    'SISTEMA',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'consentimento-sistema-uso-imagem-padrao-comunicacao-v1',
    'uso-imagem-padrao-comunicacao',
    'Termo padrão de uso de imagem e voz',
    'COMMUNICATIONS',
    'Comunicação com alunos e responsáveis',
    'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo o uso da imagem, da voz e de registros audiovisuais de {{nome_aluno}} em comunicações direcionadas a alunos, responsáveis e participantes da comunidade escolar, sempre em contexto institucional e educacional.',
    ARRAY['nome_assinante', 'qualificacao_assinante', 'nome_aluno', 'cpf_assinante', 'cpf_aluno']::TEXT[],
    'uso-imagem-padrao',
    'Termo padrão de consentimento e autorização para uso de imagem e voz',
    'Modelo oficial da Alusa com autorizações separadas por finalidade. Cada item pode ser autorizado ou recusado sem impedir a assinatura do contrato.',
    'Este termo registra as escolhas de {{nome_assinante}} sobre a captação e o uso da imagem e da voz de {{nome_aluno}}. As autorizações são específicas por finalidade e não substituem o aceite geral do contrato.',
    'A autorização é gratuita e poderá ser revogada pelos canais de privacidade da instituição, respeitados os usos realizados antes do recebimento da solicitação. A recusa não poderá impedir a participação do aluno nas atividades educacionais. A instituição deverá preservar a dignidade, a privacidade, a segurança e o melhor interesse do aluno.',
    2,
    1,
    'SISTEMA',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'consentimento-sistema-uso-imagem-padrao-site-v1',
    'uso-imagem-padrao-site',
    'Termo padrão de uso de imagem e voz',
    'IMAGE_USE',
    'Publicação no site institucional',
    'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo a publicação da imagem, da voz e de registros audiovisuais de {{nome_aluno}} no site institucional, em páginas e notícias relacionadas às atividades da instituição, sem exposição vexatória ou incompatível com a finalidade educacional.',
    ARRAY['nome_assinante', 'qualificacao_assinante', 'nome_aluno', 'cpf_assinante', 'cpf_aluno']::TEXT[],
    'uso-imagem-padrao',
    'Termo padrão de consentimento e autorização para uso de imagem e voz',
    'Modelo oficial da Alusa com autorizações separadas por finalidade. Cada item pode ser autorizado ou recusado sem impedir a assinatura do contrato.',
    'Este termo registra as escolhas de {{nome_assinante}} sobre a captação e o uso da imagem e da voz de {{nome_aluno}}. As autorizações são específicas por finalidade e não substituem o aceite geral do contrato.',
    'A autorização é gratuita e poderá ser revogada pelos canais de privacidade da instituição, respeitados os usos realizados antes do recebimento da solicitação. A recusa não poderá impedir a participação do aluno nas atividades educacionais. A instituição deverá preservar a dignidade, a privacidade, a segurança e o melhor interesse do aluno.',
    3,
    1,
    'SISTEMA',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'consentimento-sistema-uso-imagem-padrao-redes-v1',
    'uso-imagem-padrao-redes',
    'Termo padrão de uso de imagem e voz',
    'IMAGE_USE',
    'Publicação em redes sociais',
    'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo a publicação da imagem, da voz e de registros audiovisuais de {{nome_aluno}} nos perfis institucionais da instituição em redes sociais e plataformas digitais, observadas as políticas próprias dessas plataformas e os limites deste termo.',
    ARRAY['nome_assinante', 'qualificacao_assinante', 'nome_aluno', 'cpf_assinante', 'cpf_aluno']::TEXT[],
    'uso-imagem-padrao',
    'Termo padrão de consentimento e autorização para uso de imagem e voz',
    'Modelo oficial da Alusa com autorizações separadas por finalidade. Cada item pode ser autorizado ou recusado sem impedir a assinatura do contrato.',
    'Este termo registra as escolhas de {{nome_assinante}} sobre a captação e o uso da imagem e da voz de {{nome_aluno}}. As autorizações são específicas por finalidade e não substituem o aceite geral do contrato.',
    'A autorização é gratuita e poderá ser revogada pelos canais de privacidade da instituição, respeitados os usos realizados antes do recebimento da solicitação. A recusa não poderá impedir a participação do aluno nas atividades educacionais. A instituição deverá preservar a dignidade, a privacidade, a segurança e o melhor interesse do aluno.',
    4,
    1,
    'SISTEMA',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'consentimento-sistema-uso-imagem-padrao-materiais-v1',
    'uso-imagem-padrao-materiais',
    'Termo padrão de uso de imagem e voz',
    'IMAGE_USE',
    'Materiais institucionais impressos e digitais',
    'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo o uso da imagem, da voz e de registros audiovisuais de {{nome_aluno}} em materiais institucionais impressos ou digitais, como informativos, relatórios, apresentações, portfólios e materiais de divulgação das atividades educacionais.',
    ARRAY['nome_assinante', 'qualificacao_assinante', 'nome_aluno', 'cpf_assinante', 'cpf_aluno']::TEXT[],
    'uso-imagem-padrao',
    'Termo padrão de consentimento e autorização para uso de imagem e voz',
    'Modelo oficial da Alusa com autorizações separadas por finalidade. Cada item pode ser autorizado ou recusado sem impedir a assinatura do contrato.',
    'Este termo registra as escolhas de {{nome_assinante}} sobre a captação e o uso da imagem e da voz de {{nome_aluno}}. As autorizações são específicas por finalidade e não substituem o aceite geral do contrato.',
    'A autorização é gratuita e poderá ser revogada pelos canais de privacidade da instituição, respeitados os usos realizados antes do recebimento da solicitação. A recusa não poderá impedir a participação do aluno nas atividades educacionais. A instituição deverá preservar a dignidade, a privacidade, a segurança e o melhor interesse do aluno.',
    5,
    1,
    'SISTEMA',
    true,
    CURRENT_TIMESTAMP
  ),
  (
    'consentimento-sistema-uso-imagem-padrao-publicidade-v1',
    'uso-imagem-padrao-publicidade',
    'Termo padrão de uso de imagem e voz',
    'IMAGE_USE',
    'Divulgação institucional e publicitária',
    'Eu, {{nome_assinante}}, {{qualificacao_assinante}}, autorizo o uso da imagem, da voz e de registros audiovisuais de {{nome_aluno}} em campanhas de divulgação institucional da instituição. A autorização não permite a venda da imagem nem seu uso para publicidade de terceiros sem nova autorização específica.',
    ARRAY['nome_assinante', 'qualificacao_assinante', 'nome_aluno', 'cpf_assinante', 'cpf_aluno']::TEXT[],
    'uso-imagem-padrao',
    'Termo padrão de consentimento e autorização para uso de imagem e voz',
    'Modelo oficial da Alusa com autorizações separadas por finalidade. Cada item pode ser autorizado ou recusado sem impedir a assinatura do contrato.',
    'Este termo registra as escolhas de {{nome_assinante}} sobre a captação e o uso da imagem e da voz de {{nome_aluno}}. As autorizações são específicas por finalidade e não substituem o aceite geral do contrato.',
    'A autorização é gratuita e poderá ser revogada pelos canais de privacidade da instituição, respeitados os usos realizados antes do recebimento da solicitação. A recusa não poderá impedir a participação do aluno nas atividades educacionais. A instituição deverá preservar a dignidade, a privacidade, a segurança e o melhor interesse do aluno.',
    6,
    1,
    'SISTEMA',
    true,
    CURRENT_TIMESTAMP
  );
