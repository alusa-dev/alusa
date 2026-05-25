---
applyTo: 'apps/web/features/site/**,apps/web/app/(public)/**'
---

## Site marketing unificado em `alusa-web`

O site público vive em `apps/web` (`features/site/` + rota `(public)/`). Um único deploy Vercel (`alusa-web`) serve:

- `https://alusa.app/` — marketing
- `https://alusa.app/auth/login` — app

Push em `main` publica automaticamente via integração Git do projeto `alusa-web`.

### Validar antes de concluir alterações no site

```bash
pnpm --filter @alusa/web build
```

### Produção

Domínios canônicos no projeto `alusa-web`:

- `https://alusa.app`
- `https://www.alusa.app` (redirect para apex via middleware)

Variáveis de URL em produção devem usar `https://alusa.app`:

- `APP_URL`
- `NEXTAUTH_URL`
- `NEXT_PUBLIC_APP_URL`
- `ASAAS_WEBHOOK_PUBLIC_BASE_URL`

### Legado

O pacote `apps/site` e o projeto Vercel `alusa-site` foram removidos após o cutover unificado.
