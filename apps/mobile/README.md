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

Os diretórios vazios preservados com `.gitkeep` fazem parte da estrutura planejada do app. Eles
reservam os pontos de extensão para componentes de autenticação, stores, hooks, constantes,
componentes de UI e testes que serão implementados nas próximas etapas do desenvolvimento mobile.

## Contrato de autenticação mobile

O backend expõe sessões próprias para o app nativo:

```text
POST /api/mobile/auth/login
POST /api/mobile/auth/refresh
POST /api/mobile/auth/logout
POST /api/mobile/auth/password-reset/request
```

O access token tem vida curta e o refresh token é rotativo, persistido no `expo-secure-store` e revogado no logout. O backend sempre valida o vínculo do usuário com a `Conta` antes de emitir ou renovar a sessão; o app nunca define acesso apenas com `contaId` vindo do client.

Quando o primeiro login é concluído em um dispositivo compatível, o iOS apresenta o alerta nativo do Face ID. Com a confirmação, o refresh token daquele acesso passa a ser protegido por `requireAuthentication`. Cada acesso salvo mantém sua própria credencial biométrica. Ao bloquear o app, o usuário volta ao seletor de acessos; ao escolher um card, o Face ID é solicitado automaticamente e a senha continua disponível como alternativa. Excluir um card remove apenas suas credenciais locais.

Para testar em um iPhone, mantenha computador e aparelho na mesma rede Wi-Fi, use o IP local do computador em `EXPO_PUBLIC_API_URL` (por exemplo, `http://10.0.0.101:3000`) e deixe `EXPO_PUBLIC_MOBILE_AUTH_ENABLED=true`.

## Checks

```bash
pnpm typecheck:mobile
pnpm --filter @alusa/mobile lint
pnpm --filter @alusa/mobile test
pnpm --filter @alusa/mobile run doctor
pnpm --filter @alusa/mobile exec expo config --type public
```

Também rode `pnpm --filter @alusa/web typecheck` quando mudanças de dependências ou tipos compartilhados puderem afetar o web.
