# Alusa — Design Tokens de Cor (Markdown)

Este arquivo reúne **todas as cores mencionadas** (com escala 50–900) + **variações e tokens prontos** para cobrir praticamente todos os cenários comuns de UI (SaaS/ERP): fundo, texto, borda, botões, inputs, estados, badges, alerts, tabelas, seleções e foco.

> Regra de ouro: use nomes por **intenção** (primary, success, bg, text) — não por “roxo/verde”.

---

## 1) Paleta Base (Escalas 50 → 900)

### Primary — Roxo (Marca Alusa)
- 50  `#F6F4F9`
- 100 `#EBE6F3`
- 200 `#D8CDE8`
- 300 `#C2B0D9`
- 400 `#9C82C2`
- 500 `#7243AA`
- 600 `#5C2F91` (Principal / CTA)
- 700 `#4B217A`
- 800 `#3A1A5F`
- 900 `#25103E`

### Neutral — Grafite (Neutros limpos)
- 50  `#F9F9FB`
- 100 `#F1F1F4`
- 200 `#E2E2E8`
- 300 `#D1D1D9`
- 400 `#9191A1`
- 500 `#636375`
- 600 `#474759`
- 700 `#2B2634`
- 800 `#1F1A24`
- 900 `#11111A`

### Surface — Off White (Superfícies Premium)
- 50  `#FFFFFF`
- 100 `#F7F5F8`
- 200 `#EBE6F3` (primary-100)
- 300 `#EEE6F4`
- 400 `#E2E2E8` (neutral-200)
- 500 `#D1D1D9` (neutral-300)
- 600 `#9191A1` (neutral-400)
- 700 `#636375` (neutral-500)
- 800 `#474759` (neutral-600)
- 900 `#2B2634` (neutral-700)

### Success — Verde
- 50  `#E9F9EE`
- 100 `#CFF2DA`
- 200 `#A6E7BC`
- 300 `#7DDB9D`
- 400 `#57CF7C`
- 500 `#38C256`
- 600 `#2FA64A`
- 700 `#26893E`
- 800 `#1E6D31`
- 900 `#144E22`

### Warning — Amarelo
- 50  `#FBFDE6`
- 100 `#F3F9B3`
- 200 `#EBF480`
- 300 `#E3EF4D`
- 400 `#DCF32F`
- 500 `#D7EA2B`
- 600 `#BFCF25`
- 700 `#9FAE1E`
- 800 `#7F8C17`
- 900 `#5A630F`

### Danger — Laranja (CTA/Erro)
- 50  `#FFF1E6`
- 100 `#FFD9B3`
- 200 `#FFBE80`
- 300 `#FFA34D`
- 400 `#FF8E26`
- 500 `#FF7A00`
- 600 `#DB6600`
- 700 `#B75400`
- 800 `#8F4100`
- 900 `#5C2A00`

### Info — Azul
- 50  `#F0FAFC`
- 100 `#D9F2F5`
- 200 `#B8E6EC`
- 300 `#97DAE2`
- 400 `#7FCFD9`
- 500 `#8ED7DF`
- 600 `#5FB9C3`
- 700 `#4696A1`
- 800 `#31707A`
- 900 `#1F4A52`

---

## 2) Aliases (Variações úteis “humanas”)

Use estes nomes no produto para evitar escolher “no olho”:

- `*-soft`   → 100 (fundo leve)
- `*-subtle` → 200 (badge/hover leve)
- `*-muted`  → 300 (estado secundário)
- `*-base`   → 500 (principal)
- `*-strong` → 700 (hover/active)
- `*-deep`   → 900 (alto contraste)

Exemplo:
- `primary-soft`   → 100 (`#EBE6F3`)
- `primary-subtle` → 200 (`#D8CDE8`)
- `primary-muted`  → 400 (`#9C82C2`)
- `primary-base`   → 600 (`#5C2F91`) -> **CTA Principal**
- `primary-strong` → 700 (`#4B217A`)
- `primary-deep`   → 900 (`#25103E`)

---

## 3) Variações por Opacidade (para overlays, hover, selection)

### RGB (para RGBA/Alpha)
- primary-600 `#5C2F91` → `rgb(92, 47, 145)`
- neutral-900 `#15111A` → `rgb(21, 17, 26)`
- success-500 `#38C256` → `rgb(56, 194, 86)`
- warning-500 `#D7EA2B` → `rgb(215, 234, 43)`
- danger-500  `#FF7A00` → `rgb(255, 122, 0)`
- info-500    `#8ED7DF` → `rgb(142, 215, 223)`

### Sugestão de tokens alpha (exemplo com primary-500)
- `primary-a05` → `rgba(92, 47, 145, 0.05)`
- `primary-a10` → `rgba(92, 47, 145, 0.10)`
- `primary-a15` → `rgba(92, 47, 145, 0.15)`
- `primary-a20` → `rgba(92, 47, 145, 0.20)`
- `primary-a30` → `rgba(92, 47, 145, 0.30)`
- `primary-a40` → `rgba(92, 47, 145, 0.40)`

Repita o mesmo padrão para `success`, `warning`, `danger`, `info` e `neutral`.

---

## 4) Tokens de UI (Light Mode) — “tudo que você usa no sistema”

### Fundos & superfícies
- `bg`              `#F7F5F8` (surface-100)
- `bg-muted`        `#EEE6F4` (surface-300)
- `surface`         `#FFFFFF` (surface-50)
- `surface-elevated` `#FFFFFF` (surface-50)
- `overlay`         `rgba(17, 17, 26, 0.55)` (neutral-900 a55)

### Texto
- `text`            `#15111A` (neutral-900)
- `text-muted`      `#4F485D` (neutral-500)
- `text-subtle`     `#7E778E` (neutral-400)
- `text-inverse`    `#FDFCF9` (surface-50)

### Bordas & divisores
- `border`          `#E2E2E8` (neutral-200)
- `border-strong`   `#D1D1D9` (neutral-300)
- `divider`         `#F1F1F4` (neutral-100)
- `focus-ring`      `rgba(92, 47, 145, 0.35)` (primary-600 a35)

### Links
- `link`            `#5C2F91` (primary-600)
- `link-hover`      `#7243AA` (primary-500)
- `link-visited`    `#4B217A` (primary-700)

---

## 5) Tokens de Componentes (botões, inputs, cards, tabelas)

### Botão primário
- `btn-primary-bg`        `#5C2F91` (primary-600)
- `btn-primary-hover`     `#7243AA` (primary-500)
- `btn-primary-active`    `#4B217A` (primary-700)
- `btn-primary-text`      `#FFFFFF`
- `btn-primary-disabled`  `#D8CDE8` (primary-200)

### Botão secundário (neutro)
- `btn-secondary-bg`      `#FFFFFF` (surface-50)
- `btn-secondary-hover`   `#F1F1F4` (neutral-100)
- `btn-secondary-active`  `#E2E2E8` (neutral-200)
- `btn-secondary-text`    `#11111A` (neutral-900)
- `btn-secondary-border`  `#E2E2E8` (neutral-200)

### Botão “danger”
- `btn-danger-bg`         `#FF7A00` (danger-500)
- `btn-danger-hover`      `#DB6600` (danger-600)
- `btn-danger-active`     `#B75400` (danger-700)
- `btn-danger-text`       `#FDFCF9` (surface-50)

### Input (default/focus/erro/sucesso)
- `input-bg`              `#FDFCF9` (surface-50)
- `input-border`          `#C9C5D1` (neutral-200)
- `input-border-focus`    `#5C2F91` (primary-600)
- `input-ring-focus`      `rgba(92, 47, 145, 0.25)` (primary a25)
- `input-border-error`    `#FF7A00` (danger-500)
- `input-ring-error`      `rgba(255, 122, 0, 0.20)` (danger a20)
- `input-border-success`  `#38C256` (success-500)
- `input-ring-success`    `rgba(56, 194, 86, 0.20)` (success a20)

### Cards
- `card-bg`               `#FDFCF9` (surface-50)
- `card-border`           `#E6E4EA` (neutral-100)
- `card-shadow`           `rgba(21, 17, 26, 0.10)` (neutral-900 a10)

### Tabelas
- `table-header-bg`       `#F6F4ED` (surface-100)
- `table-row-hover`       `rgba(164, 99, 232, 0.08)` (primary a08)
- `table-row-selected`    `rgba(164, 99, 232, 0.14)` (primary a14)
- `table-border`          `#E6E4EA` (neutral-100)

---

## 6) Estados Semânticos (badges, alerts, toast, status financeiro)

### Success
- `success-fg`     `#144E22` (success-900)
- `success-bg`     `#CFF2DA` (success-100)
- `success-border` `#A6E7BC` (success-200)
- `success-solid`  `#38C256` (success-500)

### Warning
- `warning-fg`     `#5A630F` (warning-900)
- `warning-bg`     `#F3F9B3` (warning-100)
- `warning-border` `#EBF480` (warning-200)
- `warning-solid`  `#D7EA2B` (warning-500)

### Danger
- `danger-fg`      `#5C2A00` (danger-900)
- `danger-bg`      `#FFD9B3` (danger-100)
- `danger-border`  `#FFBE80` (danger-200)
- `danger-solid`   `#FF7A00` (danger-500)

### Info
- `info-fg`        `#1F4A52` (info-900)
- `info-bg`        `#D9F2F5` (info-100)
- `info-border`    `#B8E6EC` (info-200)
- `info-solid`     `#8ED7DF` (info-500)

---

## 7) Dark Mode (tokens recomendados)

### Base
- `bg`              `#11111A` (neutral-900)
- `bg-muted`        `#1F1A24` (neutral-800)
- `surface`         `#2B2634` (neutral-700)
- `surface-elevated` `#474759` (neutral-600)
- `border`          `#474759` (neutral-600)
- `divider`         `#2B2634` (neutral-700)

### Texto
- `text`            `#F5F4F7` (neutral-50)
- `text-muted`      `#C9C5D1` (neutral-200)
- `text-subtle`     `#ACA6B8` (neutral-300)

### Acento
- `primary`         `#7243AA` (primary-500)
- `primary-soft`    `rgba(114, 67, 170, 0.18)`
- `focus-ring`      `rgba(114, 67, 170, 0.40)`

### Semânticas no dark
- `success-bg`      `rgba(56, 194, 86, 0.18)`
- `warning-bg`      `rgba(215, 234, 43, 0.18)`
- `danger-bg`       `rgba(255, 122, 0, 0.20)`
- `info-bg`         `rgba(142, 215, 223, 0.18)`

---

## 8) Cenários “extras” (muito usados em SaaS)

### Skeleton / Loading
- `skeleton-base`   `rgba(79, 72, 93, 0.10)` (neutral-500 a10)
- `skeleton-shine`  `rgba(245, 244, 247, 0.45)` (neutral-50 a45)

### Highlight / Busca
- `highlight`       `rgba(215, 234, 43, 0.35)` (warning a35)

### Seleção (drag/select)
- `selection`       `rgba(164, 99, 232, 0.18)` (primary a18)

### Gráficos (séries sugeridas)
- `chart-1` `#A463E8` (primary-500)
- `chart-2` `#38C256` (success-500)
- `chart-3` `#8ED7DF` (info-500)
- `chart-4` `#D7EA2B` (warning-500)
- `chart-5` `#FF7A00` (danger-500)
- `chart-6` `#4F485D` (neutral-500)

---

## 9) Pacote pronto em CSS Variables (opcional)

```css
  /* Base */
  --bg: #F7F5F8;
  --surface: #FFFFFF;
  --text: #11111A;
  --text-muted: #636375;
  --border: #E2E2E8;

  /* Brand */
  --primary: #5C2F91;
  --primary-hover: #7243AA;
  --primary-active: #4B217A;
  --focus-ring: rgba(92, 47, 145, 0.35);

  /* Semantic */
  --success: #38C256;
  --warning: #D7EA2B;
  --danger: #FF7A00;
  --info: #8ED7DF;

  /* Semantic backgrounds */
  --success-bg: #CFF2DA;
  --warning-bg: #F3F9B3;
  --danger-bg: #FFD9B3;
  --info-bg: #D9F2F5;
}

.dark {
  --bg: #11111A;
  --surface: #2B2634;
  --text: #F9F9FB;
  --text-muted: #D1D1D9;
  --border: #474759;

  --primary: #A463E8;
  --focus-ring: rgba(164, 99, 232, 0.40);

  --success-bg: rgba(56, 194, 86, 0.18);
  --warning-bg: rgba(215, 234, 43, 0.18);
  --danger-bg: rgba(255, 122, 0, 0.20);
  --info-bg: rgba(142, 215, 223, 0.18);
}