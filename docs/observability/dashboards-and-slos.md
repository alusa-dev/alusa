# Dashboards e SLOs: especificação de rollout

Este documento prepara a configuração do projeto Sentry depois que o acesso e o baseline de produção forem confirmados. Ele não declara dashboards, alertas ou SLOs ativos.

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

Os owners organizacionais desta matriz foram aceitos como padrão inicial. Durante a configuração de cada alerta, ainda é preciso registrar a pessoa titular, a substituta e o canal de notificação.

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
- A avaliação local da fila não cria alertas a partir dos limites heurísticos atuais; alertas de produção ficam pendentes de baseline representativo e configuração explícita.
- Nenhum dashboard/alerta externo foi criado. Ainda faltam métricas pós-promoção e atribuição individual de titulares/substitutos. Os owners organizacionais foram aceitos conforme a matriz. O Vercel permite consulta read-only de deployments e runtime logs; o conector `get_project` retorna erro de validação e não há conector/sessão Sentry autenticada disponível para consultar ingestão ou configurar dashboards.
- A topologia e os snapshots locais em memória não devem ser usados como totais globais de produção.
