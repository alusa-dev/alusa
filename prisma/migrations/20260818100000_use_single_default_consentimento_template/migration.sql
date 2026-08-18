-- O template padrão representa o termo completo em um único consentimento.
-- As autorizações internas do documento são apresentadas como texto informativo;
-- a decisão registrada pela Alusa é única: autorizar ou não autorizar o termo.

UPDATE "ContratoConsentimentoTemplate"
SET "ativo" = false,
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "grupoSlug" = 'uso-imagem-padrao'
  AND "versao" = 1
  AND "origem" = 'SISTEMA';

INSERT INTO "ContratoConsentimentoTemplate"
  ("id", "slug", "nome", "finalidade", "titulo", "texto", "variaveis", "grupoDescricao", "ordem", "versao", "origem", "ativo", "updatedAt")
VALUES
  (
    'consentimento-sistema-uso-imagem-v2',
    'uso-imagem',
    'Termo padrão de consentimento e autorização para uso de imagem e voz',
    'IMAGE_USE',
    'Termo de consentimento e autorização para uso de imagem e voz',
    $$Eu, {{nome_assinante}}, {{qualificacao_assinante}}, declaro que li e compreendi este Termo de Consentimento e Autorização para Uso de Imagem e Voz de {{nome_aluno}}.

OBJETO DA AUTORIZAÇÃO

Este termo trata da captação e utilização de fotografias, vídeos, gravações de voz e demais registros visuais realizados em aulas, treinos, apresentações, atividades, eventos, competições, festivais, comemorações, projetos, encontros, cerimônias e outras atividades promovidas ou relacionadas à instituição.

A utilização deverá respeitar a dignidade, a privacidade, a honra, a segurança e a integridade do aluno, sendo limitada às finalidades institucionais, educacionais e de comunicação previstas neste documento.

FINALIDADES ABRANGIDAS

A autorização compreende, conforme a decisão registrada neste termo: registros internos de atividades, apresentações, aulas, eventos, projetos e arquivos históricos; comunicação com alunos, pais, responsáveis e participantes por aplicativos, plataformas, grupos institucionais e informativos; publicação no site institucional; publicação nos perfis oficiais da instituição em redes sociais e plataformas digitais; utilização em folders, cartazes, apresentações, revistas, informativos, convites, banners, portfólios, anuários e demais materiais institucionais; e divulgação das atividades, matrículas, inscrições, turmas, cursos, modalidades, apresentações e eventos da própria instituição.

Quando houver publicação autorizada, a instituição deverá evitar informações pessoais desnecessárias e priorizar a não identificação nominal do aluno. A utilização do primeiro nome, turma ou modalidade somente deverá ocorrer quando adequada à finalidade e aos limites deste consentimento.

O uso em redes sociais e plataformas de terceiros também estará sujeito às políticas próprias dessas plataformas. Este termo não autoriza a venda isolada da imagem do aluno nem sua utilização para publicidade de produtos ou serviços de terceiros sem autorização específica, quando necessária.

GRATUIDADE E PRAZO

A autorização é gratuita e não gera direito a pagamento, remuneração ou compensação financeira pelos usos expressamente abrangidos. Ela permanecerá válida durante o período de vínculo do aluno com a instituição, ressalvadas as limitações legais e os usos realizados antes de eventual revogação.

REVOGAÇÃO

O aluno maior de idade ou o responsável legal poderá solicitar gratuitamente a revogação do consentimento pelos canais de privacidade disponibilizados pela instituição. A partir do recebimento da solicitação, a instituição adotará as providências cabíveis para usos futuros que dependam deste consentimento, observadas as limitações técnicas, materiais já produzidos e hipóteses legais de conservação.

NÃO AUTORIZAÇÃO E PROTEÇÃO DE MENORES

A escolha por não autorizar não deverá impedir a participação do aluno nas atividades regulares nem resultar em tratamento discriminatório. Quando possível, a instituição adotará medidas razoáveis para evitar a divulgação identificável do aluno em usos não autorizados.

Quando o aluno for menor de idade, a utilização observará especialmente sua dignidade, privacidade, segurança e melhor interesse. A instituição evitará conteúdos constrangedores, vexatórios, discriminatórios ou que representem risco indevido. Quando adequado à idade e ao grau de compreensão do menor, sua manifestação também deverá ser respeitada.

DECLARAÇÃO

O assinante declara possuir legitimidade para realizar esta escolha. Quando se tratar de aluno maior de idade, a decisão é realizada pelo próprio titular. Quando se tratar de aluno menor de idade, a decisão é realizada pelo responsável legal identificado no fluxo de assinatura, em nome do aluno indicado neste termo.

A opção registrada abaixo representa uma manifestação livre, informada e inequívoca sobre o conjunto das finalidades descritas neste documento. A resposta será preservada junto ao contrato assinado para fins de comprovação e auditoria.$$,
    ARRAY['nome_assinante', 'qualificacao_assinante', 'nome_aluno', 'cpf_assinante', 'cpf_aluno', 'tipo_assinante', 'relacao_com_aluno']::TEXT[],
    'Modelo único da Alusa, adaptado para assinatura do aluno maior de idade ou do responsável legal pelo aluno menor.',
    0,
    2,
    'SISTEMA',
    true,
    CURRENT_TIMESTAMP
  );
