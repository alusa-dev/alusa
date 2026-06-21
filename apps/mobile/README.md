# Alusa Mobile

App iOS/Android da Alusa, criado dentro do monorepo existente com Expo Router.

## Rodando localmente

1. Instale as dependências na raiz do monorepo:

   ```bash
   pnpm install
   ```

2. Configure o ambiente mobile:

   ```bash
   cp apps/mobile/.env.example apps/mobile/.env.local
   ```

3. Inicie o app:

   ```bash
   pnpm dev:mobile
   ```

4. Para abrir no simulador iOS:

   ```bash
   pnpm dev:mobile:ios
   ```

## Arquitetura inicial

- Rotas públicas e autenticadas ficam em `src/app` usando Expo Router.
- Sessão, armazenamento seguro e contexto multi-tenant ficam em `src/features/session`.
- O cliente HTTP fica em `src/lib/api` e injeta token Bearer somente após sessão válida.
- Tokens visuais da Alusa ficam em `src/theme`.
- Estados reutilizáveis de loading, erro e vazio ficam em `src/components/feedback`.

## Contrato de autenticação mobile

O app não simula login. Por padrão, `EXPO_PUBLIC_MOBILE_AUTH_ENABLED=false` e a tentativa de login retorna um erro explícito informando que o contrato mobile ainda não está habilitado no backend.

Quando o backend expuser um contrato seguro para app nativo, habilite `EXPO_PUBLIC_MOBILE_AUTH_ENABLED=true` e implemente o endpoint esperado:

```text
POST /api/mobile/auth/login
```

A resposta deve trazer usuário, contas permitidas, `activeContaId`, token de acesso e vencimento. O app nunca deve aceitar `contaId` livre vindo do client sem validação de permissão no backend.

## Checks

```bash
pnpm typecheck:mobile
pnpm --filter @alusa/mobile lint
pnpm --filter @alusa/mobile test
pnpm --filter @alusa/mobile run doctor
pnpm --filter @alusa/mobile exec expo config --type public
```

Também rode `pnpm --filter @alusa/web typecheck` quando mudanças de dependências ou tipos compartilhados puderem afetar o web.
