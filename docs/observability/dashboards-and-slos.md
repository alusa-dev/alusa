# Dashboards e SLOs de observabilidade

Este documento registra a configuração ativa de observabilidade, os baselines observados e os próximos ajustes necessários. Os targets numéricos de SLO permanecem pendentes de um ciclo de produção representativo e revisão com os owners.

## Dashboards sugeridos

### Saúde da plataforma

- Taxa de requests e taxa de respostas `5xx` por serviço, ambiente, release, rota normalizada e método.
- Distribuição de duração HTTP por rota normalizada e classe de status.
- Erros por serviço/release e traces de amostra relacionados.
- Separar produção de preview/desenvolvimento e nunca agrupar por `contaId`.

### Financeiro e webhooks Asaas

- `finance.webhook.processed`, `.retries` e `.duration` por categoria finita, resultado e provider.
- `finance.webhook.backlog`, `.pending`, `.processing`, `.errored`, `.exhausted`, `.high_retry_backlog`, `.stuck_processing` e `.oldest_pending_age`.
- `finance.asaas.api.calls` e `.duration` por método, rota normalizada, classe de status e resultado.
- Exibir disponibilidade do processamento local, chamadas ao provedor e idade do backlog em painéis separados para facilitar a distinção de causa.
- Não criar widget global com dados de cobrança ou dimensão de conta. Indicadores de uma escola devem continuar em telas tenant-scoped da Alusa.

### Jobs

- Execuções, falhas, duração e itens processados por nome de job e resultado.
- Comparar tentativas, falhas e duração por release; não exibir IDs de execução como dimensão.

### Experiência Web

- Distribuições de LCP, INP, CLS, FCP, FID e TTFB por categoria de página allowlisted e classificação `good`/`needs-improvement`/`poor`.
- Analisar tendências por release e dispositivo apenas se o provider oferecer atributos agregados aprovados.
- Não coletar URL completa, query string, caminho de tenant ou segmento de usuário.

## Matriz para alertas

Defina os valores numéricos após baseline de pelo menos um ciclo representativo de operação e revisão com os responsáveis. Não copie os limites de exemplo de ferramentas externas sem validar impacto.

| Sinal | Condição a calibrar | Proprietário organizacional | Runbook |
|---|---|---|---|
| Falhas de API | taxa e duração de `5xx` sustentadas por rota/serviço | Plataforma Web | disponibilidade e release |
| Backlog financeiro | idade, quantidade de pendentes, crescimento e itens travados | Operações Financeiras + Plataforma | [webhook financeiro](runbooks/finance-webhook.md) |
| Processamento de webhooks | taxa de falha, retries e `exhausted` sustentados | Operações Financeiras | [webhook financeiro](runbooks/finance-webhook.md) |
| Exportação de telemetria | ausência de eventos esperados, falha de envio e volume/custo | Plataforma | [provider e custo](runbooks/provider-and-cost.md) |
| Experiência do usuário | distribuições de Web Vitals por categoria e release | Produto + Web | validar impacto antes de alertar |

Os owners organizacionais desta matriz foram aceitos como padrão inicial. A regra de issues de alta prioridade do projeto Sentry foi atribuída ao time disponível `alusa`; ainda é preciso criar ou identificar os times de Plataforma Web e Operações Financeiras e registrar pessoas titulares, substitutas e canais de notificação.

Para cada alerta, registre: expressão/filtro final; janela e valor calibrados; serviço e ambiente; pessoa titular e substituta dentro do owner organizacional definido acima; canal de notificação; link do dashboard; runbook; data da última revisão.

## Baseline e revisão

1. Confirme DSN, projeto, release, ambiente e amostragem efetivamente implantados.
2. Colete volume e distribuição de duração por sinal sem exportar IDs tenant-scoped.
3. Verifique completude comparando métricas com uma amostra da fila e dos jobs persistidos, sem adicionar consultas por evento.
4. Calibre limites com responsáveis pelos fluxos financeiro e escolar; considere períodos de pico e falhas do Asaas.
5. Crie alertas e dashboards no provider e faça um teste controlado de entrega.
6. Registre valores, owners, links e data de revisão neste documento.

O cálculo local legado de filas ainda retorna limites heurísticos para read models e diagnóstico. Ele não emite eventos de alerta por violação; esses números não são SLOs de produção nem devem ser usados para paging antes da calibração.

### Snapshot inicial observado

Consulta agregada no Vercel, projeto `alusa-web`, ambiente `production`, janela móvel de 24 horas, em 01/10/2026:

| Agrupamento | Contagem |
|---|---:|
| Logs `info` | 4.011 |
| Logs `warning` | 60 |
| Logs `error` | 25 |
| Logs com status `200` | 8.030 |
| Logs com status `304` | 212 |
| Logs com status `308` | 13 |
| Logs com status `404` | 6 |
| Logs com status `400` | 3 |
| Logs com status `405` | 2 |
| Logs com status `206` | 1 |

As sete categorias de status exibidas somam 8.267 entradas; o resumo indicou uma oitava categoria sem mostrá-la. São registros/runtime events agregados pelo Vercel, não uma contagem garantida de requests únicos, queries SQL ou eventos do Sentry. A amostra precede a publicação desta refatoração; compare novamente após promover a mudança. Dados de custo, retenção e volume do Sentry continuam pendentes.

### Atualização de produção antes da promoção local

Consulta agregada read-only ao Vercel para `alusa-web`/`production`, em 01/10/2026 às 19:00 UTC:

| Agrupamento | Contagem |
|---|---:|
| Logs `info` | 4.019 |
| Logs `warning` | 59 |
| Logs `error` | 25 |

O deployment observado permanecia `READY` no commit `88b52069478c3c4809d1bedf567421f9222059c1`; os arquivos locais deste plano ainda não estavam publicados. O agrupamento de runtime errors trouxe 24 ocorrências de alerta operacional de fila de webhook interrompida em `/api/jobs/webhook-maintenance` (de 27/09 a 01/10) e uma ocorrência do alerta de lag do scheduler. O exemplar do deployment anterior continha identificadores de tenant e webhook no corpo do alerta. O canal local de console já allowlista esse sinal; a ausência desses campos precisa ser confirmada após promoção.

A ocorrência de lag mostrava 308 s contra o limite diagnóstico legado de 300 s. Esse limite não foi calibrado como SLO de produção; tratar o evento como observação de baseline e não configurar paging com esse valor sem revisão dos responsáveis financeiros.

Essa consulta não mede chamadas SQL nem custo de exportação. Os dados agrupados do provider são evidência operacional parcial; compare novamente após promoção e valide sinais com os dados agregados de fila já existentes, sem criar polling por evento.

### Snapshot de produção antes da promoção da refatoração

Consulta agregada read-only ao Vercel para `alusa-web`/`production`, janela móvel de 24 horas terminando em 01/10/2026 às 22:15 UTC. O deployment ativo foi confirmado como `READY`, commit `88b52069478c3c4809d1bedf567421f9222059c1`, aliases `alusa.app`, `app.alusa.app` e `www.alusa.app`, região `gru1`.

| Agrupamento | Contagem |
|---|---:|
| Logs `info` | 4.027 |
| Logs `warn` | 58 |
| Logs `error` | 25 |
| Logs com status `200` | 8.253 |
| Logs com status `304` | 229 |
| Logs com status `308` | 12 |
| Logs com status `404` | 5 |
| Logs com status `206` | 3 |
| Logs com status `400` | 3 |
| Logs com status `405` | 2 |

O Vercel informou oito valores distintos de status e exibiu apenas os sete mais frequentes. Esses totais são registros agregados do provider, não requests únicos, chamadas ao banco ou contagem de eventos Sentry. Este é o baseline pré-promoção; repetir a mesma consulta após publicar o commit da refatoração e comparar janelas equivalentes. O snapshot também não mede carga do banco, que deve ser avaliada pelos indicadores operacionais existentes do provedor de banco sem adicionar consultas por evento.

## Estado

- As convenções e nomes acima existem no workspace, mas a existência de um nome não comprova que a métrica esteja chegando ao projeto Sentry.
- A topologia e os snapshots locais em memória não devem ser usados como totais globais de produção.
- A avaliação local da fila não cria alertas a partir dos limites heurísticos atuais; alertas de produção ficam pendentes de baseline representativo e configuração explícita.
- Os owners organizacionais foram aceitos conforme a matriz. Ainda faltam mapear titulares, substitutos e canais de notificação para cada owner.

### Snapshot Sentry após a promoção

Consulta autenticada ao projeto Sentry `javascript-nextjs`, ambiente `production`, em 02/10/2026 às 13:39 UTC:

| Janela | Sinal | Resultado |
|---|---|---:|
| 24 horas | spans de produção | 25.660 |
| 24 horas | spans do release `30cec7e33838c7c3a740961adebaa9e37d999603` | 200 |
| 24 horas | eventos de erro | 0 |
| 7 dias | spans de produção | 170.090 |
| 7 dias | eventos de erro | 1 |
| 7 dias | registros no dataset de logs | 0 |
| 7 dias | amostras retornadas no dataset de métricas | 36 |

Os spans confirmam ingestão do release promovido. O volume de sete dias é somente um baseline inicial, ainda curto para representar ciclo escolar, fechamento financeiro ou pico de matrículas. As amostras de métricas não comprovam cobertura dos sinais financeiros individuais; a tela Application Metrics do Sentry ainda apresenta a opção de iniciar um trial, que não foi ativado. Nenhum poller, uptime check ou consulta adicional à aplicação/banco foi configurado.

As consultas por nome ao dataset `metrics` retornaram zero amostras na janela de 7 dias para `finance.webhook.processed`, `finance.webhook.retries`, `finance.webhook.oldest_pending_age`, `alusa.http.server.requests`, `alusa.job.completed` e `finance.asaas.api.calls`. O código de produção inicializa o SDK com `enableMetrics: true` e registra um adapter para o sink compartilhado, então a ausência por nome precisa ser investigada entre emissão, exportação, release e disponibilidade do produto. Isso não prova ausência de toda a telemetria: os 36 resultados agregados podem corresponder a outros nomes ou formatos. Antes de criar monitores financeiros, validar a ingestão/exportação desses sinais e os requisitos de plano do Sentry. A ativação do trial de Application Metrics não foi feita.

Uma trace de `POST /api/webhooks/asaas` mostrou a rota concluída em aproximadamente 161 ms, enquanto spans HTTP filhos do Upstash apareciam com cerca de 131 s. Essa duração inconsistente não comprova latência da rota nem do Redis em produção. Manter esses spans fora de targets de SLO até validar a instrumentação com uma medição independente de parede no adaptador; evitar suprimir ou alterar spans do SDK sem confirmar a causa.

Foi criado e favoritado o dashboard [Alusa | Saúde de Produção](https://alusa.sentry.io/dashboard/10283240/?project=4511312339468288&statsPeriod=7d), restrito ao projeto `javascript-nextjs` e ambiente `production`, com período padrão de 7 dias e atualização automática a cada 30 minutos. Ele contém widgets para issues não resolvidas, erros não tratados, distribuição de duração p50/p75/p95 e transações de maior volume. As consultas são agregações no Sentry; não executam consultas no banco da Alusa.

O Sentry já possui duas regras de notificação por issues e nenhum Metric Monitor. A regra de issues de alta prioridade está atribuída ao time genérico `alusa` e envia e-mail aos donos das issues, com fallback para membros ativos. A regra “pull requests are ready” continua sem owner e cobre todos os projetos, portanto não foi alterada a partir do escopo do projeto Alusa. A organização tem somente o time genérico `alusa`, sem times específicos para Plataforma Web e Operações Financeiras. Não foram criadas regras numéricas ou paging: os limites permanecem pendentes de baseline representativo, titulares/substitutos e canal aprovado.

O alerta local de fila de webhook interrompida observado nos logs do deployment anterior deve ser acompanhado por Operações Financeiras. Os totais do Vercel e do Sentry são datasets distintos e não devem ser somados.
