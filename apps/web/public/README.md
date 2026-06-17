# Assets estáticos (`public/`)

Estrutura do app Next.js (`apps/web`). Tudo aqui é servido na raiz (`/favicon.svg` → `https://…/favicon.svg`).

```
public/
├── favicon.svg              # Browser / PWA
├── site.webmanifest
├── brand/                   # Logos Alusa → ver brand/README.md
├── images/
│   ├── auth/                # Hero login e cadastro
│   └── welcome-wizard/      # Onboarding dashboard
├── integrations/            # Logos de parceiros (Asaas, etc.)
└── uploads/                 # Runtime local (gitignored) — dev sem R2/S3
```

## Regras

- **Brand**: identidade da plataforma Alusa.
- **images/**: fotos/ilustrações de produto versionadas no git.
- **integrations/**: ícones de terceiros; path canônico `/integrations/<nome>.png`.
- **uploads/**: arquivos gerados em runtime (avatars, contratos, produtos). Não commitar conteúdo — ver `.gitignore`.

## Ícones de interface

Ícones de UI **não** ficam em `public/`. Usar `@/components/icons/icons` (Heroicons).

## Referências internas

Assets usados só no server (ex.: template PDF de ingresso) ficam em `workspace-assets/` na raiz do monorepo.
