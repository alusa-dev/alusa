# Arquitetura de Confiabilidade Financeira, Webhooks e Convergência Asaas da Alusa

**Projeto:** Alusa
**Versão do documento:** 1.0
**Data:** 27 de junho de 2026
**Status:** Proposta arquitetural para implementação
**Escopo:** webhooks, filas, workers, idempotência, reconciliação, polling, Redis, PostgreSQL, rate limit, circuit breaker, observabilidade, segurança, escalabilidade e operação financeira.

---

# 1. Objetivo

Este documento define a arquitetura necessária para tornar a integração financeira da Alusa com o Asaas:

* confiável;
* idempotente;
* auditável;
* escalável;
* recuperável;
* segura em ambiente multi-tenant;
* resistente a eventos duplicados;
* resistente a eventos fora de ordem;
* resistente a indisponibilidades;
* capaz de corrigir divergências automaticamente;
* capaz de operar sem depender da interface ou disponibilidade imediata do Asaas.

O principal problema a ser resolvido é o seguinte:

> Um evento financeiro pode ter sido confirmado no Asaas, mas permanecer com estado incorreto ou desatualizado na Alusa.

Exemplos:

* cobrança paga no Asaas e pendente na Alusa;
* cobrança estornada no Asaas e quitada na Alusa;
* chargeback recebido pelo Asaas e não aplicado localmente;
* assinatura cancelada no Asaas e ativa na Alusa;
* transferência concluída no Asaas e processando na Alusa;
* KYC aprovado no Asaas e pendente na Alusa;
* evento processado duas vezes e efeitos duplicados gerados;
* fila interrompida e eventos não entregues;
* falha após uma operação externa, sem confirmação local;
* reconciliação e webhook alterando a mesma entidade simultaneamente.

A meta não é prometer ausência absoluta de falhas. Isso não é possível em sistemas distribuídos.

A meta é garantir que:

> Toda falha seja limitada, detectável, auditável, repetível com segurança e corrigível automaticamente.

---

# 2. Contexto da Alusa

A Alusa é um ERP Educacional multi-tenant.

A entidade `Conta` representa o tenant principal.

Toda operação financeira deve estar obrigatoriamente isolada por:

```text
contaId
```

Nenhuma cobrança, customer, assinatura, transferência, evento, reconciliação, job, efeito financeiro ou registro de auditoria pode ser buscado ou alterado somente por um identificador externo.

O fluxo financeiro principal da Alusa é:

```text
aluno/responsável
→ matrícula/rematrícula
→ contrato
→ acordo financeiro
→ cobrança/assinatura/parcelamento
→ pagamento
→ webhook
→ consolidação local
→ reconciliação
→ atualização do vínculo educacional
→ portal do responsável/aluno
```

A integração com o Asaas é white label.

Cada conta da Alusa deverá operar com sua própria subconta Asaas.

A Alusa deverá intermediar:

* criação de subconta;
* onboarding e KYC;
* customers;
* cobranças;
* assinaturas;
* parcelamentos;
* Pix;
* boleto;
* cartão;
* webhooks;
* reconciliação;
* extrato;
* saldo;
* transferências;
* antecipações;
* documentos;
* demais operações financeiras suportadas.

---

# 3. Princípios obrigatórios

## 3.1 Webhook como caminho principal

Webhooks do Asaas são a principal fonte de mudança de estado financeiro.

Uma cobrança não deve depender de polling contínuo para ser atualizada.

## 3.2 Estado local como fonte para as telas

As telas da Alusa devem ler o estado local.

O frontend não deve consultar o Asaas diretamente para decidir se uma cobrança está paga, vencida, cancelada ou estornada.

## 3.3 Reconciliação como mecanismo de correção

Consultas ao Asaas devem ser usadas principalmente para:

* reconciliação;
* preflight;
* verificação pontual;
* recuperação de incidente;
* consulta de documentos oficiais;
* correção de divergências;
* ações administrativas autorizadas.

## 3.4 PostgreSQL como fonte canônica da Alusa

O PostgreSQL deve conter informação suficiente para:

* retomar o processamento;
* reprocessar eventos;
* comprovar o histórico;
* identificar divergências;
* impedir duplicações;
* reconstruir read models;
* recuperar-se da perda temporária da fila ou do Redis.

## 3.5 A fila é transporte, não fonte da verdade

A perda ou indisponibilidade do broker não pode significar perda do evento financeiro.

## 3.6 Redis não é ledger financeiro

Redis não deve ser usado como:

* registro definitivo de pagamento;
* única cópia de webhook;
* fonte canônica de saldo;
* registro único de idempotência financeira;
* único mecanismo de auditoria;
* única proteção contra concorrência.

## 3.7 Processamento pelo menos uma vez

A arquitetura deve assumir entrega `at least once`.

Isso significa:

* mensagens podem chegar mais de uma vez;
* jobs podem ser executados mais de uma vez;
* workers podem cair antes do acknowledgement;
* o mesmo efeito pode ser solicitado por diferentes caminhos.

O sistema deve impedir efeitos duplicados por idempotência.

## 3.8 Nenhuma operação financeira sem contaId

Toda busca ou atualização deve incluir o tenant.

Exemplo obrigatório:

```text
contaId + externalPaymentId
```

Exemplo proibido:

```text
externalPaymentId
```

sozinho.

## 3.9 Operações críticas são assíncronas

O endpoint de webhook não deve executar toda a regra financeira.

Ele deve persistir o evento e responder rapidamente.

## 3.10 Falhas precisam ser visíveis

Nenhum erro financeiro pode ser silenciosamente ignorado.

Toda falha deve produzir:

* status de processamento;
* motivo;
* número de tentativas;
* próxima tentativa;
* correlação;
* alerta quando necessário;
* possibilidade de replay;
* auditoria.

---

# 4. Objetivos de confiabilidade

A arquitetura deverá garantir:

1. nenhum evento aceito pela Alusa é perdido;
2. nenhum efeito financeiro é executado duas vezes;
3. eventos fora de ordem não causam regressões inválidas;
4. uma conta não interfere em outra;
5. uma conta problemática não derruba as demais;
6. polling não esgota a API do Asaas;
7. filas não monopolizam banco ou Redis;
8. o sistema suporta escala horizontal;
9. workers podem ser reiniciados sem perda;
10. deploys não abandonam jobs;
11. divergências são corrigidas automaticamente;
12. conflitos ambíguos são enviados para revisão;
13. toda mudança financeira possui histórico;
14. incidentes podem ser reprocessados por janela;
15. a operação pode ser investigada ponta a ponta.

---

# 5. Arquitetura de referência

```text
                         ┌────────────────────────┐
                         │         Asaas          │
                         └───────────┬────────────┘
                                     │
                                  Webhook
                                     │
                         ┌───────────▼────────────┐
                         │ WAF / Load Balancer    │
                         └───────────┬────────────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │ Webhook Ingress Stateless          │
                  │ apps/web                            │
                  │                                     │
                  │ autentica                           │
                  │ valida estrutura mínima             │
                  │ identifica contaId                  │
                  │ gera correlação                     │
                  └──────────────────┬──────────────────┘
                                     │
                              transação curta
                                     │
                  ┌──────────────────▼──────────────────┐
                  │ PostgreSQL                          │
                  │                                     │
                  │ Webhook Inbox                       │
                  │ Transactional Outbox                │
                  │ Estado financeiro                   │
                  │ Idempotência                        │
                  │ Auditoria                           │
                  │ Reconciliação                       │
                  └──────────────────┬──────────────────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │ Outbox Dispatcher                   │
                  └──────────────────┬──────────────────┘
                                     │
                  ┌──────────────────▼──────────────────┐
                  │ Broker/Fila durável                 │
                  │                                     │
                  │ webhook                             │
                  │ comandos externos                   │
                  │ reconciliação                       │
                  │ efeitos internos                    │
                  │ dead letter                         │
                  └──────────────────┬──────────────────┘
                                     │
              ┌──────────────────────▼──────────────────────┐
              │ Workers escaláveis                         │
              │                                            │
              │ packages/finance                           │
              │ packages/domain                            │
              │ packages/asaas                             │
              │ packages/database                          │
              └──────────────────────┬──────────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │ Estado financeiro local        │
                    │ Read models                     │
                    │ Portal e dashboards             │
                    └────────────────┬────────────────┘
                                     │
                    ┌────────────────▼────────────────┐
                    │ Reconciliador                   │
                    │ estado Asaas × estado local     │
                    └─────────────────────────────────┘
```

---

# 6. Divisão por camadas do monorepo

A implementação deve preservar a separação entre interface, API, casos de uso, domínio e integração externa.

## 6.1 apps/web

Responsabilidades:

* endpoint público de webhook;
* autenticação da requisição;
* validação estrutural mínima;
* identificação do tenant;
* endpoints administrativos;
* painel de eventos e reconciliações;
* health checks;
* leitura dos estados locais;
* comandos iniciados pelo usuário;
* autorização e RBAC.

Não deve conter:

* máquina de estados financeira;
* lógica de reconciliação;
* retry complexo;
* mapeamento central de estados;
* processamento integral de webhooks;
* chamadas diretas ao Asaas espalhadas por componentes.

## 6.2 apps/worker

Sugestão de nova aplicação ou processo dedicado.

Responsabilidades:

* consumir filas;
* processar webhooks;
* executar reconciliações;
* publicar outbox;
* processar comandos Asaas;
* executar retries;
* renovar leases;
* shutdown gracioso;
* métricas e heartbeat.

A criação de `apps/worker` é uma sugestão. Antes de criá-lo, deve-se verificar a estrutura real do repositório e os processos existentes.

## 6.3 packages/asaas

Responsabilidades:

* cliente HTTP tipado;
* DTOs externos;
* autenticação;
* timeouts;
* interpretação de respostas;
* erros tipados;
* tratamento de rate limit;
* headers de quota;
* suporte a idempotency keys;
* endpoints de consulta;
* endpoints de escrita;
* telemetria das chamadas.

Não deve conter regras educacionais ou decisões de domínio da Alusa.

## 6.4 packages/finance

Responsabilidades:

* casos de uso financeiros;
* ingestão de webhooks;
* processadores de eventos;
* idempotência;
* reconciliação;
* outbox;
* comandos externos;
* resolução de divergências;
* efeitos financeiros;
* auditoria;
* integração entre estado do provedor e estado local;
* políticas operacionais.

## 6.5 packages/domain

Responsabilidades:

* máquinas de estado puras;
* invariantes;
* decisões de transição;
* regras independentes de banco, HTTP e framework;
* validação de transições;
* regras relacionadas ao vínculo entre pagamento, contrato e matrícula.

## 6.6 packages/database

Responsabilidades:

* helpers transacionais;
* `FOR UPDATE`;
* `SKIP LOCKED`;
* versionamento otimista;
* advisory locks quando necessários;
* claim de jobs;
* paginação;
* utilitários Prisma;
* controle de pool e conexão.

## 6.7 packages/shared

Responsabilidades:

* contratos internos;
* enums compartilhados;
* tipos de eventos;
* códigos de erro;
* DTOs internos;
* constantes estáveis.

## 6.8 packages/asaas-gateway

O log atual indica a existência de um pacote com esse nome.

Antes de criar outra abstração de gateway, deve-se auditar:

* responsabilidade atual;
* diferenças para `packages/asaas`;
* adaptadores existentes;
* possibilidade de reaproveitamento;
* risco de duplicar clientes e regras.

---

# 7. Fluxo de recebimento de webhook

## 7.1 Responsabilidade do endpoint

O endpoint deve executar somente:

```text
1. receber a requisição;
2. aplicar limite de tamanho;
3. validar autenticação;
4. validar estrutura mínima;
5. identificar a subconta;
6. resolver contaId;
7. gerar correlationId;
8. persistir evento na Inbox;
9. persistir intenção de publicação na Outbox;
10. confirmar a transação;
11. retornar resposta de sucesso.
```

Não deve:

* enviar e-mail;
* atualizar dezenas de entidades;
* consultar o Asaas;
* executar reconciliação;
* recalcular dashboard;
* emitir recibo;
* atualizar matrícula fora de um caso de uso;
* bloquear aguardando processamento completo.

## 7.2 Transação de recepção

A gravação da Inbox e da Outbox deve ocorrer na mesma transação.

```text
BEGIN

INSERT WebhookInbox

INSERT FinancialOutboxEvent

COMMIT
```

Se o evento já existir, a recepção deve ser tratada como duplicada válida e não como erro operacional.

## 7.3 Resposta rápida

O endpoint deve responder após a persistência durável.

O processamento das regras de negócio ocorrerá depois.

---

# 8. Inbox durável de webhooks

## 8.1 Finalidade

A Inbox registra de forma imutável todo evento recebido.

Ela permite:

* deduplicação;
* auditoria;
* retry;
* replay;
* investigação;
* recuperação;
* comparação entre versões;
* processamento assíncrono;
* diagnóstico de falhas.

## 8.2 Modelagem sugerida

Os nomes devem ser ajustados ao schema real.

```prisma
model ProviderWebhookEvent {
  id                    String   @id @default(cuid())

  contaId               String
  provider              String
  providerAccountId     String?

  externalEventId       String
  eventType             String

  externalObjectType    String?
  externalObjectId      String?

  payload               Json
  payloadHash           String?

  status                WebhookProcessingStatus
  attempts              Int      @default(0)

  receivedAt            DateTime @default(now())
  providerCreatedAt     DateTime?
  processingStartedAt   DateTime?
  processedAt           DateTime?
  nextRetryAt           DateTime?

  lastErrorCode         String?
  lastErrorMessage      String?

  correlationId         String
  handlerVersion        Int      @default(1)
  schemaVersion         Int      @default(1)

  @@unique([contaId, provider, externalEventId])
  @@index([status, nextRetryAt])
  @@index([contaId, externalObjectId])
  @@index([contaId, eventType, receivedAt])
  @@index([providerAccountId, receivedAt])
}
```

## 8.3 Estados sugeridos

```ts
type WebhookProcessingStatus =
  | "RECEIVED"
  | "QUEUED"
  | "PROCESSING"
  | "PROCESSED"
  | "RETRY_SCHEDULED"
  | "IGNORED"
  | "DEAD_LETTER"
  | "MANUAL_REVIEW";
```

## 8.4 Payload imutável

O payload original não deve ser sobrescrito.

Informações derivadas devem ficar em campos separados ou registros relacionados.

## 8.5 Crescimento da tabela

A Inbox crescerá continuamente.

Devem ser previstos:

* índices seletivos;
* particionamento por data, quando necessário;
* política de retenção;
* arquivamento frio;
* anonimização conforme política de privacidade;
* preservação do necessário para auditoria e obrigações legais.

Nenhuma política de retenção deve ser definida sem validação jurídica, contábil e operacional.

---

# 9. Transactional Outbox

## 9.1 Problema resolvido

Sem Outbox pode ocorrer:

```text
banco confirmou o evento
→ publicação na fila falhou
→ evento ficou parado para sempre
```

Ou:

```text
fila recebeu o evento
→ transação do banco falhou
→ job tenta processar algo inexistente
```

## 9.2 Modelagem sugerida

```prisma
model FinancialOutboxEvent {
  id             String   @id @default(cuid())
  contaId        String

  eventType      String
  aggregateType  String
  aggregateId    String

  payload        Json
  status         OutboxStatus

  priority       Int      @default(0)
  attempts       Int      @default(0)

  availableAt    DateTime @default(now())
  claimedAt      DateTime?
  processedAt    DateTime?

  lastErrorCode  String?
  lastErrorMessage String?

  correlationId  String
  createdAt      DateTime @default(now())

  @@index([status, availableAt, priority])
  @@index([contaId, aggregateId])
}
```

## 9.3 Dispatcher

Um processo independente deve:

1. buscar eventos pendentes;
2. adquirir claim;
3. publicar na fila;
4. marcar como publicado;
5. repetir em falhas transitórias.

## 9.4 Claim concorrente

Para múltiplos dispatchers:

```sql
SELECT id
FROM "FinancialOutboxEvent"
WHERE status = 'PENDING'
  AND "availableAt" <= NOW()
ORDER BY priority DESC, "createdAt" ASC
FOR UPDATE SKIP LOCKED
LIMIT 100;
```

A transação deve permanecer curta.

---

# 10. Mensagens da fila

As mensagens devem ser pequenas.

Exemplo:

```ts
type ProcessProviderWebhookJob = {
  inboxEventId: string;
  contaId: string;
  correlationId: string;
};
```

O payload financeiro completo deve permanecer no PostgreSQL.

Benefícios:

* menos dados sensíveis no broker;
* mensagens menores;
* replay baseado na fonte canônica;
* menor custo;
* menor acoplamento;
* menor risco de divergência.

---

# 11. Estratégia de filas

Não usar uma única fila genérica para tudo.

## 11.1 Filas sugeridas

```text
finance.webhook.high
finance.commands.high
finance.transfers.critical
finance.reconciliation.normal
finance.effects.normal
finance.notifications.normal
finance.bulk.low
finance.dead-letter
```

## 11.2 finance.webhook.high

Eventos recebidos do Asaas:

* pagamentos;
* estornos;
* chargebacks;
* assinaturas;
* transferências;
* antecipações;
* KYC;
* eventos de conta;
* demais eventos financeiros.

## 11.3 finance.commands.high

Comandos iniciados pela Alusa:

* criar cobrança;
* cancelar cobrança;
* alterar vencimento;
* criar assinatura;
* cancelar assinatura;
* criar parcelamento;
* solicitar transferência.

## 11.4 finance.transfers.critical

Transferências e operações sensíveis devem possuir isolamento maior.

## 11.5 finance.reconciliation.normal

Verificações do estado remoto.

## 11.6 finance.effects.normal

Efeitos derivados:

* atualizar situação financeira da matrícula;
* atualizar contrato;
* gerar read models;
* registrar lançamentos;
* atualizar indicadores.

## 11.7 finance.notifications.normal

Comunicações não podem ocupar os workers de pagamentos.

## 11.8 finance.bulk.low

Rotinas volumosas:

* importação;
* sincronização histórica;
* reconstrução;
* reprocessamento em massa.

## 11.9 Dead-letter queue

Eventos sem recuperação automática devem ser enviados para DLQ.

DLQ não significa abandono.

Toda entrada deve possuir:

* contaId;
* origem;
* entidade;
* número de tentativas;
* último erro;
* correlationId;
* data;
* possibilidade de replay;
* alerta.

---

# 12. Escolha do broker

## 12.1 Arquitetura recomendada para produção

```text
PostgreSQL Inbox/Outbox
+
fila gerenciada
+
Redis separado para cache, rate limit e realtime
```

Uma fila gerenciada reduz:

* manutenção;
* configuração;
* risco de perda;
* responsabilidade por failover;
* atualizações;
* operação de cluster;
* incidentes de memória;
* complexidade de escalabilidade.

A escolha concreta depende da nuvem e da infraestrutura real da Alusa.

## 12.2 Alternativa com BullMQ

BullMQ pode ser utilizado, principalmente como etapa intermediária, desde que exista:

* Redis gerenciado;
* instância dedicada para filas;
* AOF habilitado;
* `maxmemory-policy=noeviction`;
* alta disponibilidade;
* TLS;
* monitoramento;
* backups;
* workers separados;
* shutdown gracioso;
* Inbox e Outbox no PostgreSQL.

## 12.3 Regra de segurança

Mesmo usando BullMQ:

> A perda do Redis não pode significar perda definitiva de um evento financeiro.

## 12.4 Separação do Redis

Não utilizar a mesma instância para:

* cache geral;
* filas financeiras;
* sessões;
* rate limits;
* realtime;
* locks;
* notificações.

Configuração recomendada:

```text
Redis de cache
Redis de fila, caso BullMQ seja usado
```

Em operação mais crítica, usar serviços ou clusters separados.

---

# 13. Workers e bulkheads

Os workers devem ser separados por responsabilidade.

```text
WebhookWorker
AsaasCommandWorker
TransferWorker
ReconciliationWorker
OutboxWorker
FinancialEffectWorker
NotificationWorker
BulkWorker
```

Cada pool deve possuir:

* concorrência própria;
* limites próprios;
* circuit breaker próprio;
* fila própria;
* deploy independente;
* métricas próprias;
* escalabilidade independente.

Problemas em notificações não podem bloquear pagamentos.

Problemas em uma subconta não podem bloquear as demais.

Problemas em reconciliação histórica não podem bloquear eventos em tempo real.

---

# 14. Idempotência

Idempotência precisa existir em várias camadas.

## 14.1 Idempotência de recepção

Chave:

```text
contaId + provider + externalEventId
```

## 14.2 Idempotência semântica

Eventos diferentes podem representar o mesmo resultado.

Chave conceitual:

```text
contaId + externalObjectId + targetProviderState
```

## 14.3 Idempotência de comando externo

Exemplos:

```text
create-charge:{contaId}:{cobrancaId}:{version}
cancel-charge:{contaId}:{cobrancaId}:{requestId}
refund-payment:{contaId}:{paymentId}:{refundRequestId}
transfer:{contaId}:{transferRequestId}
```

Operações de escrita não devem ser repetidas automaticamente sem idempotency key ou verificação equivalente.

## 14.4 Idempotência de efeito interno

Exemplos:

```text
settle-cobranca:{cobrancaId}
activate-enrollment:{matriculaId}:{competencia}
create-ledger-entry:{paymentId}:{entryType}
send-payment-notification:{paymentId}:{notificationType}
```

## 14.5 Registro de efeitos

Modelagem sugerida:

```prisma
model FinancialEffectExecution {
  id              String   @id @default(cuid())
  contaId         String

  effectType      String
  aggregateType   String
  aggregateId     String

  sourceType      String
  sourceReference String

  idempotencyKey  String
  status          String

  createdAt       DateTime @default(now())
  completedAt     DateTime?

  @@unique([contaId, idempotencyKey])
  @@index([contaId, aggregateId])
}
```

## 14.6 Regra principal

```text
A mensagem pode ser entregue várias vezes.
O efeito de negócio deve acontecer uma vez.
```

---

# 15. Máquina de estados financeira

Não atualizar status com simples sobrescrita.

Exemplo inadequado:

```ts
await prisma.charge.update({
  data: {
    status: mapProviderStatus(payload.status),
  },
});
```

A transição deve considerar:

* estado atual;
* estado recebido;
* tipo de evento;
* horário do evento;
* horário de chegada;
* versão local;
* histórico;
* snapshot remoto;
* possibilidade de estorno;
* possibilidade de chargeback;
* regras de domínio.

## 15.1 Estados do provedor e estados locais

Não usar um único campo para representar tudo.

Sugestão:

```text
providerStatus
localStatus
processingStatus
reconciliationStatus
```

Exemplo:

```text
providerStatus = RECEIVED
localStatus = PAID
processingStatus = PROCESSED
reconciliationStatus = IN_SYNC
```

## 15.2 Datas importantes

Registrar:

```text
providerCreatedAt
providerUpdatedAt
lastWebhookAt
lastProviderCheckAt
lastReconciledAt
lastAppliedEventId
localStateUpdatedAt
```

## 15.3 Decisão de transição

```ts
type TransitionDecision =
  | {
      kind: "APPLY";
      nextState: string;
      effects: string[];
    }
  | {
      kind: "NOOP";
      reason: string;
    }
  | {
      kind: "RECONCILE";
      reason: string;
    }
  | {
      kind: "MANUAL_REVIEW";
      reason: string;
    };
```

## 15.4 Não usar apenas hierarquia numérica

Estados financeiros não são sempre monotônicos.

Exemplo:

```text
PENDING
→ RECEIVED
→ REFUNDED
```

Ou:

```text
RECEIVED
→ CHARGEBACK
```

Um estado “maior” não é necessariamente definitivo.

A solução deve usar matriz explícita de transições.

## 15.5 Função central

Webhook, reconciliação e ação manual devem usar o mesmo caso de uso:

```ts
applyProviderPaymentSnapshot({
  contaId,
  provider: "ASAAS",
  externalPaymentId,
  providerStatus,
  providerUpdatedAt,
  source: {
    type: "WEBHOOK" | "RECONCILIATION" | "MANUAL_VERIFY",
    referenceId: "...",
  },
});
```

Não criar caminhos independentes para atualizar a mesma cobrança.

---

# 16. Ledger financeiro

Movimentações monetárias relevantes devem ser representadas por lançamentos imutáveis.

Exemplos:

* valor recebido;
* tarifa;
* estorno;
* chargeback;
* antecipação;
* transferência;
* ajuste;
* desconto;
* juros;
* multa.

Não sobrescrever histórico monetário.

Correções devem ocorrer por lançamentos compensatórios.

O saldo e os indicadores podem ser derivados ou projetados em read models, mas o histórico deve permanecer auditável.

A modelagem final do ledger depende do financeiro existente e deve ser validada antes da implementação.

---

# 17. Concorrência

## 17.1 Problemas possíveis

* dois workers processando o mesmo evento;
* webhook e reconciliação simultâneos;
* pagamento e estorno concorrentes;
* cancelamento durante criação;
* replay durante processamento original;
* transferência atualizada por dois caminhos.

## 17.2 Lock de linha

```sql
SELECT *
FROM "Charge"
WHERE "contaId" = $1
  AND "externalPaymentId" = $2
FOR UPDATE;
```

## 17.3 Versionamento otimista

```sql
UPDATE "Charge"
SET
  "status" = $1,
  "version" = "version" + 1
WHERE "id" = $2
  AND "contaId" = $3
  AND "version" = $4;
```

Se nenhuma linha for alterada:

1. recarregar;
2. recalcular a transição;
3. tentar novamente de forma controlada.

## 17.4 Advisory lock

Pode ser usado para processos agregados:

```text
hash(contaId + externalObjectId)
```

Não usar como substituto universal de integridade no banco.

## 17.5 Regras contra travamento

* nunca chamar o Asaas com transação aberta;
* nunca enviar comunicação dentro de lock;
* nunca executar processamento pesado dentro da transação;
* usar transações curtas;
* definir ordem consistente de locks;
* configurar timeout;
* evitar locks de tabela;
* limitar tamanho de lote;
* aplicar `SKIP LOCKED` em consumidores concorrentes.

---

# 18. Reconciliação

## 18.1 Objetivo

Detectar e corrigir divergências entre Asaas e Alusa.

Exemplo:

```text
Asaas = pago
Alusa = pendente
```

## 18.2 Tipos de reconciliação

### Imediata

Executada após:

* falha de webhook;
* transição suspeita;
* evento sem entidade local;
* erro temporário;
* retorno ambíguo de comando externo.

### Recente

Focada em:

* cobranças próximas do vencimento;
* pagamentos recentes;
* eventos em retry;
* estornos;
* chargebacks;
* assinaturas recém-alteradas.

### Periódica

Executada por conta e por janela de tempo.

### Diária

Varredura seletiva de integridade.

### Histórica

Baixa prioridade, paginada e limitada.

### Recuperação de incidente

Executada para uma janela afetada.

## 18.3 Seleção por risco

Não consultar todas as cobranças continuamente.

Selecionar candidatos locais:

```text
reconciliationStatus != IN_SYNC
processingStatus = FAILED
lastWebhookAt ausente
lastProviderCheckAt antigo
status local com alta probabilidade de mudança
evento em dead letter
conta com fila interrompida
entidade alterada durante incidente
```

## 18.4 Reconciliação paginada

Evitar:

```text
reconcileEntireAccount(contaId)
```

Preferir:

```ts
reconcileAccountPage({
  contaId,
  cursor,
  pageSize: 100,
});
```

Ao concluir uma página, enfileirar a próxima.

## 18.5 Orçamento por tenant

```ts
type ReconciliationBudget = {
  maxRequestsPerWindow: number;
  maxConcurrency: number;
  reservedCriticalRequests: number;
  nextAvailableAt: Date;
};
```

## 18.6 Classificação de divergências

```ts
type ReconciliationDecision =
  | "IN_SYNC"
  | "AUTO_REPAIR_SAFE"
  | "RETRY_LATER"
  | "MANUAL_REVIEW"
  | "MISSING_LOCAL_ENTITY"
  | "MISSING_PROVIDER_ENTITY"
  | "TENANT_CONFLICT";
```

## 18.7 Auto-repair

Corrigir automaticamente apenas situações inequívocas.

Exemplo seguro:

```text
Asaas = RECEIVED
Alusa = PENDING
entidade e valores conferem
tenant confere
não existe conflito posterior
```

Exemplo ambíguo:

```text
Asaas = CANCELLED
Alusa = PAID
existe lançamento local posterior
```

Deve ir para revisão.

## 18.8 Registro da reconciliação

Toda execução deve registrar:

* contaId;
* entidade;
* estado local;
* estado remoto;
* decisão;
* ação aplicada;
* origem;
* correlationId;
* data;
* erro;
* usuário, quando manual.

---

# 19. Polling

## 19.1 Polling de interface

O browser consulta a Alusa.

```text
Browser → API Alusa → estado local
```

Não:

```text
Browser → Asaas
```

## 19.2 Polling operacional

Workers procuram:

* eventos pendentes;
* outbox pendente;
* retries;
* reconciliações;
* leases expirados.

## 19.3 Polling do provedor

Usar para:

* reconciliação;
* preflight;
* correção;
* verificação manual;
* recuperação;
* documentos oficiais.

## 19.4 Regra

> Polling não é uma segunda implementação do webhook. É uma rede de segurança seletiva.

---

# 20. Rate limit e controle de chamadas ao Asaas

## 20.1 Limitador hierárquico

```text
limite global da plataforma
→ limite por subconta
→ limite por método
→ limite por endpoint
→ limite por categoria de operação
```

## 20.2 Chaves conceituais

```text
asaas:global
asaas:account:{providerAccountId}
asaas:account:{providerAccountId}:GET
asaas:account:{providerAccountId}:WRITE
asaas:account:{providerAccountId}:TRANSFERS
```

## 20.3 Não operar no limite máximo

A concorrência interna deve possuir margem de segurança.

## 20.4 Limite adaptativo

O cliente deve observar:

* headers de limite;
* quota restante;
* reset;
* `Retry-After`;
* latência;
* taxa de `429`;
* taxa de erro.

## 20.5 Reserva para operações críticas

Uma parte do orçamento deve permanecer disponível para:

* transferências;
* consultas urgentes;
* recuperação;
* verificações críticas.

Reconciliação histórica deve ser suspensa quando a quota estiver baixa.

## 20.6 Não hardcode permanente

Limites externos podem mudar.

A aplicação deve:

* centralizar configuração;
* registrar headers;
* permitir ajuste sem alteração espalhada;
* usar feature flags ou configuração operacional;
* revisar periodicamente a documentação oficial.

---

# 21. Retry

## 21.1 Erros transitórios

Podem ser repetidos:

* timeout;
* indisponibilidade;
* falha de rede;
* DNS temporário;
* `429`;
* `5xx`;
* lock concorrente;
* banco temporariamente indisponível;
* broker temporariamente indisponível.

## 21.2 Erros permanentes

Não devem entrar em retry cego:

* payload inválido;
* autenticação inválida;
* tenant não identificado;
* entidade pertencente a outra conta;
* transição proibida;
* regra de domínio violada;
* credencial revogada;
* entidade inexistente de forma definitiva.

## 21.3 Backoff

Política inicial sugerida:

```text
tentativa 1: imediata
tentativa 2: 5 segundos + jitter
tentativa 3: 30 segundos + jitter
tentativa 4: 2 minutos + jitter
tentativa 5: 10 minutos + jitter
tentativa 6: 30 minutos + jitter
depois: dead letter ou revisão
```

Para rate limit, respeitar o momento de reset informado pelo provedor.

## 21.4 Jitter

Adicionar variação aleatória para evitar que milhares de jobs retornem simultaneamente.

## 21.5 Retry storm

Evitar:

```text
Asaas lento
→ timeout
→ retry imediato
→ mais carga
→ mais timeout
→ mais retry
```

Combinar:

* backoff;
* jitter;
* circuit breaker;
* concurrency limit;
* rate limit;
* prioridade;
* backpressure.

---

# 22. Circuit breaker

## 22.1 Escopo

O circuito deve ser separado por:

```text
providerAccountId + categoria de operação
```

Exemplo:

```text
subconta A com falha
→ circuito de A abre

subconta B
→ continua operando
```

## 22.2 Estados

```ts
type CircuitState =
  | "CLOSED"
  | "OPEN"
  | "HALF_OPEN";
```

## 22.3 Quando aberto

* comandos não urgentes são adiados;
* reconciliações são pausadas;
* apenas probes controlados são permitidos;
* eventos locais continuam sendo persistidos;
* a conta é marcada como degradada;
* alertas são enviados.

## 22.4 Não usar um único circuito global

Uma credencial inválida de uma escola não pode interromper toda a Alusa.

---

# 23. Backpressure

A aplicação precisa reconhecer quando o consumo é mais lento que a entrada.

Mecanismos:

* fila como buffer;
* concorrência limitada;
* rate limit;
* limite por tenant;
* circuit breaker;
* prioridades;
* load shedding;
* suspensão de jobs não críticos;
* autoscaling controlado;
* paginação.

## 23.1 Load shedding

Em degradação:

Manter:

* recebimento de webhooks;
* consolidação de pagamentos;
* transferências críticas;
* estornos;
* chargebacks;
* segurança.

Adiar:

* relatórios;
* reconciliação histórica;
* reconstruções;
* notificações não urgentes;
* importações;
* tarefas em lote.

---

# 24. Fairness multi-tenant

Uma conta grande não pode monopolizar:

* workers;
* fila;
* Redis;
* banco;
* quota Asaas;
* reconciliação;
* conexões.

Aplicar:

* máximo de jobs simultâneos por contaId;
* round-robin entre tenants;
* limite de páginas por execução;
* reenqueue com cursor;
* limite de duração;
* peso por criticidade;
* isolamento de circuit breaker;
* orçamento de requisições.

A confiabilidade financeira não deve ser inferior em planos menores.

Planos comerciais podem diferenciar recursos, mas não integridade financeira.

---

# 25. Redis

## 25.1 Usos adequados

* cache;
* rate limit distribuído;
* debounce;
* realtime;
* semáforos temporários;
* BullMQ, se adotado;
* deduplicação efêmera complementar;
* proteção contra stampede.

## 25.2 Usos inadequados

* fonte canônica;
* ledger;
* única cópia de webhook;
* único registro de pagamento;
* única idempotência;
* única auditoria;
* único lock de entidade financeira.

## 25.3 Configuração para BullMQ

* Redis dedicado;
* AOF;
* `noeviction`;
* TLS;
* alta disponibilidade;
* backup;
* monitoramento;
* alerta de memória;
* alerta de conexões;
* alerta de latência;
* shutdown gracioso;
* retenção controlada de jobs.

## 25.4 Dados nos jobs

Não armazenar:

* chaves;
* tokens;
* dados bancários completos;
* payloads sensíveis desnecessários.

Preferir IDs que referenciem dados persistidos no banco.

---

# 26. Cliente HTTP Asaas

O cliente deve centralizar:

* base URL;
* autenticação;
* headers;
* timeout;
* cancelamento;
* métricas;
* logs;
* correlação;
* rate limit;
* retries;
* idempotency keys;
* circuit breaker;
* erros tipados.

## 26.1 Timeouts

Definir timeout por categoria.

Não permitir chamadas sem limite de tempo.

## 26.2 Retry de operações de leitura

Pode ser permitido para falhas transitórias, dentro de limites.

## 26.3 Retry de operações de escrita

Não repetir automaticamente uma escrita sem:

* idempotency key;
* confirmação segura;
* consulta posterior;
* caso de uso que suporte resultado ambíguo.

## 26.4 Resultado ambíguo

Exemplo:

```text
Alusa enviou criação
→ Asaas processou
→ conexão caiu antes da resposta
```

A Alusa não pode simplesmente criar novamente.

Deve:

1. manter comando local com chave;
2. consultar pelo identificador ou referência;
3. reconciliar;
4. confirmar o resultado;
5. só repetir quando seguro.

## 26.5 Coalescimento de consultas

Chamadas iguais e simultâneas de leitura podem ser consolidadas.

Exemplo:

```text
cinco componentes pedem o mesmo status de conta
→ uma chamada externa
→ resultado compartilhado e cacheado
```

Isso é especialmente importante para informações como:

* status da conta;
* documentos;
* informações comerciais;
* visibilidade de antecipação;
* KYC.

---

# 27. Otimização das chamadas atuais

O log compartilhado indica chamadas diretas e repetidas ao Asaas durante carregamentos de tela.

A auditoria deve verificar:

* chamadas duplicadas;
* efeitos duplicados do React em desenvolvimento;
* múltiplos componentes buscando o mesmo recurso;
* ausência de cache;
* ausência de request coalescing;
* rotas consultando o Asaas a cada render;
* endpoints não usando read models locais;
* chamadas desnecessárias para informações pouco mutáveis.

## 27.1 Estratégia recomendada

Para dados pouco mutáveis:

```text
webhook
→ atualiza read model local
→ tela lê banco/cache
```

Para dados sem webhook adequado:

```text
job periódico
→ atualiza snapshot local
→ tela lê snapshot
```

Consulta direta apenas quando realmente necessário.

---

# 28. Pool de conexões PostgreSQL

A escala horizontal multiplica pools.

Exemplo:

```text
instâncias web × conexões
+
workers × conexões
+
schedulers
+
migrations
+
suporte
```

O limite precisa ser pensado globalmente.

## 28.1 Regras

* Prisma Client singleton por processo;
* pool menor por worker;
* orçamento global;
* PgBouncer ou pool gerenciado;
* timeout de aquisição;
* alerta de saturação;
* limite de concorrência baseado no banco;
* conexão separada para migrations quando necessário.

## 28.2 Não resolver apenas aumentando pool

Aumentar conexões pode transferir o gargalo para o PostgreSQL.

## 28.3 Métricas

```text
pool_active
pool_idle
pool_waiting
pool_acquire_duration
query_duration
lock_wait_duration
transaction_duration
```

---

# 29. Índices e banco de dados

Índices devem refletir os acessos operacionais.

Exemplos:

```text
contaId + externalEventId
status + nextRetryAt
contaId + externalObjectId
status + availableAt + priority
contaId + reconciliationStatus
contaId + lastProviderCheckAt
```

Evitar:

* consultas sem contaId;
* scans globais frequentes;
* offset muito alto em tabelas volumosas;
* transações longas;
* JSON sem campos auxiliares para busca;
* índices redundantes em excesso.

Usar paginação por cursor para grandes volumes.

---

# 30. Load balancing e escala horizontal

## 30.1 Webhook ingress stateless

Qualquer instância deve poder receber qualquer evento.

Não depender de:

* memória local;
* sticky session;
* arquivo local;
* job armazenado no processo;
* cache local como deduplicação definitiva.

## 30.2 Escala independente

Escalar separadamente:

* web;
* webhook ingress;
* workers;
* reconciliação;
* notificações;
* rotinas em lote.

## 30.3 Autoscaling por fila

Não usar somente CPU.

Métricas principais:

```text
queue_depth
oldest_message_age
backlog_per_worker
arrival_rate
processing_rate
failure_rate
provider_rate_limit
database_saturation
```

## 30.4 Limite de escala

Mais workers não ajudam quando o gargalo é:

* rate limit do Asaas;
* banco;
* Redis;
* lock;
* conexão;
* endpoint específico.

O autoscaling deve obedecer a capacidade dos componentes inferiores.

## 30.5 Topologia recomendada

Inicialmente:

* uma região de escrita;
* múltiplas zonas de disponibilidade;
* banco gerenciado redundante;
* fila gerenciada;
* workers em múltiplas instâncias.

Evitar active-active multi-região prematuro para escrita financeira.

Para disaster recovery, considerar região secundária e procedimento controlado de failover.

---

# 31. Shutdown gracioso

Ao encerrar um worker:

```text
1. marcar readiness como false;
2. parar de receber novos jobs;
3. aguardar jobs ativos;
4. renovar lease enquanto necessário;
5. concluir ou devolver o job;
6. fechar conexões;
7. encerrar o processo.
```

Evitar término abrupto.

O broker pode reenviar a mensagem, por isso o processamento precisa continuar idempotente.

---

# 32. Segurança

## 32.1 Webhook

* validar mecanismo oficial de autenticação;
* não confiar apenas em IP;
* limitar tamanho;
* aplicar HTTPS;
* usar comparação segura;
* validar tenant;
* validar estrutura;
* preservar compatibilidade com campos novos;
* aplicar rate limit cuidadoso;
* não bloquear tráfego legítimo do Asaas.

## 32.2 Segredos

* armazenar em cofre de segredos;
* criptografar;
* controlar acesso;
* rotacionar;
* nunca registrar em log;
* nunca enviar ao frontend;
* associar à conta correta;
* auditar leitura e alteração.

## 32.3 Logs

Não incluir:

* API keys;
* tokens;
* documentos completos;
* dados bancários completos;
* cartões;
* payload sensível desnecessário.

## 32.4 Operações administrativas

Ações como:

* replay;
* reconciliação manual;
* reativação;
* cancelamento;
* transferência;
* alteração de vínculo;

devem exigir:

* RBAC;
* justificativa;
* usuário;
* data;
* auditoria;
* confirmação quando crítica.

## 32.5 Manual não significa sobrescrita

Não oferecer campo para “editar status financeiro”.

A ação manual deve chamar o mesmo caso de uso usado pelo sistema.

---

# 33. Identificação segura do tenant

Mapeamento recomendado:

```text
configuração do webhook
→ subconta Asaas
→ integração financeira local
→ contaId
```

Uma entidade conceitual de integração deve possuir:

```text
contaId
providerAccountId
status
webhookConfigurationId
webhookSecretReference
lastWebhookAt
lastSuccessfulProviderCallAt
circuitState
reconciliationState
```

Colocar em quarentena quando:

* tenant não puder ser identificado;
* identificadores forem conflitantes;
* objeto pertencer a outra subconta;
* autenticação falhar;
* integração estiver desativada.

Nunca usar fallback que procure uma cobrança globalmente pelo ID externo.

---

# 34. Saúde da integração e fila

Estados sugeridos:

```ts
type IntegrationHealth =
  | "HEALTHY"
  | "DEGRADED"
  | "SILENT"
  | "INTERRUPTED"
  | "RECOVERING"
  | "DISABLED";
```

## 34.1 HEALTHY

* webhooks recentes;
* sem backlog anormal;
* sem divergência relevante;
* chamadas externas normais.

## 34.2 DEGRADED

* aumento de falhas;
* latência alta;
* circuit breaker intermitente;
* retries crescendo.

## 34.3 SILENT

* movimentação esperada;
* nenhum webhook recebido em janela anormal.

## 34.4 INTERRUPTED

* fila externa interrompida;
* endpoint indisponível;
* credencial inválida;
* falha persistente.

## 34.5 RECOVERING

* fila restaurada;
* backlog sendo processado;
* reconciliação de recuperação em execução.

---

# 35. Recuperação de incidente

Exemplo: webhook indisponível por seis horas.

Procedimento:

```text
1. detectar incidente;
2. limitar o impacto;
3. corrigir causa raiz;
4. validar endpoint;
5. reativar a entrega, quando aplicável;
6. processar backlog;
7. iniciar reconciliação da janela;
8. ampliar a janela com margem de segurança;
9. corrigir divergências;
10. verificar efeitos derivados;
11. confirmar ausência de dead letters;
12. produzir relatório;
13. encerrar somente após comprovar convergência.
```

## 35.1 Margem da janela

Se o incidente começou às 10h:

```text
reconciliar desde antes das 10h
```

A margem cobre:

* relógios diferentes;
* atraso;
* eventos em trânsito;
* falhas iniciadas antes da detecção.

## 35.2 Critério de encerramento

O incidente só é encerrado quando:

* backlog está normal;
* não existem eventos críticos pendentes;
* reconciliação foi concluída;
* divergências foram resolvidas ou classificadas;
* saúde da integração voltou ao normal.

---

# 36. Painel operacional interno

A Alusa deverá possuir uma área administrativa para suporte e engenharia.

## 36.1 Visão geral

* saúde por conta;
* saúde do Asaas;
* filas;
* backlog;
* DLQ;
* circuit breakers;
* quotas;
* reconciliações;
* incidentes.

## 36.2 Eventos

Exibir:

* externalEventId;
* eventType;
* contaId;
* objeto;
* horário;
* status;
* tentativas;
* erro;
* correlationId;
* handlerVersion.

Ações:

* visualizar payload sanitizado;
* reprocessar;
* enviar para revisão;
* reconciliar objeto;
* abrir trilha completa.

## 36.3 Entidade financeira

Exibir:

* estado local;
* estado do provedor;
* estado de reconciliação;
* último webhook;
* última consulta;
* último evento;
* histórico de transição;
* efeitos gerados;
* divergências.

## 36.4 Ações administrativas

* verificar agora;
* reprocessar evento;
* reconciliar objeto;
* reconciliar janela;
* pausar comandos externos;
* retomar integração;
* abrir incidente;
* resolver pendência.

Todas com auditoria.

---

# 37. Observabilidade

## 37.1 Correlação

A correlação deve atravessar:

```text
requisição
→ Inbox
→ Outbox
→ broker
→ worker
→ chamada Asaas
→ transação
→ efeito
→ notificação
```

Campos:

```json
{
  "traceId": "...",
  "correlationId": "...",
  "contaId": "...",
  "provider": "asaas",
  "providerAccountId": "...",
  "externalEventId": "...",
  "externalObjectId": "...",
  "jobId": "...",
  "queue": "...",
  "attempt": 2,
  "previousState": "PENDING",
  "nextState": "PAID",
  "decision": "APPLIED"
}
```

## 37.2 Métricas de webhook

```text
webhook_received_total
webhook_duplicate_total
webhook_invalid_total
webhook_persist_duration
webhook_processing_duration
webhook_processing_failure_total
webhook_oldest_pending_age
webhook_dead_letter_total
```

## 37.3 Métricas de fila

```text
queue_depth
queue_oldest_message_age
queue_processing_rate
queue_failure_rate
queue_retry_total
queue_stalled_total
queue_dlq_total
```

## 37.4 Métricas do Asaas

```text
asaas_request_total
asaas_request_duration
asaas_timeout_total
asaas_rate_limited_total
asaas_quota_remaining
asaas_circuit_open_total
asaas_error_total
```

## 37.5 Métricas financeiras

```text
financial_transition_total
financial_invalid_transition_total
financial_idempotency_conflict_total
financial_effect_failure_total
financial_divergence_total
financial_auto_repair_total
financial_manual_review_total
```

## 37.6 Banco

```text
db_pool_active
db_pool_waiting
db_pool_acquire_duration
db_query_duration
db_lock_wait_duration
db_transaction_duration
```

## 37.7 Redis

```text
redis_memory_usage
redis_connection_count
redis_latency
redis_eviction_total
redis_reconnect_total
```

---

# 38. Alertas

Alertar quando:

* existir qualquer DLQ financeira crítica;
* evento permanecer pendente além do SLO;
* fila crescer continuamente;
* worker não enviar heartbeat;
* nenhuma entrega ocorrer em conta com movimentação;
* fila externa estiver interrompida;
* quota estiver baixa;
* `429` aumentar;
* circuit breaker permanecer aberto;
* pool PostgreSQL saturar;
* Redis se aproximar do limite;
* divergências aumentarem;
* reconciliação diária não terminar;
* taxa de erro ultrapassar limite;
* idempotency conflicts aumentarem;
* efeito financeiro falhar repetidamente.

Alertas devem possuir:

* severidade;
* runbook;
* conta afetada;
* componente;
* correlationId ou incidente;
* responsável;
* política de escalonamento.

---

# 39. SLOs iniciais

Metas iniciais, sujeitas a load tests:

| Indicador                        |              Meta inicial |
| -------------------------------- | ------------------------: |
| Persistência durável do webhook  |   p99 abaixo de 1 segundo |
| Consolidação de evento crítico   | p99 abaixo de 60 segundos |
| Evento perdido após aceite local |                      zero |
| Efeito financeiro duplicado      |                      zero |
| Divergência recente detectada    |            até 15 minutos |
| Reconciliação periódica completa |              até 24 horas |
| DLQ crítica sem triagem          |       menos de 15 minutos |
| Disponibilidade do ingress       |         99,9% ou superior |

Também definir:

* RPO;
* RTO;
* janela de manutenção;
* política de incidentes;
* critérios de degradação.

---

# 40. Testes

## 40.1 Testes unitários

Cobrir:

* mapeamento de estados;
* matriz de transições;
* regressões;
* idempotência;
* classificação de erros;
* decisões de reconciliação;
* políticas de retry;
* geração de chaves;
* isolamento por contaId.

## 40.2 Testes de propriedade

Gerar combinações de:

* eventos duplicados;
* ordens diferentes;
* timestamps diferentes;
* estados intermediários;
* retries;
* concorrência.

Provar invariantes como:

```text
o mesmo conjunto de eventos não pode gerar duas baixas
```

## 40.3 Testes de integração

Usar banco real de teste para:

* unique constraints;
* locks;
* transações;
* outbox;
* Inbox;
* concorrência;
* `SKIP LOCKED`;
* versionamento otimista.

## 40.4 Contract tests

Validar:

* payloads do Asaas;
* campos obrigatórios;
* campos adicionais;
* mudanças de schema;
* tratamento de erros;
* autenticação.

## 40.5 Testes de sandbox

Cobrir fluxos reais disponíveis:

* criação;
* pagamento;
* cancelamento;
* estorno;
* assinatura;
* transferência;
* webhooks.

## 40.6 Testes E2E

Fluxo completo:

```text
matrícula
→ cobrança
→ evento
→ Inbox
→ worker
→ baixa local
→ efeito educacional
→ portal atualizado
```

## 40.7 Testes de concorrência

* dois workers no mesmo evento;
* webhook e reconciliação;
* pagamento e estorno;
* replay simultâneo;
* duas solicitações de transferência;
* comando externo com resposta ambígua.

## 40.8 Testes de caos

* worker cai após atualizar banco;
* worker cai antes do ack;
* broker fica indisponível;
* Redis reinicia;
* banco fica lento;
* Asaas retorna timeout;
* conexão cai após a escrita externa;
* fila externa é interrompida;
* deploy durante jobs ativos.

## 40.9 Testes de carga

Simular:

* virada de mês;
* milhares de webhooks;
* pico de pagamentos;
* reconciliação em massa;
* múltiplas contas grandes;
* fila com backlog;
* retries simultâneos.

Medir:

* throughput;
* latência;
* conexões;
* lock;
* uso de memória;
* quota;
* fairness;
* backlog.

## 40.10 Teste de regressão obrigatório

Todo bug financeiro corrigido deve gerar um teste que:

* falhe antes;
* passe depois;
* preserve isolamento por tenant;
* cubra duplicidade ou ordem quando aplicável.

---

# 41. Deploy

## 41.1 Estratégia

```text
feature flag
→ shadow mode
→ canary
→ rollout gradual
→ monitoramento
→ expansão
```

## 41.2 Reconciliação em shadow mode

Inicialmente:

```text
compara remoto e local
→ registra divergência
→ não corrige
```

Depois:

```text
corrige somente casos seguros
```

## 41.3 Migração de banco

Usar estratégia:

```text
expand
→ deploy compatível
→ backfill
→ validar
→ contract
```

Evitar migrações destrutivas junto com mudança de código sem compatibilidade.

## 41.4 Versionamento de handlers

Persistir:

```text
handlerVersion
schemaVersion
```

Isso permite compreender qual versão processou o evento e planejar replay.

## 41.5 Rollback

O rollback deve preservar:

* Inbox;
* Outbox;
* eventos pendentes;
* compatibilidade de schema;
* jobs já publicados;
* versões antigas durante transição.

---

# 42. Disaster recovery

Definir:

* backup do PostgreSQL;
* point-in-time recovery;
* teste de restauração;
* backup de configuração;
* recuperação de segredos;
* restauração de filas;
* replay a partir da Inbox;
* procedimento de failover;
* RPO;
* RTO.

A capacidade de replay da Inbox reduz a dependência do estado transitório do broker.

Testar recuperação periodicamente.

Backup sem teste de restauração não é garantia de recuperação.

---

# 43. Auditoria inicial do código atual

Antes de implementar, mapear o estado real.

## 43.1 Webhooks

* quais endpoints existem;
* quais eventos são aceitos;
* como o tenant é resolvido;
* como é feita autenticação;
* se o payload é persistido;
* se existe deduplicação;
* se existe fila;
* se o processamento ocorre dentro da rota;
* como retries funcionam;
* como erros são armazenados;
* se existe replay.

## 43.2 Estados financeiros

* modelos existentes;
* campos de status;
* mapeamentos;
* transições;
* atualizações diretas;
* regras duplicadas;
* vínculo com matrícula;
* vínculo com contrato;
* vínculo com cobrança;
* efeitos derivados.

## 43.3 Idempotência

* constraints;
* chaves;
* comandos;
* efeitos;
* transferências;
* notificações;
* lançamentos.

## 43.4 Asaas

* clientes HTTP existentes;
* `packages/asaas`;
* `packages/asaas-gateway`;
* retries;
* timeout;
* rate limit;
* circuit breaker;
* logs;
* idempotency key;
* chamadas duplicadas.

## 43.5 Filas e Redis

* tecnologia;
* topologia;
* persistência;
* isolamento;
* retries;
* DLQ;
* monitoramento;
* shutdown;
* jobs stalled.

## 43.6 Banco

* pool;
* índices;
* transações;
* locks;
* queries sem contaId;
* scans;
* crescimento;
* paginação.

## 43.7 Observabilidade

* logs;
* métricas;
* traces;
* correlação;
* alertas;
* painel;
* runbooks.

## 43.8 Reconciliação

* rotinas atuais;
* frequência;
* abrangência;
* orçamento;
* auto-repair;
* histórico;
* ações manuais.

---

# 44. Achados preliminares do log

O log compartilhado sugere pontos para investigação:

* chamadas diretas ao Asaas durante carregamento de telas;
* chamadas semelhantes ocorrendo quase simultaneamente;
* endpoints de visibilidade e status com latência elevada;
* polling de eventos de realtime no frontend;
* múltiplas requisições repetidas;
* grande volume de queries Prisma em algumas páginas;
* pool PostgreSQL com quantidade relevante de conexões por processo;
* ausência, no trecho apresentado, de uma trilha explícita de processamento de webhook.

O log não prova que a arquitetura necessária não exista.

Ele apenas indica que a auditoria precisa confirmar:

```text
webhook_received
webhook_persisted
webhook_queued
webhook_processing_started
state_transition_applied
outbox_created
webhook_processed
```

---

# 45. Antipadrões proibidos

Não fazer:

1. processar toda a regra no endpoint;
2. atualizar status diretamente pelo payload;
3. confiar em ordem de eventos;
4. confiar em entrega única;
5. buscar entidade externa sem contaId;
6. usar Redis como fonte definitiva;
7. usar uma fila para tudo;
8. misturar cache e fila financeira no mesmo Redis sem isolamento;
9. retry infinito;
10. retry imediato sem jitter;
11. chamar Asaas dentro de transação;
12. enviar e-mail dentro de lock;
13. varrer todas as cobranças constantemente;
14. deixar tenant grande monopolizar workers;
15. escalar apenas por CPU;
16. abrir circuito global por erro de uma conta;
17. armazenar segredos em logs;
18. permitir edição manual de status;
19. ignorar dead letters;
20. encerrar incidente sem reconciliação;
21. criar abstrações sem investigar as existentes;
22. hardcode de limites externos espalhado;
23. depender da tela para corrigir estado;
24. gerar efeitos sem idempotência;
25. tratar broker como ledger.

---

# 46. Plano de implementação

## Fase 0 — Diagnóstico

Entregáveis:

* inventário de endpoints;
* inventário de eventos;
* mapa de estados;
* mapa de chamadas Asaas;
* mapa de filas;
* mapa de Redis;
* mapa de efeitos;
* mapa de idempotência;
* mapa de reconciliação;
* análise de pool;
* análise multi-tenant;
* lista de riscos.

Critério de aceite:

* nenhum fluxo financeiro crítico desconhecido;
* todas as atualizações de estado identificadas;
* todas as chamadas externas identificadas.

## Fase 1 — Inbox e recepção segura

Entregáveis:

* tabela Inbox;
* unique constraint;
* endpoint rápido;
* autenticação;
* resolução de tenant;
* payload imutável;
* correlação;
* testes de duplicidade;
* logs.

Critério de aceite:

* eventos duplicados não criam duplicação;
* evento aceito permanece salvo;
* endpoint não executa regra pesada.

## Fase 2 — Outbox e worker

Entregáveis:

* tabela Outbox;
* dispatcher;
* fila;
* worker;
* retry;
* dead letter;
* shutdown;
* heartbeat.

Critério de aceite:

* falha na publicação não perde o evento;
* worker pode cair e retomar;
* jobs podem ser repetidos sem efeito duplicado.

## Fase 3 — Idempotência completa

Entregáveis:

* idempotência de recepção;
* idempotência semântica;
* idempotência de comandos;
* idempotência de efeitos;
* constraints;
* testes concorrentes.

Critério de aceite:

* cem entregas do mesmo evento produzem um efeito.

## Fase 4 — Máquina de estados

Entregáveis:

* estados separados;
* matriz de transições;
* caso de uso central;
* controle de versão;
* auditoria;
* testes fora de ordem.

Critério de aceite:

* eventos antigos não causam regressão inválida;
* estorno e chargeback continuam possíveis.

## Fase 5 — Outbox de efeitos e ledger

Entregáveis:

* eventos internos;
* efeitos idempotentes;
* lançamentos imutáveis;
* atualização educacional desacoplada;
* read models.

Critério de aceite:

* falha de notificação não impede baixa;
* lançamento não duplica.

## Fase 6 — Reconciliação

Entregáveis:

* reconciliador;
* seleção por risco;
* paginação;
* orçamento por tenant;
* shadow mode;
* auto-repair seguro;
* revisão manual.

Critério de aceite:

* cobrança paga no Asaas e pendente na Alusa é detectada e corrigida.

## Fase 7 — Rate limit e resiliência

Entregáveis:

* limitador hierárquico;
* circuit breaker por conta;
* timeout;
* retry adaptativo;
* backpressure;
* quotas;
* prioridades.

Critério de aceite:

* uma conta com falha não prejudica as demais;
* reconciliação não esgota a API.

## Fase 8 — Observabilidade e operação

Entregáveis:

* logs;
* métricas;
* traces;
* alertas;
* painel;
* DLQ;
* replay;
* runbooks.

Critério de aceite:

* falhas críticas são detectadas sem depender de reclamação.

## Fase 9 — Escala e performance

Entregáveis:

* pooling;
* PgBouncer ou equivalente;
* autoscaling;
* load tests;
* tuning;
* fairness;
* particionamento quando necessário.

Critério de aceite:

* picos não bloqueiam o núcleo financeiro;
* tenants grandes não monopolizam recursos.

## Fase 10 — Rollout

Entregáveis:

* shadow mode;
* canary;
* feature flags;
* rollout gradual;
* rollback;
* relatório.

Critério de aceite:

* arquitetura nova opera de forma observável;
* divergências antigas foram reconciliadas.

---

# 47. Definition of Done

Uma implementação financeira só está concluída quando:

* respeita contaId;
* valida entrada;
* possui idempotência;
* possui auditoria;
* possui retry classificado;
* possui tratamento de dead letter;
* possui correlação;
* não contém segredo em log;
* possui timeout;
* possui testes unitários;
* possui teste de integração;
* possui teste de duplicidade;
* possui teste fora de ordem;
* possui teste concorrente;
* possui métrica;
* possui alerta quando crítico;
* possui runbook;
* possui estratégia de rollback;
* passa typecheck;
* passa testes relevantes;
* limitações restantes estão documentadas.

---

# 48. Critérios finais de sucesso

A arquitetura estará operacionalmente madura quando:

1. um webhook pode ser recebido repetidamente sem duplicar efeitos;
2. um worker pode cair sem perder o evento;
3. a fila pode ficar indisponível sem perder eventos já aceitos;
4. Redis pode reiniciar sem corromper o estado financeiro;
5. eventos fora de ordem são tratados;
6. reconciliação corrige eventos perdidos;
7. uma subconta problemática fica isolada;
8. uma conta grande não bloqueia as demais;
9. polling não esgota quota;
10. pool de banco permanece controlado;
11. jobs críticos têm prioridade;
12. incidentes possuem recuperação por janela;
13. suporte consegue investigar uma cobrança;
14. todas as transições têm origem e correlação;
15. efeitos financeiros não são duplicados;
16. telas não dependem do Asaas para exibir o estado principal;
17. deploys não abandonam jobs;
18. DLQ gera alerta;
19. divergências são quantificadas;
20. a Alusa consegue provar convergência após um incidente.

---

# 49. Decisões arquiteturais consolidadas

1. PostgreSQL é a fonte canônica da Alusa.
2. Webhook é o caminho principal.
3. Toda recepção é persistida antes do processamento.
4. Inbox e Outbox são obrigatórias.
5. A fila é transporte.
6. Redis não é fonte financeira.
7. Processamento é assíncrono.
8. Consumidores são idempotentes.
9. Efeitos também são idempotentes.
10. Estados do provedor e locais são separados.
11. Transições passam por máquina de estados.
12. Webhook, reconciliação e ação manual usam o mesmo caso de uso.
13. Consultas ao Asaas são limitadas e seletivas.
14. Reconciliação é paginada e por risco.
15. Rate limit é por plataforma, conta e operação.
16. Circuit breaker é por subconta.
17. Workers são separados por responsabilidade.
18. Tenants possuem fairness.
19. Escala é orientada por backlog e idade.
20. Pool de banco é orçado globalmente.
21. Operações externas têm timeout.
22. Escritas externas exigem idempotência.
23. Dead letter exige triagem.
24. Incidente exige reconciliação.
25. Toda alteração financeira é auditável.

---

# 50. Resultado esperado

Após a implementação, o cenário:

```text
Cliente pagou
Asaas confirmou
Alusa permaneceu pendente
```

deverá ser tratado por múltiplas camadas:

```text
1. webhook chega;
2. evento é persistido;
3. worker processa;
4. máquina de estados valida;
5. cobrança local é atualizada;
6. baixa é idempotente;
7. efeitos são publicados;
8. read models são atualizados;
9. reconciliação confirma convergência.
```

Se o webhook não chegar:

```text
1. reconciliador seleciona a cobrança;
2. consulta o Asaas;
3. detecta divergência;
4. usa o mesmo caso de uso;
5. corrige o estado;
6. registra origem RECONCILIATION;
7. gera efeitos faltantes;
8. marca como IN_SYNC.
```

Se houver conflito:

```text
1. divergência é registrada;
2. processamento não força uma decisão perigosa;
3. item vai para revisão;
4. suporte visualiza a trilha;
5. ação manual usa o mesmo caso de uso;
6. tudo permanece auditado.
```

Essa arquitetura não elimina a possibilidade de falhas externas ou internas.

Ela garante que a Alusa não dependa de sorte para manter o financeiro correto.

O sistema passa a ser:

* resistente;
* previsível;
* auditável;
* recuperável;
* escalável;
* adequado a um ERP Educacional multi-tenant com operação financeira white label.