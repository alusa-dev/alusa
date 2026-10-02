# Convenções de observabilidade

## Logs

Crie registros com `createStructuredLog` de `@alusa/observability`. Campos de base:

- `timestamp`, `severity`, `service.name`, `deployment.environment`, `service.version`, `event.name`;
- `requestId`, `traceId`, `spanId` e `correlationId` quando disponíveis;
- `http.request.method`, `http.route`, `http.response.status_code`, `duration_ms`, `error.type`.

Use eventos estáveis, em inglês e em formato `domain.action.result`, por exemplo `finance.webhook.processing.failed`. Mensagens devem ser constantes e sem payload. Erros expõem o tipo e o contexto necessário; não use `String(error)`, corpo de request ou resposta de provedor como atributo.

Os adapters Sentry enviam apenas `warn`, `error` e `fatal` da porta compartilhada. `info`/`debug` ficam nos logs estruturados locais quando necessários. Não registre uma linha para cada item de sucesso de webhook/Asaas; métricas contam o volume e erros importantes mantêm log.

O canal `console` do `AlertService` também usa `createStructuredLog`: título vira um `event.name` estável e somente severidade e contagem agregada allowlisted são emitidas. Alertas operacionais `critical` ficam no nível técnico `warn`, com `alert.severity=critical`, para não inflar agrupamentos de exceções; canais externos preservam a severidade operacional original. Mensagem, `contaId`, IDs e metadata original ficam fora da telemetria técnica. Canais externos de alerta são integrações de operação distintas e devem ter acesso restrito ao público responsável pelo atendimento.

Handlers financeiros de webhook usam `logFinanceOperationalEvent` para falhas de lookup, reconciliação, publicação realtime, outbox, rate limit e replay. O helper aceita nomes de evento fechados, grava apenas `error.type` e contagens explicitamente agregadas; mensagens, IDs e valores de tenant permanecem fora. Fallbacks de Redis repetitivos limitam o log a uma linha por minuto.

Handlers HTTP usam `logApiOperationalEvent` com nomes fechados, caminho/método normalizados, `requestId` validado e `error.type`. Serviços compartilhados usam adapters locais (`logLibOperationalEvent`, `logAsaasOperationalEvent` e `logCredentialOperationalEvent`) sobre o contrato comum. Eles agregam eventos repetidos em janelas de 60 segundos, não aceitam payload, identificador tenant ou mensagem arbitrária e não escrevem no banco. O browser usa `logClientOperationalEvent`: envia somente o nome fixo do evento e o tipo de erro allowlisted ao Sentry, com cooldown local de 60 segundos.

O ingress Asaas registra contador de request e duração amostrada para cada resposta HTTP, por rota normalizada, método e classe de status. Respostas `429` e divergências de IP não geram logs individuais; o rate limiter mantém a métrica/telemetria agregada e falha de Redis tem aviso limitado. Nenhuma dessas métricas consulta ou grava no banco.

## Contexto e IDs

| Campo | Significado | Persistência/propagação |
|---|---|---|
| `requestId` | Uma requisição HTTP | Web valida/reutiliza um header seguro ou gera UUID, passa ao handler e retorna `x-request-id`; Mobile gera um ID por chamada e o conserva no retry de refresh de token |
| `traceId` / `spanId` | Execução e trecho técnico observados pelo SDK | Propagados pelo Sentry/W3C quando amostrados e o destino estiver em `tracePropagationTargets` |
| `correlationId` | Operação de negócio que pode atravessar tentativas | Webhook usa `eventId` do provedor quando válido ou UUID na entrada; worker reutiliza o identificador do evento/registro em retries |

Nunca use `requestId` como chave idempotente, nem assuma que o trace assíncrono de um job é o mesmo trace do request que o enfileirou. Não aceite baggage arbitrário para selecionar tenant.

## Métricas

Nomeie métricas estavelmente, use:

- `counter` para ocorrências/itens;
- `distribution` para durações e medidas amostráveis;
- `gauge` para estado observado (fila/concurrency).

Unidades atuais: `millisecond`, `second` e `unitless` para CLS. Não misture unidades sob o mesmo nome. Dimensões passam por `normalizeMetricDimensions`; somente as chaves aprovadas são aceitas. Exemplos presentes:

| Nome | Sinal | Dimensões |
|---|---|---|
| `alusa.http.server.requests` | requests de API | rota normalizada, método, classe de status |
| `alusa.http.server.duration` | duração HTTP amostrada | as mesmas dimensões low-cardinality |
| `alusa.job.completed`, `alusa.job.failed`, `alusa.job.duration`, `alusa.job.items` | execução e resumo de job | nome de job, resultado |
| `alusa.finance.api.requests`, `alusa.finance.api.duration` | chamadas dos read models financeiros | rota normalizada, estado de cache |
| `alusa.upload.quota.operations` | reserva, rejeição, conclusão e liberação da cota de upload | operação fixa (`reserved`, `rejected`, `committed`, `released`) |
| `finance.webhook.processed`, `finance.webhook.retries`, `finance.webhook.duration` | eventos/tentativas | provider, resultado, categoria finita |
| `finance.webhook.dlq.marked` | lotes movidos à DLQ | contagem e tentativas máximas no evento; sem ID de entidade |
| `finance.webhook.backlog`, `.pending`, `.processing`, `.errored`, `.exhausted`, `.high_retry_backlog`, `.stuck_processing`, `.oldest_pending_age` | snapshot global da fila | provider |
| `finance.payment_webhook.operation` | resultado operacional do handler financeiro | provider, operação estática |
| `finance.webhook_health.accounts_checked`, `.interrupted`, `.recovered`, `.recovery_failed`, `.errors`, `.duration` | resumo por execução do health check | provider, operação estática |
| `finance.webhook.unknown_events`, `finance.webhook.auth.token_rejected`, `finance.webhook.unhandled_critical_events`, `finance.webhook.queue.lag_alerts` | eventos Asaas desconhecidos, rejeições, alertas críticos e lag da fila | provider e resultado fixos |
| `finance.asaas.api.calls`, `finance.asaas.api.duration` | chamadas Asaas | método, rota normalizada, classe de status, resultado |
| `alusa.web.vitals.<nome>` | Web Vitals | categoria superior allowlisted, rating |

Não adicione `contaId`, usuário, aluno, responsável, e-mail, documento, ID de cobrança/pagamento, URL completa, query string, mensagem de erro ou chave de conta às dimensões. Uma leitura tenant-scoped nunca é convertida em métrica global.

## Redaction e atributos

- A lista allowlist é a fronteira principal; redaction compartilhada é defesa adicional.
- `Authorization`, cookies, tokens, chaves, payloads, documentos, contato, dados acadêmicos/financeiros e identificadores de tenant/estudante/responsável não devem sair em logs/traces.
- Não anexe payloads nem variáveis locais em produção. Web Sentry mantém `sendDefaultPii: false` e replay limitado às páginas públicas já selecionadas.
- Não coloque `contaId` em métricas. Logs técnicos sem tenant são o padrão; qualquer necessidade de contexto tenant-scoped requer análise de acesso e redaction específica.

## Sampling e limites de volume

- Web: `SENTRY_TRACES_SAMPLE_RATE` e `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, default 0.05 em produção e 1 em desenvolvimento; valor inválido cai no default.
- Mobile: `EXPO_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, default 0.05 e validação de 0 a 1.
- Performance Web: `OBSERVABILITY_METRIC_SAMPLE_RATE`, default 0.1 para distributions de duração. Contadores de requests/eventos não são amostrados.
- Erros tratados no browser: captura Sentry por evento estático allowlisted, limitada a uma ocorrência por evento a cada 60 segundos por instância de página; sem `captureException(error)` em catches de UI e sem enviar payload, resposta ou mensagem do erro.
- Webhook financeiro: cada item processado emite uma contagem e uma duração; retries emitem uma contagem adicional. O SDK Sentry mantém pontos em buffer e exporta em lotes, sem abrir uma chamada HTTP por item, mas o volume de pontos e o custo no provedor ainda crescem com o volume de webhooks; confira baseline antes de ajustar contadores.
- Read models financeiros emitem contadores e durações amostradas sem access log por requisição ou dimensão de tenant. Somente chamadas acima de 2 s geram um aviso estruturado de baixa cardinalidade.
- Alertas repetitivos de evento desconhecido, rejeição de token e lag da fila atualizam contadores e limitam o log a uma linha por minuto por evento e instância; os registros não incluem tenant, nome livre do evento, hash do token, ID da entrega ou mensagem original.
- Web Vitals: amostragem de sessão pelo mesmo percentual (`NEXT_PUBLIC_OBSERVABILITY_METRIC_SAMPLE_RATE`), buffer no cliente, no máximo seis métricas únicas por lote, flush periódico de 15 segundos/saída de página, corpo máximo 8 KiB e nenhum armazenamento no banco. A rota é uma categoria superior allowlisted, não o pathname livre do usuário.
- A rota pública de Web Vitals recebe limite adicional de 60 POSTs por minuto por IP no proxy; requisições acima do limite terminam antes de executar o handler. O limite exige o rate limiter distribuído em produção e falha com 503 se Redis não estiver disponível. `TRUST_PROXY_HEADERS=true` é necessário para que o bucket use o IP encaminhado pelo proxy confiável.
- Uploads registram métricas agregadas por operação de cota e não gravam logs de sucesso por arquivo. Falhas de armazenamento têm evento estruturado com rota, request ID e tipo de erro, sem IDs de tenant/reserva, nome de arquivo ou URL.
- `API_ACCESS_LOGS=1` ativa access logs de sucesso explicitamente. Em produção, erros e respostas 4xx/5xx são logados; sucessos usam métricas.
- A instrumentação falha fechada para dados e fail-safe para negócio: erro de exporter é descartado pelo port e nunca interrompe request, job ou webhook.

## Snapshot Prometheus

`collectOperationalMetrics` e `toPrometheusText` descrevem apenas o estado conhecido pelo processo. O endpoint autenticado retorna JSON `instance-local` apenas para superadmin; não configure scraper externo contra ele. Um exporter futuro deve usar identidade de máquina, rede/segredo apropriado e uma origem agregada multi-instância.
