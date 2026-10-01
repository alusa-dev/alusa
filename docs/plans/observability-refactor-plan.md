# Plano de refatoração da observabilidade

**Data:** 01/10/2026
**Status:** fundação e rollout local das APIs/serviços críticos por domínio implementados; validação de produção, SLOs e configuração externa pendentes.
**Escopo:** `apps/web`, `apps/admin`, `apps/mobile`, `packages/observability`, `packages/finance`, adapters necessários em `packages/lib`, `packages/asaas` e `packages/database`, e documentação operacional.

## 1. Objetivo

Organizar logs, métricas e traces para que operações importantes da Alusa possam ser investigadas de ponta a ponta, sem criar uma gravação adicional no banco por evento, elevar desnecessariamente o tráfego ou misturar telemetria técnica com auditoria financeira e acadêmica.

O plano preserva Sentry onde já está configurado e propõe contratos compartilhados compatíveis com OpenTelemetry. A escolha de transporte, backend de métricas e eventual Collector será confirmada na fase de inventário, considerando runtimes Vercel/Next.js, Edge, Expo e custos observados. Não haverá uma troca de fornecedor por princípio.

## 2. Diagnóstico observado no workspace

- A Web inicializa Sentry em `apps/web/instrumentation.ts` e nos arquivos de configuração client/server/edge. Os traces têm amostragem configurada nos runtimes Web; replay está limitado a rotas públicas selecionadas.
- O Mobile inicializa Sentry em `apps/mobile/src/lib/observability/sentry.ts`, com remoção de `Authorization` e `Cookie`, mas sem uma política de traces configurada nesse módulo.
- `apps/web/lib/observability/api-logger.ts` produzia JSON estruturado para alguns fluxos, enquanto muitas rotas ainda registravam diretamente com `console.*` em formatos diferentes. A migração por domínio foi concluída nesta entrega; os sinks `console` de produção remanescentes serializam objetos estruturados allowlisted.
- `apps/web/lib/perf-logger.ts` registra tempos no console. `withPerfTimer` também inclui `String(error)` nos metadados do erro, o que merece revisão antes de padronizar esse caminho.
- `apps/web/app/api/observability/web-vitals/route.ts` aceita uma medição por POST e a encaminha ao logger de performance; `WebVitalsReporter` envia cada métrica individualmente.
- `packages/finance/src/foundation/metrics-exporter.ts` compõe snapshots operacionais e texto Prometheus a partir de trackers locais de circuit breaker, quota, rate limit, concorrência e chamadas Asaas. O alcance desses snapshots entre instâncias precisa ser verificado no runtime de produção.
- `apps/web/app/api/admin/webhooks/metrics/operational/route.ts` expõe o snapshot sob sessão de usuário admin. Esse endpoint de suporte não deve ser confundido automaticamente com um endpoint de scrape para coletor externo.
- Métricas de webhooks por `contaId` já existem em uma rota administrativa tenant-scoped. Elas são dados operacionais do produto e precisam continuar com autorização e isolamento por conta.
- Há `requestId` e `correlationId` em fluxos distintos, mas o inventário ainda precisa determinar a cobertura e propagação entre API, integração, fila/job e Mobile.

## 3. Princípios e decisões arquiteturais

1. **Sem persistência de telemetria no banco transacional.** Logs técnicos, spans e métricas seguem para o provedor de observabilidade por SDK/exportador com batching. Dados financeiros, acadêmicos e de auditoria seguem persistidos pelos fluxos de domínio já responsáveis por eles.
2. **OpenTelemetry como vocabulário e contexto comum.** Adotar nomes, unidades e atributos consistentes e propagação W3C Trace Context onde os runtimes suportarem. Não instalar instrumentação duplicada sobre a instrumentação já oferecida pelo Next.js/Sentry.
3. **Sentry permanece como ferramenta ativa de erros.** Validar compatibilidade antes de introduzir APIs/exportadores OpenTelemetry adicionais; manter uma única origem de spans para evitar duplicatas.
4. **IDs têm funções diferentes.** `traceId` correlaciona uma execução técnica; `requestId` identifica uma requisição; `correlationId` identifica uma operação de negócio que pode sobreviver a retries. Não substituir uma chave idempotente ou de negócio por um identificador de trace.
5. **Baixa cardinalidade nas métricas.** Não usar `contaId`, usuário, aluno, responsável, cobrança, URL com parâmetros ou identificadores livres como labels. Preferir rota normalizada, método, status, operação e ambiente.
6. **Privacidade por padrão.** Lista allowlist de atributos; sem tokens, credenciais, payloads financeiros, documentos ou dados pessoais. Sanitização deve ocorrer antes da exportação, sem depender só da interface do fornecedor.
7. **Não depender de buffers em memória como entrega durável.** Em serverless, reinício ou escala horizontal pode perder buffers e fragmentar agregações locais. Usar exportação em lote com flush compatível com o runtime; exigir fila durável apenas se houver requisito real de entrega que o SDK/provedor não atenda.
8. **Controles de volume explícitos.** Amostrar traces, reduzir logs repetitivos de sucesso, agregar execuções de jobs e limitar/batchar Web Vitals. Erros relevantes e eventos obrigatórios de auditoria não são descartados pela amostragem de diagnóstico.

## 4. Organização proposta

```text
apps/
  web/
    instrumentation.ts                 # bootstrap Next.js existente
    instrumentation-client.ts          # bootstrap client existente
    lib/observability/
      server.ts                         # adapter Node e configuração de exportação
      edge.ts                           # adapter Edge, apenas recursos suportados
      http.ts                           # helpers/wrapper para Route Handlers
      jobs.ts                           # contexto e resumo por execução
      finance.ts                        # spans de fronteira para Asaas/webhooks
    app/api/observability/web-vitals/   # ingestão validada e em lote, se mantida
  admin/
    instrumentation.ts                 # bootstrap Sentry independente
    lib/observability/                  # adapter do Admin
  mobile/
    src/lib/observability/
      sentry.ts                          # inicialização Sentry/mobile e propagação de trace
    src/lib/api/                        # requestId por chamada e retry

packages/
  observability/                       # novo package interno, agnóstico de app
    src/
      context/                         # requestId, trace context e propagação
      logging/                         # logger estruturado e allowlist
      metrics/                         # nomes, unidades e atributos low-cardinality
      tracing/                         # convenções/helper de spans
      redaction/                       # sanitização compartilhada
      telemetry/                       # port e registro de sink sem buffer de eventos
      index.ts
  finance/
    src/foundation/                    # métricas e instrumentos do domínio financeiro
    src/webhooks/                      # eventos operacionais de processamento

docs/observability/
  overview.md                          # sinais, destinos, ownership e ambientes ativos
  conventions.md                       # campos, nomes, cardinalidade e privacidade
  flows/finance-webhook.md             # fluxo de referência ponta a ponta
  runbooks/                            # alertas e investigação
```

O novo `packages/observability` deve ter responsabilidade limitada aos contratos e instrumentos comuns. Não deve importar Next.js, Prisma, Asaas ou regras de domínio. `packages/finance` continua sendo dono da semântica financeira; as aplicações ficam responsáveis por bootstrap e integração de runtime. Se o inventário indicar que um package separado cria acoplamento desnecessário, pode-se começar com os contratos em package já adequado e separar depois, sem transformar `packages/lib` em destino genérico.

## 5. Contrato mínimo de telemetria

### Log técnico estruturado

Campos de base: `timestamp`, `severity`, `service.name`, `deployment.environment`, `service.version`, `event.name`, `requestId`, `trace_id`, `span_id`, `http.request.method`, `http.route`, `http.response.status_code`, `duration_ms` e `error.type`.

Campos opcionais devem ser allowlisted por evento. `contaId` pode ser incluído em logs internos com controle de acesso quando necessário à investigação tenant-scoped; nunca como dimensão global de métrica. Stack traces ficam restritos ao destino técnico e não são devolvidos à API.

### Métricas iniciais

- HTTP: contagem e duração por rota normalizada, método e classe de status.
- Jobs: execuções, falhas, duração, itens processados e tentativas por nome de job.
- Webhooks: recebidos, processados, retries, falhas, DLQ e idade/backlog da fila.
- Financeiro/Asaas: resultado e latência por operação categorizada, sem dados de cobrança/aluno em labels.
- Browser: distribuição agregada de Web Vitals por métrica, rota normalizada e rating.

Usar histogramas/distribuições para duração, unidades documentadas e nomes semânticos estáveis. Definir os alertas após coletar baseline; não codificar limites arbitrários antes de medir produção.

### Traces

Priorizar um trace por requisição HTTP e propagar contexto para chamadas externas e trabalho assíncrono quando houver suporte. Em jobs acionados posteriormente, criar um novo trace e ligar à operação de negócio por `correlationId` ou link de span apropriado, sem fingir que o mesmo request continua ativo.

## 6. Fases de execução

### Fase 0 — Inventário e baseline

- Mapear pontos de inicialização por app/runtime: Web Node, Edge, browser, Admin, Mobile e jobs.
- Inventariar `console.*`, loggers existentes, captura Sentry, spans, endpoints métricos e instrumentação de Web Vitals.
- Verificar configuração efetiva em produção: DSNs, amostragem, release, redaction, destinos e falhas de envio. Não inferir ativação só pela dependência no lockfile.
- Medir volume, latência de exportação, custo/limites do fornecedor e restrições de runtime.
- Identificar quais métricas financeiras são tenant-scoped e quais são de saúde global da plataforma.

**Saída:** inventário do código e gaps priorizados concluídos; snapshot inicial agregado de 24h dos runtime logs/status do Vercel registrado em `docs/observability/dashboards-and-slos.md`. Baseline representativo pós-rollout, custo, DSNs efetivos, releases/destinos do Sentry e configuração externa ainda dependem dos painéis e dos ambientes de produção.

### Fase 1 — Convenções e fronteiras

- Aprovar o contrato de logs, métricas, traces, IDs, atributos e política de redaction.
- Separar explicitamente telemetria técnica, auditoria de segurança e histórico financeiro/acadêmico.
- Definir política de sampling, filtros de ruído, limites de payload e comportamento quando o fornecedor estiver indisponível.
- Definir modelo de acesso: operação global da plataforma versus indicadores administrativos de cada `contaId`.

**Saída:** `docs/observability/conventions.md`, matriz de retenção/acesso e decisão de instrumentação sem duplicidade implementados.

### Fase 2 — Package e bootstrap compartilhados

- Criar contratos/helpers mínimos em `packages/observability` após confirmar fronteiras e compatibilidade do workspace.
- Adicionar adapters separados para Node/Next, Edge, browser e Expo somente onde os SDKs suportarem os mesmos recursos.
- Padronizar logger estruturado, tratamento de exceções, redaction e propagação de contexto.
- Garantir flush/exportação em lote nos runtimes serverless sem bloquear resposta e sem gravar no banco.
- Consolidar a captura Sentry existente, preservando replay restrito e `sendDefaultPii: false`.

**Saída:** port e bootstrap/adapters implementados para Web Node/Edge/browser e Admin; Mobile mantém Sentry e passa `requestId`/trace ao host de API. A validação de build/teste por runtime consta no relatório final da entrega.

### Fase 3 — Piloto ponta a ponta: webhook financeiro

- Instrumentar recebimento, validação, persistência de evento de domínio, enfileiramento, processamento, chamada Asaas e resultado/retry.
- Correlacionar logs e spans com IDs técnicos; manter `correlationId` de negócio estável entre retries.
- Emitir métricas agregadas de volume, latência, retry, falha, DLQ e backlog.
- Não amostrar fora os registros de auditoria nem alterar a fonte de verdade financeira (webhook/reconciliação).
- Validar isolamento: dashboard tenant-scoped não revela métricas/dados de outra conta; métricas globais não carregam identificadores de tenant.

**Saída:** spans de ingress/job/reconciliação, métricas de resultado/duração/retry/DLQ/backlog e correlação entre tentativas implementados. Confirmação no projeto Sentry e medição real de volume/custo permanecem pendentes.

### Fase 4 — Cobertura incremental

Migrar por domínio e priorização de risco:

1. rotas HTTP e autenticação;
2. jobs financeiros, reconciliação e DLQ;
3. demais integrações externas;
4. Mobile e Admin;
5. Web Vitals e métricas de experiência.

Substituir logs diretos por módulo, não com codemod global. Cada migração deve remover o caminho legado correspondente e preservar respostas HTTP e comportamento do domínio.

**Saída:** instrumentação compartilhada aplicada às rotas e serviços de autenticação, financeiro, matrícula/rematrícula, contratos, eventos, notificações, integrações, credenciais, uploads, jobs, Admin e Mobile. Payloads e identificadores de tenant/aluno/responsável foram removidos dos logs técnicos nos fluxos migrados. Falhas tratadas em telas Web usam eventos fixos com cooldown; chamadas repetitivas de sucesso foram removidas ou agregadas. A varredura de código de produção não encontrou logs raw de request/response/erro; os sinks restantes serializam logs estruturados ou exibem avisos estáticos sem dados de usuário.

### Fase 5 — Operação e otimização

- Criar dashboards separados para saúde da plataforma, webhooks/financeiro, jobs e experiência Web/Mobile.
- Definir SLOs e alertas usando baseline e impacto educacional/financeiro: falha de processamento, idade de backlog, taxa de erro e latência.
- Documentar runbooks de investigação, indisponibilidade de telemetria, alerta de custo e resposta a incidente.
- Revisar custo, sampling, cardinalidade, retenção e acessos periodicamente.

**Saída:** convenções, runbooks e especificação local de dashboards/SLOs criados; dashboards, owners/alertas e revisão de custo precisam ser configurados após baseline no provedor externo.

## 7. Redução de carga e volume

- Exportar logs e spans em lotes via SDK/provedor; nenhuma escrita por evento no Postgres.
- Não gerar log de sucesso para cada item de lote/job; registrar um resumo por execução e erros com contexto suficiente.
- Amostrar traces de sucesso e permitir amostragem maior para erro/lentidão se o backend suportar tail sampling.
- Fazer Web Vitals aceitar lote limitado, com schema Zod, limite de tamanho, allowlist de métricas, sampling de sessão e rate limit por IP no proxy.
- Métricas não devem criar uma query de banco por atualização: contadores/histogramas são agregados no SDK/plataforma. Consultas operacionais que leem tabelas continuam sendo read models tenant-scoped e limitadas/paginadas.
- Avaliar `metrics-exporter.ts` sob múltiplas instâncias: trackers globais em memória podem representar apenas a instância atual. Não apresentá-los como total global sem backend compartilhado ou agregação externa.
- Separar endpoint de scrape/ingestão de painel administrativo. O scrape de serviço, caso necessário, deve ter autenticação de máquina e não expor métricas tenant-scoped; o painel continua autenticado por usuário e filtrado pela conta autorizada.

## 8. Segurança, multi-tenancy e privacidade

- Nunca aceitar `contaId` do client como autorização nem propagar baggage arbitrário enviado por usuário.
- Resolver identidade do tenant no servidor a partir da sessão/vínculo validado; registrar somente o identificador necessário em logs restritos.
- Não colocar PII, payload webhook, documentos, tokens, chaves Asaas ou dados de pagamento em logs, métricas ou spans.
- Redigir antes do envio e testar campos aninhados, headers, query strings e mensagens de erro.
- Não enviar dados observacionais para o client além de `requestId`/`correlationId` já considerados seguros e respostas de erro estáveis.
- Controlar acesso e retenção por sinal; logs de auditoria mantêm seus requisitos de persistência e não seguem política de sampling.

## 9. Critérios de aceite da refatoração

- Existe uma fonte documentada para convenções e bootstrap por runtime.
- Logs das rotas migradas são estruturados e usam nomes/eventos consistentes; nenhuma informação sensível é emitida.
- Pelo menos o piloto webhook correlaciona logs/traces e possui métricas agregadas de volume, erro, duração e backlog/retry.
- `requestId`, `traceId` e `correlationId` têm semântica distinta e cobertura documentada.
- Não há escrita de telemetria no banco transacional nem chamada síncrona adicional por evento de negócio.
- Contadores e histogramas usam labels de baixa cardinalidade; `contaId` não é label.
- Exportação e coleta toleram falha do fornecedor sem derrubar APIs, jobs ou processamento de webhook.
- Métricas administrativas tenant-scoped continuam autorizadas e isoladas por `contaId`.
- Métricas Prometheus não são declaradas globais se forem calculadas de estado local por instância.
- Alertas possuem limiar baseado em baseline, proprietário e runbook.
- Testes da implementação cobrem sanitização, propagação de contexto, sampling/batching, falha do exporter, autorização e isolamento tenant quando aplicável.

## 10. Riscos e mitigação

| Risco | Mitigação |
|---|---|
| Duplicação de spans entre Sentry e OpenTelemetry | Inventariar instrumentação automática e escolher um único caminho de exportação antes do bootstrap compartilhado. |
| Perda de dados por buffer em função serverless | Usar exporter com batching/flush suportado pelo runtime; não tratar memória local como fila durável. |
| Explosão de cardinalidade/custo | Allowlist de labels, normalização de rotas e proibição de IDs de usuário/tenant como dimensão métrica. |
| Vazamento de dado acadêmico/financeiro | Redaction antes do envio, testes de payloads e separação de auditoria do logging técnico. |
| Snapshot local confundido com métrica global | Documentar escopo por instância ou transferir agregação para backend compartilhado; revisar endpoint atual. |
| Migração ampla causar ruído ou regressão | Piloto financeiro, adoção por módulo, compatibilidade de contratos HTTP e remoção incremental de logger legado. |
| Carga extra em API/DB | Batching, sampling, agregação fora do banco, limites no endpoint Web Vitals e nenhum polling de scraping no endpoint do usuário. |

## 11. Fora de escopo

- Mudar provedor de observabilidade sem baseline, análise de compatibilidade e custo.
- Criar tabelas de logs ou telemetria no Prisma.
- Alterar regras de matrícula, cobrança, liquidação, webhooks ou reconciliação.
- Fazer logging de cada ação de usuário como auditoria sem classificação de risco e política de retenção.
- Adicionar dashboard amplo antes de definir sinais, autorização e fonte dos dados.

## 12. Próximo passo

A migração local dos logs técnicos e a instrumentação dos fluxos críticos foram concluídas. O baseline pré-promoção do Vercel está registrado; o próximo ciclo é operacional: confirmar DSNs, releases e taxas de amostragem nos ambientes Sentry/Vercel; promover a mudança pelo fluxo normal de deploy; coletar baseline pós-rollout representativo; e então calibrar SLOs, dashboards e alertas com os owners organizacionais aceitos (Plataforma Web, Operações Financeiras e Produto/Web). Titulares individuais, substitutos e canais ainda precisam ser designados. Após a promoção, revisar custo, retenção, cardinalidade e entrega efetiva dos eventos antes de declarar a cobertura operacional concluída.

## 13. Resultado registrado nesta entrega

- Contratos de log, redaction, contexto W3C, dimensões low-cardinality e porta neutral de telemetria em `packages/observability`, com adapters locais em `packages/lib`, `packages/asaas` e `packages/database`.
- Sentry Web Node/Edge/browser e Admin; amostragem de traces; Web com request ID propagado por `proxy.ts`.
- Métricas HTTP e de job; captura agregada de webhook/Asaas, retry, backlog e DLQ sem IDs de tenant nas dimensões.
- Handler de pagamento, health check e read models financeiros emitem métricas agregadas; erros e chamadas lentas usam eventos estruturados sem mensagem livre ou identificador de tenant.
- Rotas e domínio de upload não registram sucesso por arquivo nem IDs de tenant/reserva; falhas operacionais são estruturadas e a cota emite apenas contadores com operação fixa.
- Logs de matrícula não serializam o estado nem o payload que contém dados de aluno, responsável ou tenant.
- Serviços de domínio compartilhados de aluno/turma/notificações, rate limit, credenciais Asaas, cliente HTTP Asaas, serviços financeiros de API e matrícula/rematrícula usam eventos allowlisted e agregados, sem persistência técnica adicional.
- Telas e hooks Web críticos não imprimem IDs, filtros de tenant, respostas de API, mensagens raw nem payloads de aluno/financeiro no console; falhas selecionadas são capturadas como eventos Sentry estáticos com cooldown.
- Read models financeiros substituem logs por requisição com `contaId` por métricas de rota/estado de cache; logs ficam restritos a erros estruturados e respostas acima de 2 s.
- Os logs diretos de falha dos 19 arquivos que ainda usavam `console.*` em `apps/web/app/api/financeiro` foram substituídos por evento financeiro estruturado com rota estática; o fallback do saldo permanece observável sem expor tenant.
- Canal de console do `AlertService` publica eventos estruturados com severidade e contagem agregada; mensagem, `contaId`, IDs e metadata original não seguem para telemetria técnica.
- Alertas do serviço de webhook usam eventos estáveis, excluem nome livre do evento, hash de token, IDs, tenant e mensagem; eventos repetitivos geram contadores e têm log limitado a uma linha por minuto por evento/instância.
- Handlers financeiros de webhook passaram a emitir eventos JSON estáveis por `logFinanceOperationalEvent` ou pelos loggers estruturados do fluxo; DLQ manual registra contagem agregada sem IDs e o log de sucesso redundante de transferência interna foi removido.
- Limites legados da fila continuam disponíveis apenas como diagnóstico em read models; o avaliador não emite alertas de SLO antes de calibração com baseline.
- Spans de enqueue, processamento assíncrono, preflight, outbox e reconciliação financeira.
- Web Vitals em buffer no cliente e ingestão limitada a seis itens/8 KiB, sem banco.
- Ingress Asaas conta todas as respostas HTTP com rota/status low-cardinality e duração amostrada; respostas de rate limit não criam uma linha de log por tentativa.
- Limite por IP da rota pública de Web Vitals no proxy; a amostragem do cliente não é tratada como controle antiabuso.
- Mobile com request ID estável no retry de refresh e trace propagation limitada ao host configurado.
- Endpoint operacional local restrito a `SUPER_ADMIN`; exporter sem labels de conta.
- Snapshot global de `SUPER_ADMIN` auditado em `SupportAuditLog`; leituras tenant-scoped não emitem gauges globais.
- Documentação de arquitetura, convenções, fluxo financeiro e runbooks em `docs/observability/`.
- Especificação de painéis e matriz de alertas/SLOs com limiares intencionalmente não definidos antes do baseline em `docs/observability/dashboards-and-slos.md`.

Limites remanescentes: a produção observada permanece no commit `88b52069478c3c4809d1bedf567421f9222059c1`, anterior à refatoração. Os nomes de DSN Web existem em Production, mas validade e ingestão ainda não foram comprovadas; `alusa-admin` não tem DSN Sentry cadastrado e as variáveis Expo do Mobile não foram verificadas. Nenhum dashboard ou alerta externo foi criado: as ferramentas disponíveis não expõem configuração de dashboards/drains e não há sessão/conector Sentry autenticada neste workspace. Owners organizacionais foram aceitos; ainda faltam titulares individuais, baseline pós-rollout e limiares SLO. A varredura local de produção deixou somente sinks JSON estruturados e avisos estáticos sem payload ou identificador de usuário.
