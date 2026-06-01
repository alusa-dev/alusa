# Política de Segurança da Informação da Alusa

**Versão:** 2026-05-27  
**Última atualização:** 27 de maio de 2026  
**Aplicável a:** Alusa ERP Educacional, site público, aplicação autenticada, portal do responsável/aluno, APIs, integrações financeiras e rotinas operacionais relacionadas.  
**Canal de segurança:** seguranca@alusa.app  
**Canal de privacidade/LGPD:** privacidade@alusa.app

---

## 1. Introdução

A Alusa é uma plataforma de gestão educacional desenvolvida para centralizar rotinas administrativas, acadêmicas, operacionais e financeiras de escolas, cursos e instituições de ensino. Por tratar dados de alunos, responsáveis, colaboradores, contratos, cobranças, pagamentos, documentos, registros acadêmicos e informações financeiras, a segurança da informação é um princípio estrutural da plataforma.

Esta Política de Segurança apresenta, em linguagem pública e objetiva, as práticas, responsabilidades e controles adotados pela Alusa para reduzir riscos, preservar o isolamento entre instituições, proteger dados pessoais e apoiar a continuidade operacional das escolas que utilizam a plataforma.

A Alusa adota uma abordagem de segurança baseada em defesa em profundidade, controle de acesso, isolamento por conta, validação de permissões, segregação de responsabilidades, auditoria, observabilidade, proteção de credenciais e integração financeira segura com provedores externos, especialmente o Asaas.

Esta política não descreve todos os detalhes técnicos internos da plataforma. Determinadas informações, como arquitetura detalhada de rede, regras internas de detecção, formatos de segredo, chaves, rotinas específicas de mitigação e mecanismos operacionais sensíveis, são mantidas sob confidencialidade para proteger a própria segurança da Alusa, das escolas e dos usuários.

---

## 2. Escopo desta política

Esta política se aplica aos ambientes, fluxos e componentes relacionados à Alusa, incluindo:

1. site público da Alusa;
2. área autenticada da escola;
3. portal do responsável e/ou aluno;
4. APIs internas e públicas;
5. rotinas de cadastro, matrícula, rematrícula, contratos, turmas, aulas, frequência, reposições e eventos;
6. módulos financeiros, incluindo cobranças, assinaturas, parcelamentos, pagamentos, transferências, saldo, extrato e reconciliação;
7. integrações com terceiros, incluindo Asaas e suboperadores necessários à operação;
8. rotinas de suporte, administração, observabilidade, auditoria, logs e resposta a incidentes;
9. dados pessoais, acadêmicos, contratuais, financeiros e operacionais tratados no contexto da plataforma.

Esta política complementa os Termos de Uso, a Política de Privacidade, a Política de Cookies, o DPA e demais documentos legais ou contratuais aplicáveis.

---

## 3. Princípios de segurança adotados pela Alusa

A Alusa orienta sua operação por princípios de segurança compatíveis com o contexto de um ERP educacional multi-tenant:

1. **isolamento por instituição:** os dados de cada escola permanecem vinculados à respectiva Conta;
2. **menor privilégio:** usuários acessam apenas os recursos compatíveis com seu papel, vínculo e permissões;
3. **defesa em profundidade:** controles são aplicados em múltiplas camadas, incluindo aplicação, banco de dados, autenticação, autorização, auditoria e infraestrutura;
4. **rastreabilidade:** ações relevantes são registradas de forma compatível com segurança, suporte, investigação e auditoria;
5. **minimização de dados:** a Alusa busca tratar apenas dados necessários às finalidades contratadas, legais, financeiras, operacionais ou de segurança;
6. **segregação de responsabilidades:** regras de interface, API, domínio, financeiro, banco e integrações externas são tratadas em camadas apropriadas;
7. **resiliência financeira:** estados financeiros críticos são derivados de eventos oficiais, webhooks e reconciliação, evitando decisões frágeis baseadas apenas em ações de tela;
8. **proteção de credenciais:** chaves, tokens e segredos são mantidos fora do client e tratados com controles específicos;
9. **privacidade desde a concepção:** novos fluxos devem considerar LGPD, finalidade, necessidade, segurança e retenção;
10. **melhoria contínua:** controles de segurança são revisados e aprimorados conforme evolução do produto, riscos, incidentes, legislação e integrações.

---

## 4. Modelo multi-tenant e isolamento por Conta

A Alusa opera em modelo multi-tenant. A entidade **Conta** representa a escola, curso ou instituição contratante e funciona como o tenant principal da plataforma.

Os dados operacionais da escola, incluindo usuários, alunos, responsáveis, colaboradores, turmas, matrículas, contratos, cobranças, pagamentos, produtos, vendas, eventos, notificações, logs e integrações, são vinculados à Conta correspondente.

A Alusa adota controles para impedir acesso cruzado não autorizado entre contas. Esses controles incluem, conforme aplicável:

1. validação de sessão autenticada;
2. verificação do vínculo do usuário com a Conta;
3. filtros por `contaId` em operações tenant-scoped;
4. validação de permissões por papel ou função;
5. controle de acesso em rotas, APIs e serviços internos;
6. uso de transações e contexto de tenant em operações sensíveis;
7. reforço por Row-Level Security, quando habilitado no ambiente de produção;
8. logs e auditoria para ações administrativas, financeiras e sensíveis.

O isolamento por Conta é uma obrigação estrutural da plataforma. A Alusa trata acessos cross-tenant como exceção operacional, restrita a fluxos específicos de suporte, administração global ou investigação, sempre com controles adicionais de autorização, finalidade e rastreabilidade.

---

## 5. Defesa em profundidade

A Alusa adota defesa em profundidade para reduzir a dependência de um único controle de segurança. Na prática, a plataforma combina mecanismos como:

1. autenticação de usuários;
2. autorização por Conta, papel e vínculo;
3. validação de entrada em APIs;
4. separação entre camadas de interface, API, domínio, financeiro, banco e integrações externas;
5. filtros tenant-scoped em consultas e operações;
6. uso de contexto de tenant em operações de banco;
7. políticas de Row-Level Security quando aplicável;
8. proteção de rotas internas, jobs, webhooks e áreas administrativas;
9. logs técnicos e trilhas de auditoria;
10. monitoramento de falhas e eventos relevantes;
11. redaction de dados sensíveis em logs e ferramentas de observabilidade;
12. proteção de segredos, tokens e credenciais.

A Alusa não afirma que qualquer controle isolado seja suficiente por si só. A segurança da plataforma depende da combinação de controles técnicos, organizacionais, contratuais e operacionais.

---

## 6. Autenticação e sessões

A Alusa utiliza autenticação baseada em credenciais e sessão para controlar o acesso à plataforma. Usuários autenticados recebem acesso conforme sua Conta, papel, vínculo e permissões.

A plataforma adota validações para reduzir riscos como:

1. acesso por credenciais inválidas;
2. tentativa de reutilização indevida de sessão;
3. redirecionamentos suspeitos;
4. acesso a recursos de outra Conta;
5. uso de conta inativa, removida ou sem vínculo válido;
6. exposição indevida de informações internas no processo de autenticação.

A Escola e seus Usuários são responsáveis por proteger suas credenciais, usar senhas fortes, manter e-mails de acesso seguros, não compartilhar contas individuais e comunicar suspeitas de uso indevido.

A Alusa poderá bloquear, suspender, invalidar sessão, exigir nova autenticação ou aplicar medidas adicionais quando identificar risco de segurança, fraude, violação contratual, acesso suspeito ou uso incompatível com a finalidade da plataforma.

---

## 7. Autorização e papéis de usuário

A Alusa permite diferentes perfis de uso, de acordo com o contexto da escola e com as permissões configuradas. Usuários podem atuar, conforme o caso, como administradores, equipe financeira, recepção, professores, responsáveis, alunos ou outros papéis autorizados.

A autorização considera, entre outros fatores:

1. identidade do usuário;
2. Conta ativa vinculada à sessão;
3. papel do usuário na Conta;
4. status do vínculo;
5. escopo do recurso solicitado;
6. relação do usuário com aluno, responsável, turma, contrato, cobrança ou portal;
7. restrições específicas de rotas administrativas, financeiras ou internas.

A Escola é responsável por convidar apenas pessoas autorizadas, revisar permissões, remover acessos de colaboradores desligados, manter perfis coerentes com a função de cada usuário e supervisionar o uso da plataforma por sua equipe.

A Alusa poderá registrar eventos de acesso e ações relevantes para fins de segurança, auditoria, suporte, investigação de abuso, cumprimento contratual e proteção de direitos.

---

## 8. Segurança no Portal do responsável e/ou aluno

O Portal do responsável e/ou aluno é projetado para fornecer acesso restrito às informações compatíveis com o vínculo do usuário, como dados de alunos vinculados, contratos, cobranças, pagamentos, agenda, comunicados e demais recursos disponibilizados pela Escola.

A Alusa adota controles para que:

1. o responsável visualize apenas alunos e informações vinculadas ao seu perfil;
2. o aluno visualize apenas informações compatíveis com sua própria conta, quando houver acesso individual;
3. dados de outra instituição não sejam acessíveis por usuários externos à Conta;
4. informações financeiras sejam apresentadas conforme permissões e contexto do responsável financeiro;
5. ações do portal respeitem autenticação, autorização e escopo por Conta.

A Escola é responsável por cadastrar corretamente os vínculos entre alunos e responsáveis, revisar permissões e manter dados atualizados para evitar acessos indevidos decorrentes de cadastro incorreto.

---

## 9. Segurança de dados acadêmicos e educacionais

A Alusa trata dados acadêmicos e educacionais no contexto da prestação dos serviços contratados pela Escola. Esses dados podem incluir, conforme os módulos utilizados:

1. cadastro de alunos;
2. cadastro de responsáveis;
3. vínculo aluno-responsável;
4. turmas, modalidades, planos e combos;
5. matrículas e rematrículas;
6. contratos e documentos educacionais;
7. frequência, aulas, reposições e agenda;
8. observações acadêmicas;
9. informações relevantes ao atendimento educacional;
10. registros operacionais da escola.

A Escola, enquanto responsável pela operação educacional e normalmente controladora desses dados, é responsável por definir quais informações serão cadastradas, garantir base legal adequada, orientar seus colaboradores, respeitar direitos dos titulares e utilizar a plataforma de forma compatível com a legislação aplicável.

A Alusa adota medidas técnicas e organizacionais para proteger esses dados dentro da plataforma, respeitando o escopo contratado, as configurações da Escola, as obrigações legais aplicáveis e os documentos legais vigentes.

---

## 10. Segurança de dados financeiros

A Alusa possui integração financeira white label com o Asaas para apoiar rotinas como criação de subcontas, onboarding financeiro, cadastro de pagadores, cobranças, assinaturas, parcelamentos, Pix, boleto, cartão, webhooks, extrato, saldo, transferências, antecipações, estornos e reconciliação.

No contexto financeiro, a Alusa adota uma abordagem orientada por rastreabilidade e consistência:

1. cada instituição pode operar com subconta financeira própria, quando aplicável;
2. o responsável financeiro é tratado como pagador nas rotinas financeiras;
3. cobranças e assinaturas são vinculadas ao contexto educacional, como matrícula, plano, contrato ou venda interna;
4. webhooks e leituras oficiais do provedor financeiro são tratados como fonte relevante para atualização de estado financeiro;
5. telas e relatórios da Alusa apresentam estados locais derivados de eventos, sincronizações e reconciliação;
6. falhas, divergências e inconsistências financeiras podem ser analisadas por rotinas de reconciliação e suporte.

A Alusa não substitui o Asaas, instituições financeiras, arranjos de pagamento ou sistemas regulatórios envolvidos no processamento financeiro. Certas operações podem depender de disponibilidade, análise, aprovação, compliance, liquidação, prazos, políticas e regras de terceiros.

A Escola é responsável por configurar corretamente valores, vencimentos, descontos, juros, multas, planos, contratos, responsáveis financeiros, políticas de cobrança e comunicações associadas.

---

## 11. Webhooks financeiros, idempotência e reconciliação

A Alusa utiliza webhooks do Asaas para receber eventos financeiros relevantes. Esses eventos podem indicar criação, atualização, pagamento, atraso, cancelamento, estorno, assinatura, transferência, alteração cadastral, análise de conta ou outros acontecimentos relacionados à operação financeira.

A Alusa adota práticas de processamento seguro de webhooks, incluindo, conforme aplicável:

1. validação do evento recebido;
2. persistência de registros para rastreabilidade;
3. idempotência para evitar duplicidade de efeitos;
4. logs e métricas de processamento;
5. tratamento de falhas e reprocessamento controlado;
6. classificação de eventos por impacto;
7. reconciliação entre estado local e estado do provedor financeiro;
8. proteção de payloads sensíveis por sanitização ou minimização.

Estados financeiros críticos não devem ser tratados como mera ação visual de interface. A plataforma busca refletir eventos oficiais, integrações e reconciliações para preservar consistência financeira, reduzir divergências e apoiar auditoria.

A Alusa poderá reprocessar eventos, reconciliar registros, corrigir divergências e ajustar estados locais quando houver evidência técnica ou financeira suficiente para isso, respeitando logs, permissões, rastreabilidade e integridade da operação.

---

## 12. Proteção de credenciais, tokens e segredos

A Alusa trata credenciais, tokens, chaves de API, segredos de webhook, segredos de sessão, variáveis de ambiente e demais informações sensíveis como ativos críticos de segurança.

Esses dados são mantidos fora do código client-side e não devem ser expostos ao navegador, páginas públicas, logs abertos, mensagens de erro, respostas de API ou commits.

A Alusa adota controles como:

1. armazenamento server-side de segredos;
2. uso de variáveis de ambiente e mecanismos seguros de configuração;
3. criptografia ou proteção adequada para credenciais persistidas, quando aplicável;
4. redaction em logs e observabilidade;
5. separação entre ambiente de produção, homologação e desenvolvimento;
6. rotação ou validação de credenciais quando necessário;
7. limitação de acesso a segredos por função e necessidade operacional.

A Escola e seus Usuários não devem compartilhar tokens, senhas, códigos de autenticação ou credenciais de acesso com terceiros. Suspeitas de comprometimento devem ser comunicadas imediatamente à Alusa pelos canais adequados.

---

## 13. Dados de cartão e meios de pagamento

A Alusa não tem como finalidade armazenar dados completos de cartão de crédito em seus bancos locais. Quando o fluxo de cartão estiver disponível por meio de provedor financeiro, os dados sensíveis de pagamento são tratados conforme as regras, ambientes e responsabilidades do provedor aplicável.

A Alusa poderá armazenar apenas metadados seguros e limitados para fins de exibição, suporte e operação, como bandeira do cartão, últimos quatro dígitos, mês/ano de expiração ou data de atualização, quando tais informações forem necessárias e permitidas.

Tokens transitórios necessários para chamadas ao provedor financeiro podem existir em fluxos técnicos de integração, mas a Alusa evita persistência local indevida de tokens sensíveis de cartão e busca não retorná-los em DTOs de interface.

---

## 14. Logs, auditoria e rastreabilidade

A Alusa mantém registros técnicos e operacionais para apoiar segurança, diagnóstico, suporte, auditoria, prevenção a fraude, investigação de incidentes e cumprimento de obrigações legais ou contratuais.

Esses registros podem incluir, conforme aplicável:

1. identificação da Conta;
2. identificação do usuário ou ator;
3. ação realizada;
4. tipo de entidade afetada;
5. identificador do recurso;
6. data e hora do evento;
7. origem técnica da requisição;
8. hashes ou versões minimizadas de IP e user-agent;
9. metadados operacionais;
10. antes/depois de alterações sensíveis, quando necessário e proporcional;
11. resultado da operação;
12. identificadores de correlação.

A Alusa busca evitar que logs contenham dados sensíveis desnecessários. Quando logs técnicos forem enviados a ferramentas de observabilidade, a plataforma aplica medidas de redaction, minimização ou filtragem conforme a natureza do evento.

Logs e registros de auditoria podem ser mantidos por prazo compatível com segurança, suporte, obrigações legais, defesa de direitos, integridade financeira, prevenção a fraude e necessidade operacional.

---

## 15. Observabilidade e monitoramento

A Alusa utiliza mecanismos de observabilidade para acompanhar disponibilidade, erros, performance, falhas técnicas, eventos de segurança e integridade de rotinas críticas.

Esses mecanismos podem envolver ferramentas de terceiros, desde que configuradas com medidas compatíveis de minimização e proteção de dados. A Alusa evita envio intencional de dados pessoais sensíveis, credenciais, tokens, documentos, chaves financeiras ou segredos para ferramentas de observabilidade.

Quando aplicável, a Alusa utiliza configurações que reduzem exposição de PII, aplicam redaction antes do envio de eventos e restringem replay ou coleta detalhada a áreas não sensíveis.

---

## 16. Segurança em cookies e tecnologias similares

A Alusa utiliza cookies e tecnologias similares conforme descrito na Política de Cookies.

No site público, cookies não essenciais, como analytics e marketing, são utilizados conforme consentimento quando exigido. Na aplicação autenticada, determinados cookies são necessários para login, sessão, segurança, prevenção a abuso, preferências essenciais e funcionamento da plataforma.

A Alusa não usa cookies essenciais para substituir consentimento quando a finalidade for não essencial. Preferências de cookies podem ser gerenciadas conforme os mecanismos disponíveis no site e nos documentos legais aplicáveis.

---

## 17. Segurança de APIs, rotas internas e jobs

A Alusa adota classificação e proteção de rotas conforme a finalidade e o risco de cada endpoint. As rotas podem ser públicas, autenticadas, restritas por papel, protegidas por segredo de cron, protegidas por token de webhook, restritas a administradores globais ou sujeitas a controles adicionais de autenticação.

Rotas internas, jobs, webhooks e áreas administrativas não devem ser tratados como endpoints públicos comuns. A Alusa utiliza mecanismos adicionais, como tokens, segredos, validação de origem, autenticação, autorização, checagem de papel, logs e controles específicos conforme a criticidade.

A plataforma poderá bloquear requisições, limitar acesso, rejeitar payloads, registrar eventos suspeitos ou alterar controles quando identificar risco técnico, abuso, tentativa de exploração, automação indevida ou uso incompatível com a finalidade da API.

---

## 18. Validação de entrada e tratamento de erros

A Alusa adota validação de entrada em formulários, APIs e rotinas internas, conforme a criticidade do fluxo. A validação busca reduzir riscos como payloads inválidos, inconsistência de dados, abuso de parâmetros, acesso por `contaId` indevido, quebra de regras de negócio e erros em integrações externas.

Respostas de erro são estruturadas para informar o usuário de forma útil sem expor stack traces, segredos, credenciais, detalhes internos de infraestrutura, tokens, payloads financeiros sensíveis ou informações de outros tenants.

A Alusa poderá registrar detalhes técnicos adicionais em logs internos, respeitando minimização, segurança e finalidade operacional.

---

## 19. Segurança no desenvolvimento e manutenção

A Alusa é desenvolvida com práticas de engenharia voltadas à segurança, consistência e manutenção de um ERP educacional multi-tenant.

Essas práticas incluem, conforme aplicável:

1. uso de TypeScript;
2. validação de dados com schemas;
3. separação entre interface, API, domínio, financeiro, banco e integrações;
4. testes unitários e E2E para fluxos críticos;
5. revisão de alterações sensíveis;
6. comandos de lint, typecheck, testes e verificações de segurança;
7. análise de dependências e correções de vulnerabilidades conhecidas;
8. proteção contra exposição de segredos em client ou logs;
9. cuidado especial com migrations, dados financeiros, matrículas, contratos e webhooks;
10. validação multi-tenant em novas funcionalidades.

A Alusa busca preservar a integridade acadêmica, financeira e operacional das escolas ao evoluir o produto. Alterações críticas devem considerar impactos em matrícula, cobrança, contrato, portal, webhooks, reconciliação, permissões e isolamento por Conta.

---

## 20. Infraestrutura, hospedagem e banco de dados

A Alusa utiliza infraestrutura em nuvem e banco de dados relacional para operar a plataforma. A segurança da infraestrutura combina responsabilidades da Alusa e responsabilidades dos provedores contratados.

A Alusa adota medidas como:

1. separação de ambientes;
2. controle de variáveis e segredos;
3. uso de conexão server-side para operações sensíveis;
4. exigência de configurações mínimas de segurança em produção;
5. uso de banco de dados com suporte a controles de acesso e políticas de isolamento;
6. proteção de rotas internas;
7. monitoramento de falhas e eventos críticos;
8. backups, restauração e continuidade conforme capacidade operacional e contrato aplicável.

Serviços de terceiros podem ter suas próprias políticas, controles, regiões, subprocessadores, janelas de manutenção, incidentes e limitações. A Alusa seleciona provedores necessários à operação e busca configurar integrações de forma compatível com segurança, privacidade e disponibilidade.

---

## 21. Backups, continuidade e recuperação

A Alusa adota práticas de continuidade operacional para reduzir impacto de falhas, incidentes, indisponibilidade, erro humano, falhas de integração e problemas de infraestrutura.

Essas práticas podem incluir, conforme ambiente e plano aplicável:

1. backups e mecanismos de restauração;
2. monitoramento de disponibilidade;
3. registros de erros;
4. rotinas de reconciliação financeira;
5. reprocessamento controlado de webhooks;
6. segregação de ambientes;
7. runbooks internos para incidentes críticos;
8. revisão pós-incidente quando necessário.

A Alusa envidará esforços razoáveis para manter a continuidade da plataforma, mas não garante operação ininterrupta, livre de falhas, livre de indisponibilidade de terceiros ou imune a eventos externos.

---

## 22. Incidentes de segurança

Um incidente de segurança pode envolver acesso não autorizado, vazamento, perda, alteração indevida, indisponibilidade relevante, suspeita de comprometimento de credenciais, falha de isolamento entre tenants, exposição de dados pessoais, inconsistência financeira crítica ou abuso da plataforma.

Quando identifica ou recebe comunicação sobre incidente, a Alusa poderá adotar medidas como:

1. triagem e classificação do evento;
2. contenção técnica;
3. preservação de evidências;
4. análise de impacto;
5. correção ou mitigação;
6. comunicação à Escola ou usuários afetados, quando aplicável;
7. comunicação a autoridades, quando exigido por lei;
8. revisão de controles;
9. registro interno para auditoria e melhoria contínua.

A comunicação de incidentes observará a legislação aplicável, o contrato vigente, a Política de Privacidade, o DPA e a avaliação técnica e jurídica do caso concreto.

---

## 23. Acesso de suporte e administração

O suporte da Alusa poderá acessar informações estritamente necessárias para diagnosticar problemas, investigar incidentes, auxiliar a Escola, corrigir falhas, validar integrações, responder solicitações legais ou garantir a operação da plataforma.

Esse acesso é tratado como exceção controlada e pode estar sujeito a:

1. autenticação e autorização específicas;
2. restrição por função;
3. finalidade documentada;
4. logs de acesso sensível;
5. minimização de dados;
6. confidencialidade;
7. segregação entre suporte comum, suporte financeiro, administração global e acesso emergencial.

A Alusa não utiliza acesso de suporte para consultar dados de forma livre, indiscriminada ou sem finalidade operacional legítima.

---

## 24. Suboperadores e terceiros

A Alusa utiliza suboperadores e provedores terceiros para viabilizar hospedagem, banco de dados, observabilidade, e-mails transacionais, processamento financeiro, autenticação, suporte, comunicação e outras funções necessárias à operação.

Suboperadores podem tratar dados conforme a finalidade contratada, a natureza do serviço prestado e os contratos ou políticas aplicáveis. Exemplos de categorias de suboperadores incluem:

1. infraestrutura e hospedagem;
2. banco de dados;
3. processamento financeiro;
4. observabilidade e monitoramento;
5. envio de e-mails transacionais;
6. comunicação e suporte;
7. analytics do site público, quando consentido.

A lista pública de suboperadores pode ser mantida em documento próprio e atualizada conforme a evolução da plataforma.

A Alusa não controla integralmente a infraestrutura, disponibilidade, incidentes, políticas internas ou decisões regulatórias dos terceiros utilizados. A Alusa envidará esforços razoáveis para selecionar, configurar e monitorar fornecedores compatíveis com as necessidades de segurança, privacidade e operação do produto.

---

## 25. Responsabilidades da Escola

A segurança da Alusa depende também da atuação responsável da Escola contratante. A Escola é responsável por:

1. cadastrar dados verdadeiros, atualizados e necessários;
2. garantir base legal para tratamento de dados de alunos, responsáveis e colaboradores;
3. configurar corretamente usuários, papéis e permissões;
4. remover acessos de colaboradores desligados ou sem necessidade;
5. orientar sua equipe sobre confidencialidade e uso correto da plataforma;
6. cadastrar corretamente vínculos entre alunos e responsáveis;
7. configurar corretamente planos, contratos, valores, vencimentos, descontos, juros, multas e políticas financeiras;
8. revisar informações antes de gerar cobranças, contratos ou comunicações;
9. comunicar suspeitas de fraude, acesso indevido ou incidente;
10. cumprir leis educacionais, fiscais, trabalhistas, consumeristas, contratuais e de proteção de dados aplicáveis à sua operação.

A Escola não deve utilizar a Alusa para fins ilegais, fraudulentos, abusivos, discriminatórios, incompatíveis com o contexto educacional ou em violação aos Termos de Uso.

---

## 26. Responsabilidades dos Usuários

Cada usuário é responsável por utilizar a Alusa de forma segura e compatível com seu papel. O Usuário deverá:

1. manter suas credenciais em sigilo;
2. usar senha forte e e-mail seguro;
3. não compartilhar sua conta individual;
4. não tentar acessar dados de outra Conta;
5. não burlar permissões, autenticação ou controles técnicos;
6. não inserir dados falsos, abusivos ou incompatíveis com a finalidade educacional;
7. não utilizar automações, scraping ou engenharia reversa sem autorização;
8. não explorar falhas de segurança;
9. comunicar imediatamente suspeitas de acesso indevido ou comprometimento;
10. respeitar a confidencialidade de dados de alunos, responsáveis, colaboradores e da Escola.

A Alusa poderá restringir, suspender ou bloquear acesso de usuários que violem essas responsabilidades ou representem risco à plataforma, à Escola, aos titulares de dados ou a terceiros.

---

## 27. Segurança e LGPD

A Alusa adota medidas técnicas e organizacionais para proteger dados pessoais tratados na plataforma, em conformidade com a LGPD e documentos aplicáveis.

Essas medidas incluem, conforme o caso:

1. controle de acesso;
2. segregação por Conta;
3. registros de aceite legal;
4. registros de consentimento;
5. logs de acesso sensível;
6. processos para solicitações de titulares;
7. minimização de dados;
8. retenção proporcional;
9. proteção de credenciais;
10. tratamento de incidentes;
11. cooperação com a Escola quando esta atuar como controladora dos dados.

A Escola normalmente atua como controladora dos dados acadêmicos, administrativos e financeiros inseridos em sua Conta. A Alusa atua como operadora quando trata esses dados em nome da Escola, sem prejuízo de poder atuar como controladora em dados próprios de conta, faturamento SaaS, suporte, segurança, prevenção a abuso, operação, comunicação e melhoria do serviço.

---

## 28. Retenção e descarte seguro

A Alusa mantém dados pelo tempo necessário às finalidades contratadas, operacionais, financeiras, legais, regulatórias, fiscais, acadêmicas, de auditoria, segurança, suporte e defesa de direitos.

Dados podem ser mantidos mesmo após encerramento de conta ou solicitação de exclusão quando a retenção for necessária para:

1. cumprimento de obrigação legal ou regulatória;
2. exercício regular de direitos;
3. auditoria financeira;
4. prevenção a fraude;
5. investigação de incidente;
6. cumprimento de contrato;
7. preservação de histórico acadêmico ou financeiro necessário;
8. atendimento a autoridades competentes.

Quando não houver mais finalidade legítima ou obrigação de retenção, a Alusa poderá excluir, anonimizar, agregar ou arquivar dados conforme viabilidade técnica, instruções válidas, contrato aplicável e legislação.

---

## 29. Limitações e ausência de garantia absoluta

Nenhuma plataforma digital é completamente imune a riscos. A Alusa adota medidas razoáveis e proporcionais para proteger os dados e a operação, mas não garante segurança absoluta, disponibilidade ininterrupta, ausência total de vulnerabilidades, ausência de falhas de terceiros ou eliminação integral de risco.

Eventos como indisponibilidade de provedores, falhas de internet, incidentes em terceiros, ataques sofisticados, erro humano, configuração incorreta da Escola, credenciais comprometidas, uso indevido por usuário autorizado ou obrigações impostas por autoridades podem afetar a operação.

A Alusa envidará esforços razoáveis para prevenir, detectar, mitigar e responder a eventos de segurança, observados os limites técnicos, contratuais, legais e operacionais aplicáveis.

---

## 30. Reporte de vulnerabilidades

A Alusa incentiva o reporte responsável de vulnerabilidades, falhas de segurança ou suspeitas de exposição indevida.

Relatos podem ser enviados para:

**seguranca@alusa.app**

O reporte deve incluir, sempre que possível:

1. descrição clara da vulnerabilidade;
2. passos para reprodução;
3. URL ou área afetada;
4. impacto potencial;
5. evidências técnicas mínimas;
6. data e horário aproximado;
7. contato do pesquisador ou responsável pelo reporte.

Ao reportar uma vulnerabilidade, o pesquisador ou usuário não deve:

1. acessar, alterar, copiar, apagar ou divulgar dados de terceiros;
2. explorar a falha além do necessário para comprovação;
3. interromper serviços;
4. realizar engenharia social;
5. usar malware, phishing, brute force ou ataques destrutivos;
6. divulgar publicamente a vulnerabilidade antes de comunicação e prazo razoável de correção.

A Alusa poderá priorizar a análise conforme criticidade, impacto, clareza do relatório, risco aos usuários e disponibilidade operacional.

---

## 31. Alterações desta política

A Alusa poderá atualizar esta Política de Segurança para refletir mudanças na plataforma, evolução dos controles, novos suboperadores, alterações legais, melhorias técnicas, incidentes, práticas de mercado ou necessidades operacionais.

A versão vigente será disponibilizada no site da Alusa. Alterações relevantes poderão ser comunicadas por canais apropriados, como e-mail, aviso na plataforma, central legal ou atualização contratual, conforme a natureza da mudança.

O uso contínuo da plataforma após a publicação de nova versão observará as regras dos Termos de Uso e demais documentos aplicáveis.

---

## 32. Contato

Para assuntos de segurança da informação:

**seguranca@alusa.app**

Para solicitações relacionadas à LGPD, privacidade ou direitos dos titulares:

**privacidade@alusa.app**

Para suporte operacional da escola:

A Escola ou usuário autorizado deverá utilizar os canais de suporte disponibilizados pela Alusa ou previstos em contrato.

---

# Anexo I — Resumo público para página `/seguranca`

A Alusa adota medidas técnicas e organizacionais para proteger dados acadêmicos, pessoais, financeiros e operacionais tratados na plataforma.

Como ERP Educacional multi-tenant, a Alusa organiza os dados por Conta, que representa a instituição contratante. O isolamento por Conta, a validação de permissões, o controle de acesso, a proteção de rotas, os logs de auditoria e a integração financeira segura fazem parte da arquitetura de segurança da plataforma.

A Alusa também adota práticas específicas para fluxos financeiros integrados ao Asaas, incluindo tratamento de webhooks, idempotência, reconciliação e proteção de credenciais. Estados financeiros críticos são atualizados com base em eventos e verificações oficiais, não apenas por ações visuais de interface.

A plataforma utiliza observabilidade, redaction de dados sensíveis, registros de aceite legal, logs de acesso sensível e medidas de privacidade compatíveis com a LGPD.

Nenhuma tecnologia elimina todos os riscos, mas a Alusa envidará esforços razoáveis para prevenir, detectar, mitigar e responder a eventos de segurança.

Vulnerabilidades podem ser reportadas para **seguranca@alusa.app**.

---

# Anexo II — Texto curto para o Legal Center

A segurança da Alusa é baseada em isolamento multi-tenant, controle de acesso, validação de permissões, proteção de credenciais, logs de auditoria, observabilidade e práticas específicas para fluxos financeiros integrados ao Asaas. A plataforma adota medidas técnicas e organizacionais para reduzir riscos e proteger dados pessoais, acadêmicos, contratuais, financeiros e operacionais.

---

# Anexo III — Checklist operacional interno recomendado

Este anexo tem caráter operacional e orientativo. Ele não precisa ser publicado integralmente na página pública.

## Segurança multi-tenant

- Confirmar que novas entidades tenant-scoped possuem `contaId`.
- Confirmar filtros por `contaId` em consultas sensíveis.
- Validar sessão, Conta ativa e vínculo do usuário.
- Evitar `contaId` livre vindo do client sem validação.
- Registrar exceções cross-tenant como suporte, global admin ou break-glass.

## Segurança financeira

- Não alterar estado financeiro crítico apenas por ação de tela.
- Usar webhooks e reconciliação como fontes principais de atualização financeira.
- Garantir idempotência em webhooks, jobs e integrações.
- Registrar logs auditáveis em operações financeiras relevantes.
- Não expor API keys, tokens ou segredos Asaas no client.

## Privacidade e LGPD

- Registrar aceite legal quando aplicável.
- Evitar coleta desnecessária de dados.
- Registrar acesso sensível quando pertinente.
- Tratar solicitações LGPD por fluxo documentado.
- Sanitizar payloads e logs quando houver dados pessoais ou financeiros.

## Observabilidade

- Redigir logs sem dados sensíveis desnecessários.
- Aplicar redaction em eventos técnicos.
- Monitorar falhas críticas.
- Ter runbooks para incidente, falha Asaas, vazamento entre tenants, restore e rotação de chaves.

## Produção

- Exigir variáveis e segredos obrigatórios.
- Habilitar controles de isolamento compatíveis com produção.
- Proteger rotas internas, jobs e webhooks.
- Validar headers e tokens de rotinas não públicas.
- Revisar permissões de suporte, global admin e developer.

---

# Anexo IV — Nota sobre linguagem jurídica desta versão

Esta versão foi redigida em tom publicável. Por isso, práticas atuais da Alusa são descritas com expressões como “a Alusa adota”, “a Alusa mantém”, “a Alusa utiliza”, “a Alusa poderá” e “a Alusa envidará esforços razoáveis”.

A expressão “deverá” foi reservada principalmente para obrigações da Escola, dos Usuários ou para obrigações legais/contratuais específicas. Essa distinção evita que o documento público pareça um checklist interno de engenharia e melhora a clareza jurídica do texto.

