# Plano de maturidade da bilheteria online

**Atualizado em:** 08/10/2026
**Escopo:** venda pública de ingressos com mapa e assentos, reservas, cobranças, emissão, estornos, check-in e operação administrativa.
**Meta de negócio confirmada pelo usuário:** suportar mais de 500 compradores simultâneos em jornadas completas. Para o primeiro gate de aceitação, usar 600 compradores sintéticos (20% de margem sobre 500), cada um com assento e pedido exclusivos. Esse ensaio é separado do harness k6 atual: ele exercita apenas leitura GET do mapa, com alvo de 600 VUs sustentados e 1.000 VUs de estresse. VUs de leitura não equivalem a compradores completos e não comprovam a meta de negócio.

## Objetivo

Garantir que compras simultâneas não vendam o mesmo assento, que o estado financeiro e os ingressos convirjam mesmo com retries ou indisponibilidade, e que organizadores e compradores recebam estados e ações claros. Toda operação permanece isolada por `contaId`.

## Situação atual

As correções abaixo estão implementadas no worktree e foram validadas localmente. A validação não equivale a promoção ou confirmação operacional em produção.

| Área | Situação |
| --- | --- |
| Concorrência no mapa | Reserva e checkout usam atualização condicional, ordenação estável dos assentos e lock transacional comum por reserva. Conflitos atualizam a disponibilidade exibida. |
| Pagamento e retries | Checkout idempotente; criação inconclusiva mantém a reserva; webhook e reconciliação tratam repetição, atraso e recuperação após resposta perdida. |
| Integridade e tenant | Operações sensíveis escopadas por conta; revisão tenant sem acesso cruzado concreto; índice único por `contaId` e pagamento impede associação duplicada. |
| Expiração e emissão | Jobs têm limites de lote; expiração consulta o estado financeiro antes de liberar assentos; confirmação encaminha emissão e e-mail pela outbox com retries. |
| Estorno, disputa e check-in | Estados distintos; estorno concorrente protegido; ingressos ficam bloqueados durante estados inconclusivos; check-in usado não é sobrescrito. |
| Interface de eventos | Tabelas, paginação, badges, ações por estado, busca/filtros, diálogos e recibo organizados; textos de interface não expõem o nome do provedor financeiro. |
| Operação | Runbook e matriz de estados disponíveis em [online-ticketing.md](../runbooks/online-ticketing.md). Expiração, reconciliação e inspeção financeira agora registram duração/resultado/falha e não devolvem detalhes internos na resposta HTTP; execução ativa, alertas e responsável operacional ainda precisam de confirmação. Reconciliar manualmente permanece ferramenta restrita de suporte, fora da tabela do organizador. |

## Achados consolidados

### Compra e concorrência no mapa público

- O banco é a autoridade para disponibilidade: a tela pode ficar desatualizada entre leitura e clique, então a reserva precisa continuar sendo condicional e atômica. O conflito deve atualizar o mapa e explicar que os lugares já não estão disponíveis.
- A implementação local serializa mutações da mesma reserva e impede associação duplicada de pagamento por conta. Ainda falta medir contenção, latência e uso do pool sob pico realista de compradores.
- A confirmação financeira pelo webhook executa a confirmação do pedido, a venda dos assentos, a emissão dos ingressos e a inclusão do e-mail na outbox na mesma transação. O job de emissão é recuperação: seleciona até 100 pedidos por conta e a execução processa esses pedidos sequencialmente. Com 600 webhooks ausentes para uma conta, a recuperação pode precisar de até seis execuções do cron de cinco em cinco minutos (cerca de 30 minutos, além da duração das execuções). Não tratar esse job como caminho primário de emissão nem elevar o lote sem medir duração, contenção e pressão no banco.
- Reserva e checkout permitem 1.500 tentativas por subject em cinco minutos. O limite é um orçamento inicial, não comprova suporte a mais de 500 jornadas completas; valide NAT, abuso e falsos positivos em carga isolada de Preview.
- Reserva e checkout têm limite de 1.500 por subject em cinco minutos; status tem limite agregado de 15.000 por subject e 60 por pedido em cinco minutos; sincronização manual de pagamento tem limite de 20 por subject em 15 minutos. O teto agregado do status é aplicado antes da leitura; o bucket por pedido só é criado após validar o token do pedido, evitando cardinalidade Redis por IDs arbitrários. Nenhum bucket é derivado de slug de mapa ou orderId antes da validação/autorização correspondente. Sem IP confiável, endpoints públicos usam um subject compartilhado fixo, sem derivar chaves de `User-Agent`/idioma; isso pode causar `429` coletivo. Valide `TRUST_PROXY_HEADERS=true` e os headers confiáveis no Preview; egressos distintos só separam subjects com essa configuração. A rota pública de leitura do mapa não tem limite explícito na aplicação. `no-store` evita cache de inventário antigo, mas deixa o banco exposto a consultas repetidas; monitore o banco sob carga.
- O rate limit estrito depende do Redis compartilhado em produção e falha fechado se ele estiver indisponível; em desenvolvimento, o limitador pode ser ignorado. Portanto, carga local sem proxy confiável e Redis não representa o comportamento de produção. O ensaio deve validar `TRUST_PROXY_HEADERS=true`, header de IP real pelo proxy confiável e Redis de preview; não simular IPs com cabeçalhos forjados.
- Layout publicado e disponibilidade mutável têm necessidades diferentes de cache. Não servir disponibilidade de assentos a partir de cache que possa permitir uma venda baseada em estado antigo; qualquer cache de conteúdo público deve separar dados estáticos de inventário.
- A meta de negócio segue sendo mais de 500 compradores simultâneos em jornadas completas. O harness GET do mapa tem alvo separado de 600 VUs sustentados e 1.000 VUs de estresse; ele mede apenas leitura e não satisfaz a meta de compra. Depois desse gate, executar testes distintos no preview para reserva concorrente e para jornadas completas que incluam checkout e pagamento sandbox. Cobrir disputa pelos últimos assentos, repetição de reserva/checkout, polling do pedido, indisponibilidade do gateway e múltiplas contas. Limites de requisição e proteção contra reserva abusiva/bots devem ser auditados e calibrados para não penalizar compradores atrás de NAT compartilhado.

### Reserva abandonada e expiração

- A reserva não expira exatamente no segundo em que o contador chega a zero: o job roda a cada cinco minutos, portanto existe atraso operacional variável até a próxima execução e seu processamento.
- O job tenta encerrar a cobrança externa quando o estado permite cancelamento e só libera os assentos depois de confirmar um estado seguro. Se o pagamento estiver pago, ativo não cancelável, ou inconclusivo, mantém a reserva e registra a necessidade de nova reconciliação; não deve liberar o assento por timeout local isolado.
- A criação de cobrança também tenta cancelar uma cobrança tardia quando a reserva já expirou. Timeout ou resposta ambígua não deve virar cancelamento presumido.
- Falta validar em sandbox e explicar ao comprador o prazo efetivo, a confirmação do cancelamento da cobrança, pagamento tardio, reocupação dos assentos e eventual estorno quando os assentos já tiverem sido revendidos.

### Operação e arquitetura

- Os arquivos de cron descrevem a frequência pretendida, mas não provam que a versão ativa executa. Na Vercel, crons precisam ser confirmados no deployment de produção e autenticados com o segredo configurado.
- As rotas de expiração, reconciliação e inspeção financeira agora usam logs estruturados de duração/resultado/falha, respostas HTTP estáveis e métricas seguras de execução parcial; os detalhes internos das findings/erros não são devolvidos ao chamador. Dashboard/alertas e execução real na versão ativa continuam pendentes.
- O teste em modo de produção local não iniciou porque faltou a configuração segura `DATABASE_RLS_URL` e `TRUST_PROXY_HEADERS=true`. O próximo teste deve fornecer essas configurações corretamente, sem desligar RLS ou confiança no proxy.
- O índice único da migration tem risco de bloquear escrita durante criação em tabela grande. O rollout precisa medir volume, fazer preflight de duplicidades e escolher janela/estratégia compatível com o banco de produção.
- A dependência de runtime `packages/lib → packages/finance` foi removida e agora é bloqueada pelo ESLint; o grafo mostra zero ciclos e zero pontes de compatibilidade. Persistência de inscrições, cancelamento, reativação, criação de cobrança e rollback estão em `finance`. A camada web mantém a composição da requisição individual/agrupada e a tradução HTTP, sem escrever diretamente o estado financeiro; esse limite é intencional e está descrito no ADR.

### Experiência do organizador e do comprador

- O fluxo de interface já recebeu paginação, alinhamento de colunas, badges coerentes, contagem de participantes, ações por estado, busca/filtros, diálogos e recibo de estorno. Mudanças futuras devem preservar isso por testes de regressão.
- Os estados curtos precisam continuar distinguindo `Aguardando`, `Verificando`, `Emitindo`, `Concluído`, `Estornando`, `Estorno recusado`, `Em disputa`, `Estornado`, `Expirado`, `Vencido` e `Cancelado`, com ação disponível apenas quando for segura e útil.
- A interface não deve citar o nome do provedor financeiro em títulos, ações, erros ou toasts. Links necessários para o comprador ou suporte podem apontar para uma cobrança sem expor a marca em texto de produto.

## Prioridades e entregas

### P0 — Integridade da compra

**Situação: implementado; testes locais focados passaram.**

- Reservar vários assentos de forma atômica e rejeitar disputa do último assento com conflito controlado.
- Aplicar a mesma serialização transacional a checkout, confirmação, expiração, cancelamento e estorno.
- Impedir checkout duplicado e associação de um pagamento a mais de um pedido na mesma conta.
- Preservar o hold quando a criação ou o resultado do pagamento forem inconclusivos.
- Reconciliar pagamento tardio sem emitir ingresso duplicado nem tomar assento já vendido.
- Confirmar ingresso apenas depois de pagamento autoritativo; impedir download, entrega e check-in quando o estado financeiro bloquear o pedido.
- Fazer estorno e check-in concorrentes convergirem para um único resultado seguro.

**Critério de aceite:** em corrida concorrente, no máximo uma compra detém cada assento; repetição de checkout/webhook não duplica pedido, pagamento, ingresso, e-mail ou liberação de assento.

### P1 — Operação previsível

**Situação: limites e logs estruturados implementados localmente; execução real dos agendamentos, dashboard e alertas ainda precisam ser comprovados no ambiente ativo.**

- Confirmar que expiração, reconciliação, emissão, outbox e inspeção financeira executam na versão ativa, com `CRON_SECRET` configurado.
- Acompanhar duração, volume processado, itens ignorados, erros, retries, backlog e idade dos itens mais antigos.
- Confirmar logs estruturados de duração/resultado/falha nas rotas de expiração, reconciliação e inspeção; diferenciar execução bem-sucedida, parcial, bloqueada por lock e falha total. **Logs e respostas seguras foram implementados localmente; validar ingestão e consulta em produção.** Não registrar tokens, dados pessoais ou segredos.
- Definir alertas para cron ausente/falho, reservas vencidas retidas, pagamentos inconclusivos antigos, emissão pendente e outbox acumulada.
- Documentar quem investiga cada alerta e como executar reconciliação restrita sem intervenção direta no banco.
- Definir metas de serviço para latência e tempo de convergência antes de calibrar frequência dos jobs; manter os limites por lote e por consulta externa.

**Critério de aceite:** cada job tem execução recente observada, erros acionáveis e backlog dentro das metas definidas; resultados inconclusivos têm procedimento e responsável.

### P1 — Promoção segura do banco

**Situação: migrations aplicadas e schema validado somente no banco local de teste.**

- Executar o preflight de duplicidade do índice único em cada ambiente antes da migration.
- Conferir volume e taxa de escrita de `EventMapOrder`; a criação atual do índice não é concorrente e pode bloquear escritas em tabela grande.
- Se necessário, planejar janela de menor tráfego ou migration operacional compatível com o provedor de PostgreSQL.
- Aplicar migrations via pipeline aprovado, validar saúde e preservar caminho de recuperação.

**Critério de aceite:** preflight vazio, migration aplicada sem degradar escrita e leitura, e aplicação ativa confirmada no mesmo commit/artefato.

### P1 — Validação ponta a ponta e carga

**Situação: E2E focada com provider mock passou; execução de servidor de produção local ficou bloqueada por configuração segura de RLS/proxy ausente. A meta confirmada é mais de 500 compradores simultâneos; o gate inicial será 600 jornadas completas. O harness k6 existente cobre leitura GET e reserva controlada, não compra completa. Nenhum teste de carga foi executado. Checkout, confirmação sandbox, webhook, emissão e entrega precisam de ensaio no Preview isolado.**

- Preparar ambiente de teste com `DATABASE_RLS_URL`, `TRUST_PROXY_HEADERS=true` e Redis de rate limit configurados como no ambiente alvo; não desabilitar nem contornar esses controles para fazer o teste passar. O bypass de rate limit em desenvolvimento invalida essa parte do ensaio.
- Cobrir em sandbox: PIX, boleto, cancelamento, pagamento tardio, estorno solicitado/confirmado/recusado, contestação, falha de emissão, e-mail repetido e check-in.
- Testar Conta A tentando ler ou alterar pedidos, assentos e ingressos da Conta B.
- Executar primeiro o perfil GET somente leitura do harness: 600 VUs sustentados e, em ensaio separado, estresse até 1.000 VUs. Esses números validam apenas o endpoint do mapa; não declarar que demonstram mais de 500 compradores ou jornadas completas.
- Em ensaio Preview separado, validar reserva concorrente com inventário sintético exclusivo e rate limit representativo. Antes do gate de 600, fazer ensaios de checkout em patamares menores (por exemplo, 100 e 300) e interromper se aparecer degradação, 429 legítimo, erro financeiro ou backlog crescente.
- Gate de negócio: 600 compradores sintéticos, cada um lendo o mapa, reservando assento exclusivo, gerando checkout PIX e mantendo o pagamento pendente até que os 600 pedidos tenham sido criados. Depois, confirmar os pagamentos na sandbox de forma controlada, receber/processar os webhooks e observar cada pedido até `CONFIRMED` + `ISSUED`; validar também a outbox de e-mail. A ferramenta precisa coordenar a barreira entre criação e confirmação para comprovar que houve mais de 500 pedidos pendentes ao mesmo tempo. Polling de status serve para observar a convergência; não substituir o webhook por sincronização manual em massa.
- Medir em separado a latência do mapa, reserva, checkout, confirmação externa, processamento do webhook, emissão, status e e-mail. Guardar contagens agregadas e identificadores sintéticos necessários à reconciliação, sem registrar tokens de acesso, documentos, e-mails ou segredos.
- Repetir o gate de pico com mais de uma conta e inventários independentes; incluir um ensaio de rede compartilhada/NAT para identificar bloqueios coletivos e outro com egresses confiáveis representativos. Não forjar cabeçalhos de IP.
- Validar recuperação de backlog em cenário separado: suprimir ou atrasar processamento de webhooks apenas no Preview isolado, confirmar que a reconciliação emite uma única vez, medir tempo até o pedido mais antigo ser emitido e verificar que retries não duplicam ingresso nem e-mail. O lote atual de 100 por conta a cada cinco minutos pode exigir seis execuções para 600 pedidos; definir uma meta operacional antes de alterar cadência ou tamanho do lote.
- Usar ramp-up gradual para o perfil GET (100, 300 e 600 VUs, com estresse posterior até 1.000), fase sustentada em 600 e recuperação após pico. Definir carga do perfil completo separadamente com base em telemetria; diferenciar VUs GET, reservas submetidas e compradores que concluem checkout.
- Usar como metas técnicas iniciais (não SLA contratual): GET p95 ≤ 2 s e p99 ≤ 4 s; reserva p95 ≤ 2 s e p99 ≤ 5 s; zero 5xx; pool de conexões abaixo de 80% em sustentação. Separar latência do provedor externo e da aplicação e ajustar as metas após a linha de base.
- No perfil distribuído, não aceitar 429 para uma jornada normal dentro do padrão de uso aprovado; no perfil de rede compartilhada, medir especificamente o impacto dos limites por IP e decidir o orçamento antes da promoção. Confirmar que polling legítimo do status durante a espera não esgota os buckets por pedido ou por origem. A integridade é inegociável em todos os patamares: zero assentos vendidos duas vezes, zero emissão sem confirmação e zero acesso cross-tenant.
- Auditar rate limits e limites de seleção por comprador para reserva/checkout/status. Verificar IP real atrás do proxy, NAT compartilhado, abuso automatizado e respostas de retry; não usar o rate limit como mecanismo de exclusividade de assento.
- Confirmar que dados estáticos do mapa podem ser cacheados sem cachear disponibilidade de assentos de forma que apresente inventário vendável desatualizado.
- Sob contenção, medir e classificar conflitos transitórios de transação/deadlock; só aplicar retry limitado quando a operação for idempotente, com espera progressiva e sem repetir efeitos externos dentro da transação.
- Medir latência p50/p95/p99, conflitos legítimos de assento, espera de lock, conexões do banco, respostas do provedor, retries e crescimento de filas.
- Dimensionar conexões PostgreSQL contra a escala horizontal das Functions: confirmar URL pooled para runtime, URL direta para migrations, singleton Prisma e orçamento combinado de instâncias web, cron e workers. Inspecionar compute/concorrência do Preview separadamente; aumentar concorrência ou `connection_limit` sem orçamento e telemetria não comprova capacidade.
- Verificar que IP usado pelo rate limit corresponde ao cliente real atrás do proxy; calibrar limites com tráfego esperado e NAT compartilhado.
- Executar perfil separado com muitos compradores compartilhando poucos IPs para medir falsos bloqueios. Limites atuais: reserva e checkout 1.500 por subject em cinco minutos; status 15.000 por subject e 60 por pedido em cinco minutos; sincronização manual 20 por subject em 15 minutos. IPs de egress distintos só geram subjects diferentes quando `TRUST_PROXY_HEADERS=true` e o IP real é entregue em header confiável; sem essa configuração, todos caem em um subject compartilhado fixo, que pode causar `429` coletivo. Validar o orçamento contra abuso; não forjar headers de IP para contornar a proteção.

**Critério de aceite:** gates separados e documentados: (1) GET do mapa atinge 600 VUs sustentados e estresse a 1.000 com metas de latência e zero 5xx; (2) reserva concorrente não duplica assento e seus rate limits são medidos; (3) 600 compradores sintéticos concluem a jornada no Preview isolado com pagamento sandbox, emissão e outbox, sem venda duplicada, 429 de uso normal, emissão indevida ou acesso cross-tenant; (4) recuperação por job converge no tempo operacional aprovado e sem efeitos duplicados. A meta de negócio só fica validada depois dos gates 3 e 4, com métricas de banco, NAT/rate limit e latência do webhook. Registrar ambiente, commit, perfil, pico de pedidos pendentes e resultados.

### P1 — Política explícita para cobranças abandonadas

**Situação: há tentativa automática de cancelamento de cobranças elegíveis durante expiração; os estados inconclusivos são mantidos reservados. Falta validar e registrar o comportamento ponta a ponta em sandbox.**

- Aprovar prazo de reserva, tolerância operacional e mensagem exibida antes/depois do vencimento.
- Confirmar cenários em que a cobrança externa é cancelável, já paga, não cancelável ou de criação incerta; a liberação do assento só ocorre após confirmação segura.
- Validar pagamento recebido durante a corrida de expiração/cancelamento e após a revenda do assento. Não emitir ingresso se o inventário não puder ser recuperado; acionar o tratamento financeiro previsto e comunicar o comprador.
- Registrar no runbook como a equipe identifica reserva retida, cobrança ainda ativa e pagamento tardio sem intervenção direta no banco.

**Critério de aceite:** comprador, organizador e suporte recebem estados coerentes; nenhum assento é liberado com cobrança ativa/inconclusiva e nenhum pagamento tardio gera ingresso duplicado ou venda acima da capacidade.

### P2 — Organização das camadas financeiras

**Situação: concluída neste worktree para a fronteira Lib/Finance; a camada web compõe os casos de uso sem persistir diretamente o estado financeiro.**

- Remover dependências de runtime `packages/lib → packages/finance`; serviços de alunos agora recebem uma porta financeira provider-agnostic composta por `apps/web`.
- Mover a criação de inscrições e os lançamentos/pagamentos locais associados para `packages/finance`, preservando o contrato público e a composição com primitivas de contrato/auditoria de `lib`.
- Manter a composição web no serviço de aplicação; qualquer nova escrita em obrigações, cobranças, inscrições financeiras ou estados de grupos deve ser implementada em `packages/finance`.
- Preservar contratos HTTP e compartilhar regras puras sem duplicá-las entre web e finance.
- Preservar em `packages/lib` apenas operações compartilhadas que pertençam àquele pacote.

**Critério de aceite:** `finance` controla as escritas e transições financeiras de inscrição, cobrança, cancelamento e reativação; serviços web apenas compõem casos de uso e traduzem resultados; `lib` permanece sem dependência de runtime em `finance`; grafo sem ciclos/compatibilidade temporária; contratos HTTP, isolamento e idempotência preservados.

## Sequência recomendada de execução

| Etapa | Prioridade | Entrega | Bloqueia a próxima? |
| --- | --- | --- | --- |
| 1. Congelar invariantes | P0 | Regressões automatizadas para concorrência de assento, checkout, webhook, expiração, estorno, disputa, check-in e tenant. | Sim |
| 2. Fechar observabilidade dos jobs | P1 | Logs e respostas seguras uniformes implementados localmente; falta confirmar ingestão, criar consulta de backlog/dashboard e alertas acionáveis. | Sim para operação confiável |
| 3. Preparar ambiente de validação | P1 | Configuração segura de RLS/proxy, duas contas de sandbox, gateway de teste e dados reproduzíveis. | Sim |
| 4. Validar estados financeiros | P1 | Matriz completa de pagamento pendente/tardio, expiração/cancelamento, estorno, chargeback, emissão e outbox. | Sim |
| 5. Validar tenant e concorrência | P1 | Testes adversariais cross-tenant; gate GET separado (600 VUs sustentados/1.000 stress), reserva concorrente e, depois, jornadas completas acima de 500 compradores em sandbox. | Sim para ampliar tráfego |
| 6. Promover migration e aplicação | P1 | Preflight, plano de rollout, aplicação controlada e smoke test no mesmo artefato. | Sim para liberar a versão |
| 7. Extrair camadas gradualmente | P2 | Migrar transições do fluxo de eventos de `packages/lib` para casos de uso/repos de `packages/finance`, uma fatia por vez. | Não bloqueia enquanto controles e operação estiverem comprovados |
| 8. Revisar metas e capacidade | P2 | Recalibrar cadência dos jobs, limites, rate limits e capacidade com dados reais de uso. | Recorrente |

## Decisões de produto ainda necessárias

1. Qual prazo de reserva e tolerância de atraso serão comunicados ao comprador? O processamento periódico faz com que a liberação real possa ocorrer depois do contador chegar a zero.
2. Que janela de atendimento a Alusa promete para confirmar pagamento, emitir ingresso e enviar e-mail? Definir metas antes de aumentar frequência de jobs ou adicionar polling.
3. Quem recebe e atende alertas de pedidos presos, crons falhos e resultados financeiros ambíguos? Cada alerta precisa de responsável e procedimento.

Sem essas decisões, a implementação pode ser tecnicamente segura, mas não é possível declarar capacidade e nível de serviço adequados ao uso esperado.

## Gate para produção

Promover somente depois de todos os itens abaixo terem evidência registrada:

1. Preflight e rollout das migrations concluídos no ambiente alvo.
2. Smoke test autenticado de cada cron na versão ativa e confirmação de execuções reais nos logs.
3. Sandbox ponta a ponta aprovado para compra, expiração, emissão, estorno e disputa.
4. Gates de carga registrados separadamente: GET do mapa a 600 VUs sustentados/1.000 stress; concorrência de reserva; e mais de 500 compradores simultâneos em jornadas completas com checkout/pagamento sandbox. O primeiro gate não substitui os demais.
5. Isolamento Conta A/Conta B e controles de proxy/rate limit verificados.
6. Runbook, alertas, responsável de plantão e recuperação de resultado financeiro ambíguo definidos.

## Evidências locais já coletadas

- E2E focada: 1 cenário passou em Chromium; cobre publicação, compra, conflitos concorrentes, checkout duplicado, resposta perdida, retry de webhook, emissão/PDF e versão publicada.
- Suíte unitária completa de Web: 368 arquivos e 1.739 testes passaram.
- Revalidação focada: 110 testes de eventos/webhooks financeiros e 37 testes de eventos/check-in da Lib passaram com `DATABASE_URL` validada como `alusa_test`; 3 testes verificam `no-store` para sucesso, erro de validação, erro interno e rate limit nas rotas públicas de mapa/reserva/checkout.
- Typecheck de Web, Finance e Lib passaram; validação do schema Prisma e `git diff --check` também passaram anteriormente.
- A suíte Finance completa não foi concluída: alguns testes de KYC tentaram chamadas HTTP externas durante a execução e ela foi interrompida. Os testes de pagamento e eventos foram mantidos em comandos focados; a suíte Finance inteira ainda precisa de isolamento de rede/configuração antes de ser considerada validada.
- Teste PostgreSQL real confirmou que transações para a mesma conta/reserva se serializam.
- O índice único foi validado e aplicado no banco local `alusa_test`; nenhuma migration foi aplicada em produção.
- Revisões de tenant e arquitetura: sem bloqueador; a arquitetura foi aprovada com ressalvas sobre a fronteira Lib/Finance e rollout da migration.
- Nenhum teste de carga foi executado; a meta de negócio acima de 500 jornadas simultâneas segue sem prova até o ensaio isolado de Preview. O perfil GET do mapa é um gate separado e não substitui essa validação. O novo orçamento de rate limit ainda precisa ser medido em rede compartilhada e contra abuso antes de declarar a meta atendida.
