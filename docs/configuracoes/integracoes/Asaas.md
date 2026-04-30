# Integração Alusa × Asaas — Sincronização

## Visão Geral
A plataforma Alusa integra-se ao Asaas para automatizar cobranças recorrentes, pagamentos, cancelamentos e sincronização de status financeiros de alunos e matrículas. O fluxo cobre desde a criação de cobranças e assinaturas até o tratamento de webhooks e exclusão de alunos com vínculos financeiros ativos.

---

## 1. Criação de Cobranças e Assinaturas
- **Cobrança Recorrente (Mensalidade):**
  - Ao criar uma matrícula com plano recorrente, é criada uma assinatura (subscription) no Asaas.
  - O ID da assinatura Asaas é salvo na matrícula e nas cobranças do tipo "MENSALIDADE".
  - Campos financeiros (juros, multa, desconto, prazo) são enviados e persistidos.
- **Cobrança Avulsa (Taxa de Matrícula):**
  - Cobranças avulsas são criadas via API do Asaas e vinculadas à matrícula.
  - Suporta múltiplas formas de pagamento (PIX, cartão, boleto).

---

## 2. Webhooks e Sincronização de Status
- **Webhook de Pagamento:**
  - O endpoint `/api/webhooks/asaas` recebe eventos do Asaas.
  - Pagamentos de assinaturas são correlacionados via `asaasSubscriptionId`.
  - O status da cobrança (PENDENTE, PAGO, CANCELADO) é atualizado na Alusa conforme o evento recebido.
  - O campo `asaasPaymentId` é salvo na cobrança para rastreabilidade.
- **Idempotência:**
  - O processamento de webhooks é idempotente: reprocessamentos não duplicam efeitos.

## 2.1 Modelo Operacional de Leituras

Regra geral:
- Mudança de estado financeiro é confirmada por `webhook`.
- Leitura de tela usa `snapshot local` por padrão.
- Leitura remota no Asaas só acontece quando a intenção é explícita e justificável.

Categorias canônicas de leitura:

| Categoria | Quando usar | Quando não usar | Fonte de verdade | Exemplos no sistema |
|---|---|---|---|---|
| `READ_MODEL` | Detalhe de tela com fallback remoto, `fresh=1`, snapshot incompleto | Como motor primário de estado ou polling contínuo | Snapshot local alimentado por webhook | detalhes de cobrança, portal financeiro, matrícula, verificação de conta |
| `COMMAND_PREFLIGHT_STATUS` | Validar apenas o status oficial antes de um comando | Quando o comando precisa de valor, `dueDate` ou payload completo | Status oficial do Asaas no instante do comando | confirmar recebimento, desfazer recebimento, marcar como pago |
| `COMMAND_PREFLIGHT_FULL` | Validar comando que depende do payload completo | Para validações que exigem apenas status | Payment/subscription oficial no instante do comando | estorno, edição complexa, alteração de forma de pagamento |
| `RECONCILIATION` | Corrigir drift, reparar estado após atraso/falha de webhook, jobs operacionais | Para responder tela no caminho feliz | Estado oficial do Asaas usado para convergir o modelo local | `syncPaymentStateFromAsaas`, reconciliação de webhooks, refresh KYC corretivo |
| `MANUAL_REPAIR` | Correção manual ou sync acionado explicitamente pelo usuário/operador | Como leitura padrão da aplicação | Estado oficial do Asaas usado para reparar snapshot local | sync manual de forma de pagamento |
| `AUTHORITATIVE_DOCUMENT` | Gerar link ou documento que precisa refletir o estado oficial atual | Para navegação comum de UI | Documento ou receipt oficial exposto pelo Asaas | comprovante do extrato |

Anti-padrões:
- Não usar `sync` para substituir `webhook`.
- Não usar `fresh=1` como fallback automático para toda tela.
- Não usar reconciliação para UX de rotina.
- Não usar leitura remota só porque “é mais fácil” do que confiar no snapshot local.

Hierarquia prática:
1. `webhook` consolida o estado.
2. `read model` atende a aplicação.
3. `command preflight` protege comandos.
4. `reconciliation` corrige drift.
5. `manual repair` é exceção operacional.
6. `authoritative document` consulta a origem quando o artefato oficial precisa refletir o estado real.

---

## 3. Exclusão de Aluno com Vínculos Ativos
- **Bloqueio:**
  - Ao tentar excluir um aluno com matrícula ou assinatura ativa, a API retorna 409 e informa as quantidades de vínculos.
  - O frontend exibe um toast explicando o motivo e pede confirmação para exclusão forçada.
- **Exclusão Forçada:**
  - Se confirmado, o sistema:
    - Cancela todas as assinaturas no Asaas (via API, ignora 404).
    - Atualiza status das matrículas para CANCELADA e das cobranças para CANCELADO.
    - Exclui o aluno e vínculos locais.

---

## 4. Campos Sincronizados
- **Cobrança/Mensalidade:**
  - `asaasPaymentId`, `asaasSubscriptionId`, `valor`, `vencimento`, `juros`, `multa`, `desconto`, `status`
- **Aluno:**
  - `asaasCustomerId` (pagador no Asaas)
- **Matrícula:**
  - `asaasSubscriptionId` (assinatura recorrente)

---

## 5. Segurança e Ambiente
- **Sandbox x Produção:**
  - As credenciais Asaas são separadas por ambiente.
  - Nunca expor chaves no frontend.
- **Logs e Rastreamento:**
  - Todas as operações críticas são logadas com IDs de referência (aluno, matrícula, cobrança, assinatura).

---

## 6. Como confirmar via API se algo foi criado (subconta)

Objetivo: **não assumir sucesso** apenas porque o POST retornou `2xx` ou porque “não deu erro”.

Regra operacional:
- Sempre usar o **`access_token` da subconta** da instituição (whitelabel).
- Antes de criar (POST), aplicar **read-before-write** (GET/list).
- Depois de criar (POST), aplicar **confirmação pós-escrita** (GET pelo `id`).

### 6.1 Token e headers

- Base URL (API Asaas): `https://api.asaas.com/v3`
- Header obrigatório:
  - `Authorization: Bearer <ACCESS_TOKEN_DA_SUBCONTA>`
- Headers recomendados:
  - `Accept: application/json`
  - `Content-Type: application/json` (quando houver body)

Importante:
- Nunca registrar o token em logs.
- Nunca enviar token para o frontend.

### 6.2 Confirmação pós-escrita (GET por ID)

O padrão preferencial para confirmar criação real é:

1) Executar a ação (POST) e capturar o `id` retornado.
2) Persistir localmente o `id` externo (ex.: `asaasCustomerId`, `asaasPaymentId`, `asaasSubscriptionId`).
3) Confirmar imediatamente:

#### Customer
- `GET /customers/{customerId}`

#### Cobrança avulsa (payment)
- `GET /payments/{paymentId}`

#### Assinatura (subscription)
- `GET /subscriptions/{subscriptionId}`

Se o GET retornar `404`, tratar como **falha de consistência** (ou token/subconta errada) e não continuar o fluxo como “criado”.

### 6.3 Read-before-write (evitar duplicidade)

Antes de criar um recurso novo, fazer busca para reaproveitar o que já existe.

#### Customer
- `GET /customers?cpfCnpj=<cpf>&limit=10&offset=0`
  - Se já existir customer equivalente na subconta, reutilizar o `id`.

#### Payments
- `GET /payments?customer=<customerId>&status=PENDING&limit=50&offset=0`
  - Verificar se já existe cobrança equivalente (mesma matrícula/plano/período) antes de criar outra.

#### Subscriptions
- `GET /subscriptions?customer=<customerId>&status=ACTIVE&limit=50&offset=0`
  - Verificar se já existe assinatura ativa para a matrícula/plano.

Observação: quando houver campo de referência externa no payload (ex.: `externalReference`), ele deve ser usado como chave de reconciliação/listagem.

### 6.4 Exemplos (curl)

> Exemplos com token mascarado. Nunca commitar token.

```bash
ACCESS_TOKEN="***"

# Confirmar Customer
curl -sS \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Accept: application/json" \
  "https://api.asaas.com/v3/customers/cus_XXXXXXXXXXXX"

# Confirmar Payment
curl -sS \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Accept: application/json" \
  "https://api.asaas.com/v3/payments/pay_XXXXXXXXXXXX"

# Confirmar Subscription
curl -sS \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Accept: application/json" \
  "https://api.asaas.com/v3/subscriptions/sub_XXXXXXXXXXXX"
```

### 6.5 Padrão recomendado na Alusa

- Persistir o `id` externo retornado no banco e usar esse `id` como fonte principal para reconciliação.
- Em caso de falha parcial (POST criou, mas persistência falhou), rodar reconciliação:
  - buscar por customer e depois listar payments/subscriptions para localizar o recurso criado.
- Para qualquer estado financeiro (pago/cancelado/estornado/vencido), aguardar **webhook** para consolidar no estado interno.

Observação operacional:
- `read-before-write` continua permitido, mas deve ser classificado como `COMMAND_PREFLIGHT_STATUS` ou `COMMAND_PREFLIGHT_FULL`.
- Syncs corretivos e jobs de repair não devem expor estado novo diretamente para UX sem convergir o modelo local.

---

## 7. Referências
- [Documentação oficial Asaas](https://asaas.com/developers/)
- [Cobranças (mensalidades + taxas)](cobranças.md)
- Webhooks: `/api/webhooks/asaas`
- Endpoints internos: `/api/matriculas`, `/api/alunos`, `/api/cobrancas`

---

*Atualizado em 16/01/2026 — Integração validada e em produção.*
