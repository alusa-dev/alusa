# Scrollbar — Configuração e Boas Práticas

## Visão Geral

O projeto utiliza scrollbars customizadas com visual minimalista (finas, cinza, totalmente arredondadas).

## Arquivos Envolvidos

| Arquivo | Responsabilidade |
|---------|------------------|
| `apps/web/app/globals.css` | Scrollbar global (afeta toda a aplicação) |
| `apps/web/app/(app)/layout.tsx` | Classe `.app-content-scroll` no wrapper de conteúdo |
| `apps/web/components/ui/custom-scroll-area.tsx` | Componente para áreas internas (cards, dialogs) |

## Quando Usar Cada Abordagem

### 1. Scroll Global (CSS)
Para o scroll da página inteira ou do layout principal.

```css
/* globals.css */
::-webkit-scrollbar {
  width: 3px;
  height: 3px;
}
```

### 2. Classe CSS Específica
Para áreas de conteúdo que precisam de scroll controlado.

```tsx
// layout.tsx
<div className="app-content-scroll">
  {children}
</div>
```

### 3. Componente `CustomScrollArea`
Para áreas internas específicas (listas, dialogs, cards com scroll).

```tsx
import { CustomScrollArea } from '@/components/ui/custom-scroll-area';

<CustomScrollArea className="h-[400px]">
  {/* conteúdo com scroll */}
</CustomScrollArea>
```

## Como Alterar a Largura da Scrollbar

Para manter consistência, altere em **todos** os locais:

### 1. CSS Global (`globals.css`)

```css
/* Scrollbars globais (WebKit) */
::-webkit-scrollbar {
  width: 3px;  /* ← altere aqui */
  height: 3px;
}

/* Firefox */
html {
  scrollbar-width: thin;
  scrollbar-color: #d1d5db transparent;
}
```

### 2. Classe `.app-content-scroll` (`globals.css`)

```css
.app-content-scroll::-webkit-scrollbar {
  width: 3px;  /* ← altere aqui */
  height: 3px;
}
```

### 3. Classe `.settings-scroll-area` (`globals.css`)

```css
.settings-scroll-area::-webkit-scrollbar {
  width: 3px;  /* ← altere aqui */
  height: 3px;
}
```

### 4. Componente `CustomScrollArea` (`custom-scroll-area.tsx`)

```css
.custom-scroll-area::-webkit-scrollbar {
  width: 3px;  /* ← altere aqui */
  height: 3px;
}
```

## Cores Padrão

| Token | Valor | Uso |
|-------|-------|-----|
| Thumb (normal) | `#d1d5db` | Cinza claro (gray-300) |
| Thumb (hover) | `#9ca3af` | Cinza médio (gray-400) |
| Track | `transparent` | Fundo invisível |

## Tokens CSS Disponíveis

```css
:root {
  --brand-stroke: #DDDDDD;
  --brand-muted2: #828282;
}
```

Esses tokens podem ser usados para manter consistência com o design system.

## Checklist de Alteração

- [ ] Alterar `::-webkit-scrollbar` global
- [ ] Alterar `.app-content-scroll::-webkit-scrollbar`
- [ ] Alterar `.settings-scroll-area::-webkit-scrollbar`
- [ ] Alterar `.custom-scroll-area::-webkit-scrollbar` no componente
- [ ] Hard refresh no browser (`Ctrl+Shift+R`)
