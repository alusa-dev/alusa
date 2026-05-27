# LGPD e hardening de segurança da Alusa

Última atualização: 27 de maio de 2026

Este documento registra a primeira entrega de hardening LGPD e segurança da Alusa como ERP Educacional multi-tenant com integração financeira white label via Asaas.

## Implementado

- Cadastro com aceite legal forte por modal, incluindo Termos de Uso, Política de Privacidade, DPA e contexto de serviços financeiros Asaas.
- Registro de aceite em `LegalAcceptance` com versão do documento, origem, conta, usuário, hashes de IP/user-agent e metadados mínimos.
- Banner de cookies apenas em áreas públicas, com rejeição real de cookies não necessários e preferências por categoria.
- Analytics do site público carregado somente após consentimento de análise.
- Páginas públicas: `/privacidade`, `/termos`, `/cookies`, `/seguranca`, `/suboperadores`, `/dpa`, `/direitos-lgpd` e `/direitos-lgpd/solicitar`.
- Modelos operacionais: `CookieConsent`, `PrivacyRequest`, `SensitiveAccessLog` e `ConsentRecord`.
- RLS obrigatório em produção via `assertProductionSecurityEnv`, exigindo `RLS_RUNTIME_ENABLED=true` e `DATABASE_RLS_URL`.
- Remoção de `asaasCreditCardToken` do Prisma e do código ativo. A Alusa mantém apenas metadados seguros como bandeira e últimos quatro dígitos.
- Remoção completa de Twilio como dependência, rota, package interno, testes e UI ativa.
- Sanitização de payloads de `WebhookAsaas`, `WebhookAsaasRejection` e autorização de transferência antes de persistir.
- Sentry com `sendDefaultPii=false`, `beforeSend` de redaction e Replay restrito a páginas públicas não sensíveis.
- Registry de proteção de rotas com classificação explícita para jobs, webhooks, rotas internas, developer e global-admin.
- Scripts de CI em `scripts/security/*` e comando `pnpm security:check`.

## Decisões de segurança

- Webhooks Asaas continuam usando `payloadHash` calculado sobre o corpo bruto para idempotência e auditoria, mas o payload persistido é sanitizado.
- Tokens transitórios necessários para chamadas ao Asaas podem existir nos clients/contratos de integração, mas não devem ser persistidos em entidades locais nem retornados por DTOs de UI.
- Solicitações LGPD públicas entram como `PrivacyRequest` em revisão. Exportação autenticada cria solicitação e log sensível, mas a geração de arquivo deve ocorrer em job dedicado antes de liberar link temporário.
- O app autenticado não exibe banner de cookies. Cookies do app devem permanecer essenciais para sessão, autenticação e segurança.

## Variáveis obrigatórias em produção

- `RLS_RUNTIME_ENABLED=true`
- `DATABASE_RLS_URL`
- `CRON_SECRET` ou `CRON_SECRET_TOKEN` para jobs internos
- Segredos Asaas, NextAuth, Sentry e e-mail devem permanecer apenas no servidor.

## Verificações

Pipeline recomendado:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm audit --prod
pnpm security:check
```

## Próximos passos

- Implementar job assíncrono de exportação LGPD com storage temporário e expiração.
- Ampliar logs de `SensitiveAccessLog` em telas de suporte, developer, exportações, rotação de chaves e alterações financeiras críticas.
- Expandir testes cross-tenant com RLS real em banco de teste.
- Formalizar runbooks de incidente, vazamento entre tenants, rotação de chaves, falha Asaas e restore.
- Exigir MFA para admin, financeiro, suporte, developer/global-admin, transferências, exportações e rotação de API key.
