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

1. Aplicar `prisma/migrations/20260824100000_add_whatsapp_cloud_integration/migration.sql` e `prisma/migrations/20260905090000_contract_whatsapp_notifications/migration.sql` no banco do ambiente.
2. Rodar `pnpm prisma:generate` durante o build.
3. Configurar o cron `/api/jobs/whatsapp` com `CRON_SECRET`/`CRON_SECRET_TOKEN`.
4. Publicar a aplicação em HTTPS. A Meta não consegue chamar `localhost`; para desenvolvimento use um túnel HTTPS.
5. Configurar o callback da Meta como `https://<dominio>/api/webhooks/whatsapp`, usando o mesmo `WHATSAPP_VERIFY_TOKEN`.

## Contratos e tickets

- `POST /api/comunicacao/whatsapp/contratos/:id` recebe `{ "to": "+55..." }`, valida o contrato dentro da `contaId` da sessão e envia o PDF assinado (ou o PDF original) somente quando a URL é HTTPS pública.
- A emissão de um contrato de matrícula cria, na mesma transação, uma notificação pendente. O worker converte essa notificação em um template Utility aprovado (`WHATSAPP_CONTRACT_MAJOR_TEMPLATE` ou `WHATSAPP_CONTRACT_MINOR_TEMPLATE`) com botão de URL dinâmica para `/p/contrato/{token}`.
- Os templates aprovados usam os componentes posicionais definidos na Meta: cabeçalho `Olá, {{1}}!`; maior de idade com corpo `{{1}}=instituição`, `{{2}}=curso/turma`, `{{3}}=data de início`; menor de idade com corpo `{{1}}=aluno`, `{{2}}=instituição`, `{{3}}=curso/turma`, `{{4}}=data de início`. O botão dinâmico recebe somente o token como complemento da URL.
- A origem do botão é definida no próprio template da Meta. Nos templates de produção atuais, ela é `https://alusa.app/p/contrato/`; `APP_URL` apenas valida que a aplicação possui uma origem pública HTTPS e não substitui a origem já aprovada pela Meta. Portanto, um contrato criado no banco local só pode ser aberto pelo link do ngrok se forem usados templates locais aprovados com a origem do ngrok (configurados em `WHATSAPP_CONTRACT_MAJOR_TEMPLATE` e `WHATSAPP_CONTRACT_MINOR_TEMPLATE`).
- O token usado pela entrega assíncrona é armazenado cifrado com `ENCRYPTION_KEY`; o valor em claro não é persistido nem escrito em logs.
- Telefones brasileiros informados com DDD e número local são normalizados para E.164 (`55 + DDD + número`) antes da deduplicação e do envio à Meta.
- `POST /api/comunicacao/whatsapp/tickets/:id` recebe `{ "to": "+55..." }`, valida o `SupportCase` dentro da `contaId` da sessão e envia um resumo operacional.
- `POST /api/comunicacao/whatsapp/contratos/:id/template` reprocessa uma notificação de contrato já criada, respeitando a mesma chave de deduplicação.
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

## Validação local do fluxo de contrato

1. Rode `pnpm db:migrate:local` e `pnpm --filter @alusa/web typecheck`.
2. Mantenha `WHATSAPP_TEST_MODE=true`, configure os dois nomes de template aprovados e informe somente números de teste em `WHATSAPP_TEST_ALLOWLIST`.
3. Exponha a aplicação local por um túnel HTTPS e defina `APP_URL` com essa origem; o botão dinâmico exige HTTPS para evitar links inválidos. Para testar o clique pelo WhatsApp usando dados locais, crie na Meta templates de teste com a URL-base do túnel e aponte `WHATSAPP_CONTRACT_MAJOR_TEMPLATE`/`WHATSAPP_CONTRACT_MINOR_TEMPLATE` para eles. Os templates de produção apontam para `alusa.app` e não encontram contratos que existem somente no banco local.
4. Inicie a aplicação, crie uma matrícula com telefone do aluno ou responsável e confirme a criação de `ContractWhatsAppNotification` em `PENDING`.
5. Execute `GET /api/jobs/whatsapp` com o `CRON_SECRET`. O worker enfileira o template de contrato e, na mesma execução, drena a outbox WhatsApp.
6. Consulte `GET /api/comunicacao/whatsapp/contratos/:id/template` ou a tela de detalhes do contrato para acompanhar tentativas, erro, DLQ e chave do job.
7. Valide a assinatura pelo link recebido e confirme os eventos `sent`, `delivered`, `read` e `failed` no webhook local.

## Configuração Meta pendente do deploy

A assinatura final do webhook e a publicação do app não devem ser feitas apontando para `localhost`. Depois que houver uma URL HTTPS pública da Alusa, a configuração pode ser validada pelo MCP da Meta e a assinatura de `messages` pode ser criada no WABA correto.
