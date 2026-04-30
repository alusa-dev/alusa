## Princípios que vão guiar a refatoração (invariantes)

1. **Asaas é a fonte da verdade para estado financeiro**

   * O estado final (pago, estornado, cancelado, chargeback etc.) deve ser consolidado por **webhook** + (fallback) reconciliação controlada, nunca por “inferência local”.
   * O Asaas pode mandar eventos fora de ordem e pode adicionar novos campos no webhook; seu handler **não pode quebrar** por “atributos desconhecidos”. ([Asaas - Documentação API][1])

2. **Chaves e segurança**

   * API Key do Asaas deve ir no header **`access_token`** (não é Bearer). ([Asaas - Documentação API][2])
   * Token do webhook vem no header **`asaas-access-token`** e deve ser validado (hash no banco). ([Asaas - Documentação API][3])
   * Nunca expor Asaas/API key no front.

3. **Vínculo estável (sem “fallback perigoso”)**

   * Todo Payment no Asaas deve mapear 1:1 para um registro local (Cobranca ou Charge standalone), com **chave canônica** e **linkagem determinística** (principalmente para assinatura/parcelamento).

4. **Pagador por regra de idade (mantém o que você já tem)**

   * Para menor: **responsável** é o customer pagador; para maior: **aluno**. Esse “resolver do pagador” vira util único e obrigatório em todos os fluxos (avulsa, parcelamento, assinatura).

---

## O que o Asaas deixa claro (e isso impacta seu desenho)

* O Asaas trata “receitas” como “cobranças” e registra no **extrato**; e recomenda ficar atento ao **Webhook de Cobranças** para diferenciar cobranças criadas automaticamente. ([Asaas - Documentação API][4])
* Cobranças criadas por **assinatura** carregam o campo **`subscription`** no payload. ([Asaas - Documentação API][4])
* Cobranças de **parcelamento** carregam o campo **`installment`** no payload. ([Asaas - Documentação API][1])
* O Asaas documenta sequências típicas de eventos por método (ex.: boleto/pix/cartão) e isso precisa bater com sua máquina de estados (principalmente “pago” vs “confirmado”). ([Asaas - Documentação API][1])
* Notificações: Asaas envia por **WhatsApp/E-mail/SMS** e a personalização é feita via **notificações do cliente** (recuperar e atualizar), não “criando novas notificações”. ([Asaas - Documentação API][5])
* Importante: **“aviso de cobrança criada” não é enviado para cobranças criadas por assinatura**. Isso exige ajuste no seu UX e no que o backend “promete”. ([Asaas - Documentação API][6])
* Os status do Payment no Asaas incluem casos avançados (refund requested, chargeback etc.) e você precisa suportar todos para não divergir em cenários reais. ([Asaas - Documentação API][7])

---

# Plano de implementação em fases

## Fase 0 — “Contrato” de integração (base técnica para não quebrar nada)

**Objetivo:** padronizar enums, IDs canônicos, e preparar migração sem big-bang.

**Tarefas**

* Criar um módulo único: `packages/asaas-gateway` (ou equivalente) com:

  * `AsaasClient` (read/write) com header `access_token`. ([Asaas - Documentação API][2])
  * `AsaasWebhookVerifier` (valida `asaas-access-token` com hash do tenant). ([Asaas - Documentação API][3])
  * Tipos/DTOs e enums alinhados ao Asaas (inclui statuses e eventos).
* Definir **External Reference canônico** (para acabar com fallback por matrícula/competência):

  * `subscription:{subscriptionLocalId}`
  * `installmentPlan:{installmentPlanLocalId}`
  * `standaloneCharge:{chargeLocalId}`
  * **Regra:** tudo que cria Payment/Subscription/Installment no Asaas deve ter `externalReference` **sempre**.
* Feature flags:

  * `billing.v2_webhookLinking`
  * `billing.v2_listing`
  * `billing.v2_notifications`

**Critérios de aceite**

* Nenhuma rota existente muda comportamento ainda.
* Novo client e verificador de webhook em uso “passivo” (log-only).

---

## Fase 1 — Linkagem determinística (mata os 3 maiores riscos: mistura de cobranças)

**Objetivo:** eliminar “fallback genérico” que puxa cobranças erradas.

**Tarefas**

1. **Persistir externalReference nas cobranças criadas via webhook (assinatura)**

   * Quando chegar `PAYMENT_CREATED` com `subscription`, se a cobrança local não existir:

     * criar Cobranca local **com `externalReference` derivado do Subscription local** (ou criar Subscription “placeholder” e depois reconciliar).
   * Isso evita o seu risco atual de “criar sem externalReference e depois misturar”.
   * Base: campo `subscription` vem no payload. ([Asaas - Documentação API][4])

2. **Parcelamentos: vínculo por `installment` (não por competência)**

   * No handler: se `payment.installment` existir, garantir vínculo:

     * Charge/Cobranca → `InstallmentPlan` via `asaasInstallmentId`.
   * Nunca mais agrupar por competência como fallback (isso é fonte de mistura).

3. **Assinaturas: vínculo por `subscription` + eventos de assinatura**

   * Implementar consumo dos webhooks de assinatura:

     * `SUBSCRIPTION_CREATED/UPDATED/INACTIVATED/DELETED...` atualizam a tabela `Subscription`. ([Asaas - Documentação API][8])

**Critérios de aceite**

* Nenhuma cobrança de assinatura/parcelamento é listada “por aproximação”.
* IDs sintéticos (`ref:`/`fallback:`) viram exceção temporária com log de auditoria (para apagar depois).

---

## Fase 2 — Máquina de estados única (Cobranca/Charge/Subscription/Installment)

**Objetivo:** “um único lugar” decide status interno e liquidação, com precedência e sem regressão.

**Tarefas**

* Consolidar o mapeamento Asaas → Interno suportando **todos** os status documentados (incluindo chargeback e refund requested). ([Asaas - Documentação API][7])
* Ajustar a máquina de estados para refletir a realidade dos eventos:

  * Ex.: Pix costuma `RECEIVED` e `CONFIRMED` em segundos; cartão pode ir direto em confirmado; boleto segue “created → received → confirmed” etc. ([Asaas - Documentação API][1])
* **Liquidação / saldo disponível**

  * `LiquidacaoStatus = DISPONIVEL` quando `creditDate <= hoje` e status pago/confirmado.
  * `LiquidacaoStatus = PENDENTE` quando pago mas `creditDate` ainda no futuro.
  * Para `RECEIVED_IN_CASH`: tratar como **recebido fora do Asaas** (não soma no saldo Asaas) e exibir separado no balanço (Caixa/Recebido em mãos). (Decisão de produto coerente com “saldo Asaas”.)

**Critérios de aceite**

* Status nunca “anda pra trás” com eventos fora de ordem.
* UI badge sempre vem de um “StatusResolver” único (sem duplicação).

---

## Fase 3 — Webhooks “profissionais”: robustez, idempotência e observabilidade

**Objetivo:** não perder evento, não duplicar e não travar fila.

**Tarefas**

* Handler deve:

  * Validar token do webhook (`asaas-access-token`) por tenant. ([Asaas - Documentação API][3])
  * Persistir payload bruto com `eventId`/`payloadHash` (você já faz) + correlacionar com `asaasPaymentId`.
  * Ser tolerante a novos campos (não dar 500 por payload novo). ([Asaas - Documentação API][1])
* Criar “Job de reconciliação” (controlado, sem polling agressivo):

  * Reprocessa eventos com erro.
  * Reconciliar por janela (ex.: últimos 7 dias) somente quando detectado gap (ex.: cobrança sem status final).
  * O Asaas tem endpoints de saldo/extrato para auditoria do financeiro. ([Asaas - Documentação API][9])

**Critérios de aceite**

* Taxa de erro de webhook cai e fila não pausa por exceção.
* Painel admin: ver eventos, tentativas e correlação por cobrança/assinatura/parcelamento.

---

## Fase 4 — Rotas GET “verdadeiras” (listagens corretas para assinatura/parcelamento/avulsa)

**Objetivo:** as telas mostrarem exatamente o que o Asaas está operando, sem “misturar”.

### 4.1 Assinaturas

**Tarefas**

* `/api/financeiro/assinaturas`:

  * Usar `Subscription` local + estado do Asaas via webhook (preferencial).
  * Se faltar dado crítico: consultar endpoint oficial de “recuperar assinatura” como fallback controlado.
* `/api/financeiro/assinaturas/[id]`:

  * Listar cobranças **somente** por `asaasSubscriptionId`/`subscription` do Payment (nunca por matrícula “solta”).
  * Caso haja buraco: usar endpoint oficial **Listar cobranças de uma assinatura** como backfill (e persistir local). ([Asaas - Documentação API][10])

### 4.2 Parcelamentos

**Tarefas**

* `/api/financeiro/parcelamentos`:

  * Agregar por `asaasInstallmentId` (fonte), e não por competência.
* `/api/financeiro/parcelamentos/[id]`:

  * Parcelas vindas do vínculo `installment` do Payment.
  * Backfill via endpoint oficial “Listar cobranças de um parcelamento” se necessário (e persistir). ([Asaas - Documentação API][11])

### 4.3 Avulsas

**Tarefas**

* Garantir que toda avulsa criada por UI tenha `uiRequestId` obrigatório (idempotência forte).
* Listagem `/api/financeiro/cobrancas?tipo=AVULSA` deve filtrar por origem determinística (`STANDALONE`) e por vínculo do payment.

**Critérios de aceite**

* Não existe cobrança “aparecendo na assinatura errada”.
* Não existe parcela “grudando em outro carnê”.
* As telas `/cobrancas/*` e `/financeiro/cobrancas` deixam de divergir (e a rota legada vira só redirect depois).

---

## Fase 5 — POST/PUT/DELETE alinhados ao Asaas (sem divergência de estado)

**Objetivo:** toda ação é “comando” e o estado final vem do Asaas.

**Tarefas**

* PUT `/api/cobrancas/[id]`:

  * Chama “Atualizar cobrança existente” no Asaas.
  * Marca local `sync=PENDING` e aguarda `PAYMENT_UPDATED`/status via webhook. ([Asaas - Documentação API][11])
* DELETE `/api/...`:

  * Chama “Excluir cobrança” no Asaas.
  * Aguarda `PAYMENT_DELETED` e reflete cancelado. ([Asaas - Documentação API][1])
* Receber em dinheiro / desfazer:

  * Usar endpoints oficiais de confirmar/desfazer recebimento. ([Asaas - Documentação API][12])
* Refund:

  * Chamar refund no Asaas, tratar parcial/total, esperar evento/status final. ([Asaas - Documentação API][13])
* “Marcar pago manual”:

  * Se tiver `asaasPaymentId`: virar “receber em dinheiro” (ou bloquear se não fizer sentido).
  * Se não tiver Asaas (offline puro): manter só local e mostrar separado do “Saldo Asaas”.

**Critérios de aceite**

* Nenhuma ação altera “status final” local imediatamente (exceto estados transitórios “PENDENTE_DE_SINCRONIZACAO”).
* Idempotência em todas as mutações (inclusive clique duplo no front).

---

## Fase 6 — Notificações 100% Asaas (WhatsApp/E-mail/SMS) + UX correto

**Objetivo:** parar de ter endpoints redundantes e alinhar ao que o Asaas realmente faz.

**O que o Asaas oferece**

* Notificações por WhatsApp/E-mail/SMS (com custo), e uma régua padrão de eventos (vencimento, overdue, recebida etc.). ([Asaas - Documentação API][5])
* Personalização é via:

  * `GET /v3/customers/{id}/notifications`
  * update por notificação ou batch (não cria/deleta notificações). ([Asaas - Documentação API][14])
* “Cobrança criada” **não dispara para cobranças de assinatura**. ([Asaas - Documentação API][6])

**Tarefas**

* Criar uma tela/setting global (tenant): “Notificações Asaas”

  * toggles por canal (WhatsApp/E-mail/SMS)
  * toggles por evento (ex.: vencimento, overdue, recebida…)
* No backend:

  * Ao criar/atualizar customer: sincronizar as notificações do customer com o “perfil do tenant”.
  * Substituir `/asaas-notify` por uma operação segura: “sincronizar preferências do cliente” (com validação de tenant).
* UX:

  * Em assinatura: remover promessa “enviar notificação de cobrança criada”.
  * Botões úteis: “Copiar invoiceUrl / Abrir fatura” (sem Twilio). O Asaas usa `invoiceUrl` como link da fatura. ([Asaas - Documentação API][15])

**Critérios de aceite**

* WhatsApp/E-mail/SMS saem exclusivamente do Asaas (sem Twilio).
* Logs claros de quando e como as preferências foram aplicadas.

---

## Fase 7 — Balanço e extrato (pendência → liquidação → disponível)

**Objetivo:** refletir corretamente “saldo Asaas” versus “competência do ERP”.

**Tarefas**

* Implementar “Finance Dashboard” com 3 visões:

  1. **Saldo Asaas atual**: endpoint `/v3/finance/balance`. ([Asaas - Documentação API][9])
  2. **Extrato Asaas** (movimentações): `/v3/financialTransactions`. ([Asaas - Documentação API][9])
  3. **Receita do ERP** (competência): agregada por `Cobranca.competencia` + status interno.
* Regras:

  * Pago mas sem `creditDate` ou `creditDate > hoje` => “Recebido / A liquidar”.
  * `creditDate <= hoje` => “Disponível”.
  * `RECEIVED_IN_CASH` => entra em “Recebido fora do Asaas (caixa)” e **não** compõe saldo Asaas.
* Conciliação:

  * Se existir divergência (evento faltando), rodar backfill/reprocesso.

**Critérios de aceite**

* Usuário entende “pago” vs “disponível” sem confusão.
* “Saldo Asaas” bate com o Asaas.

---

## Fase 8 — Limpeza final (remover redundâncias e gambiarras)

**Objetivo:** deixar código escalável, com rotas consistentes e menos superfícies de bug.

**Tarefas**

* Unificar `/financeiro/cobrancas` → redirect definitivo para `/cobrancas` quando `billing.v2_listing` estiver estável.
* Ajustar anexos para suportar **Charge standalone** (hoje você identificou gap).
* Remover fallbacks perigosos (matrículaId-only) e manter apenas migrações/compat temporária com logs.
* Fortalecer RBAC/tenant-check:

  * `asaasPaymentId` sempre validado contra tenant antes de qualquer ação (notify/refund/update).

**Critérios de aceite**

* Não há duas fontes de verdade para a mesma listagem.
* “Faz sentido” ler o módulo: domínios separados (gateway Asaas, handlers, resolvers, APIs).

---

## Checklist de testes (mínimo para ficar “profissional”)

* Webhook:

  * idempotência (mesmo evento 2x)
  * out-of-order (CONFIRMED antes de RECEIVED)
  * payload com campo novo (não quebra) ([Asaas - Documentação API][1])
* Assinatura:

  * cobrança criada por webhook com `subscription` sempre linkada correto
  * listagem da assinatura não puxa cobranças de outra matrícula
* Parcelamento:

  * agrupamento por `installment`
  * cancelamento/refund do carnê reflete em todas parcelas
* Notificações:

  * atualizar `customers/{id}/notifications` e batch update funciona e respeita tenant ([Asaas - Documentação API][14])
  * cobrança de assinatura não tenta “payment created” ([Asaas - Documentação API][6])
* Balanço:

  * liquidacaoStatus por `creditDate`
  * recebimento em dinheiro não soma no saldo Asaas

---

use #asaas MCP para consultar endpoints oficias sobre cobranças, assinaturas, parcelamentos, notificações, extrato e saldo.

## Resultado esperado (quando terminar)

* Listagens de **assinaturas/parcelamentos/avulsas** 100% corretas, sem “mistura”.
* Estados internos coerentes com o Asaas (inclusive chargeback/refund avançado). ([Asaas - Documentação API][7])
* Balanço claro: **pago ≠ disponível**, com extrato/saldo via endpoints oficiais. ([Asaas - Documentação API][9])
* Notificações padronizadas e escaláveis via Asaas (WhatsApp/E-mail/SMS), sem Twilio. ([Asaas - Documentação API][5])
* Segurança correta: `access_token` para API e `asaas-access-token` no webhook. ([Asaas - Documentação API][2])

---

[1]: https://docs.asaas.com/docs/webhook-para-cobrancas "Eventos para cobranças"
[2]: https://docs.asaas.com/docs/padr%C3%A3o-de-chave-com-e-clientes-php?utm_source=chatgpt.com "Padrão de chave com $ e clientes PHP"
[3]: https://docs.asaas.com/docs/sobre-os-webhooks?utm_source=chatgpt.com "Introdução"
[4]: https://docs.asaas.com/docs/como-o-asaas-trata-receitas-na-conta "Como o Asaas trata receitas na conta?"
[5]: https://docs.asaas.com/docs/notificacoes?utm_source=chatgpt.com "Introdução"
[6]: https://docs.asaas.com/docs/notificacoes-padroes?utm_source=chatgpt.com "Notificações padrões"
[7]: https://docs.asaas.com/reference/list-payments-of-a-subscription.md?utm_source=chatgpt.com "https://docs.asaas.com/reference/list-payments-of-..."
[8]: https://docs.asaas.com/docs/eventos-para-assinaturas "Eventos para assinaturas"
[9]: https://docs.asaas.com/reference/recuperar-extrato "Recuperar extrato"
[10]: https://docs.asaas.com/reference/create-new-customer?utm_source=chatgpt.com "Create new customer"
[11]: https://docs.asaas.com/reference/estatisticas-de-cobrancas?utm_source=chatgpt.com "Estatísticas de cobranças"
[12]: https://docs.asaas.com/reference/confirmar-recebimento-em-dinheiro?utm_source=chatgpt.com "Confirmar recebimento em dinheiro"
[13]: https://docs.asaas.com/reference/refund-payment?utm_source=chatgpt.com "Refund payment"
[14]: https://docs.asaas.com/docs/changing-notifications-of-a-client?utm_source=chatgpt.com "Changing notifications of a client"
[15]: https://docs.asaas.com/docs/redirecionamento-apos-o-pagamento?utm_source=chatgpt.com "Redirecionamento após o pagamento"
