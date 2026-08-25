# WhatsApp Cloud API da Alusa

## Objetivo

O WhatsApp é um canal institucional da Alusa para comunicação operacional: tickets, contratos e documentos. Avisos de cobrança permanecem sob responsabilidade do Asaas e não devem ser duplicados por este canal.

## Arquitetura

- `packages/whatsapp`: contrato da Cloud API, normalização E.164, assinatura HMAC, cliente HTTP e parser de webhooks.
- `apps/web/src/server/whatsapp`: configuração server-only, persistência, outbox, idempotência, retries, DLQ e processamento de webhooks.
- `apps/web/app/api/webhooks/whatsapp`: endpoint público da Meta; valida a assinatura do corpo bruto e persiste o evento antes de responder `200`.
- `apps/web/app/api/jobs/whatsapp`: worker protegido por cron que drena mensagens de saída e webhooks recebidos.
- `apps/web/app/(app)/comunicacao/whatsapp-teste`: página de teste autenticada, sem permissão adicional por envio, limitada por `WHATSAPP_TEST_ALLOWLIST`.
- Prisma: conexão institucional `PLATFORM`; mensagens que pertencem a uma escola carregam `contaId` e geram `AuditLog`.

## Variáveis do ambiente

Copie os nomes de `apps/web/.env.example` para o ambiente alvo. Nunca coloque `WHATSAPP_ACCESS_TOKEN` no navegador, em commits, screenshots ou logs.

Para o piloto:

```env
WHATSAPP_ENABLED=true
WHATSAPP_TEST_MODE=true
WHATSAPP_ACCESS_TOKEN=<token de sistema/usuário Meta mantido no secret manager>
WHATSAPP_APP_SECRET=<App Secret do app Meta>
WHATSAPP_VERIFY_TOKEN=<segredo definido pela Alusa para o webhook>
WHATSAPP_PHONE_NUMBER_ID=<Phone Number ID da Meta>
WHATSAPP_WABA_ID=<WhatsApp Business Account ID>
WHATSAPP_TEST_ALLOWLIST=5597981283106
```

O token exposto anteriormente deve ser revogado/regenerado antes de ser usado em qualquer ambiente.

## Banco e deploy

1. Aplicar `prisma/migrations/20260824100000_add_whatsapp_cloud_integration/migration.sql` no banco do ambiente.
2. Rodar `pnpm prisma:generate` durante o build.
3. Configurar o cron `/api/jobs/whatsapp` com `CRON_SECRET`/`CRON_SECRET_TOKEN`.
4. Publicar a aplicação em HTTPS. A Meta não consegue chamar `localhost`; para desenvolvimento use um túnel HTTPS.
5. Configurar o callback da Meta como `https://<dominio>/api/webhooks/whatsapp`, usando o mesmo `WHATSAPP_VERIFY_TOKEN`.

## Contratos e tickets

- `POST /api/comunicacao/whatsapp/contratos/:id` recebe `{ "to": "+55..." }`, valida o contrato dentro da `contaId` da sessão e envia o PDF assinado (ou o PDF original) somente quando a URL é HTTPS pública.
- `POST /api/comunicacao/whatsapp/tickets/:id` recebe `{ "to": "+55..." }`, valida o `SupportCase` dentro da `contaId` da sessão e envia um resumo operacional.
- Os dois endpoints aceitam `Idempotency-Key`; sem esse header, uma chave aleatória é gerada por solicitação.

## Critérios de aceite cobertos

- Token Meta ausente do client e dos logs.
- Validação de sessão em todas as mutações internas.
- Isolamento por `contaId` para contrato, ticket, mensagem e auditoria.
- HMAC `X-Hub-Signature-256` validado sobre o corpo bruto.
- Dedupe de webhook por hash e outbox por chave de idempotência.
- Retry com backoff, recuperação de lock e DLQ persistida.
- Status `sent`, `delivered`, `read` e `failed` refletidos localmente.
- Asaas não é chamado por nenhum fluxo WhatsApp.
- Página de teste acessível apenas com a sessão Alusa; allowlist é uma barreira operacional, não uma permissão de negócio.

## Configuração Meta pendente do deploy

A assinatura final do webhook e a publicação do app não devem ser feitas apontando para `localhost`. Depois que houver uma URL HTTPS pública da Alusa, a configuração pode ser validada pelo MCP da Meta e a assinatura de `messages` pode ser criada no WABA correto.
