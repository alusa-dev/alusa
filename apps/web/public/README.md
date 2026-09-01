# Assets estáticos (`public/`)

Estrutura do app Next.js (`apps/web`). Tudo aqui é servido na raiz (`/favicon.svg` → `https://…/favicon.svg`).

```
public/
├── favicon.svg              # Browser / PWA
├── site.webmanifest
├── brand/                   # Logos Alusa → ver brand/README.md
├── images/
│   ├── auth/                # Imagens de login e cadastro
│   ├── kyc/                 # Imagens do fluxo KYC
│   ├── onboarding/          # Onboarding da plataforma
│   └── site/                # Imagens do site público
│       ├── dashboard/       # Capturas e visuais do produto
│       ├── decorative/      # Elementos decorativos
│       └── hero/            # Imagens principais do site
├── integrations/            # Logos de parceiros (Asaas, Stripe, etc.)
└── uploads/                 # Runtime local (gitignored) — dev sem R2/S3
```

## Regras

- **Brand**: identidade da plataforma Alusa.
- **images/**: fotos e ilustrações versionadas no git, organizadas por finalidade.
- **integrations/**: ícones de terceiros; path canônico `/integrations/<nome>.<ext>`.
- **uploads/**: arquivos gerados em runtime (avatars, contratos, produtos). Não commitar conteúdo — ver `.gitignore`.

## Ícones de interface

Ícones de UI **não** ficam em `public/`. Usar `@/components/icons/icons` (Heroicons).

## Referências internas

Assets usados só no server (ex.: template PDF de ingresso) ficam em `workspace-assets/` na raiz do monorepo.
