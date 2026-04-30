# Documentação dos Componentes — Alusa

## Visão Geral

Esta pasta contém a documentação dos componentes utilizados no projeto Alusa, detalhando o uso geral, estrutura, padrões e exemplos de aplicação. Os componentes estão organizados por domínio e finalidade, seguindo as boas práticas de Clean Architecture e tipagem forte em TypeScript.

---

## Estrutura dos Componentes

Os componentes estão localizados em `apps/web/components` e organizados por domínio:
- **alunos/**: Diálogos, wizard e utilitários para gestão de alunos
- **auth/**: Componentes de autenticação
- **colaboradores/**: Diálogos e wizard para colaboradores
- **dialogs/**: Diálogos genéricos reutilizáveis
- **financeiro/**: Componentes de cobrança e auditoria
- **icons/**: Ícones customizados
- **image/**: Cropper e manipulação de imagens
- **invite/**: Modal de convite
- **layout/**: Estrutura de página, tabelas, navegação
- **matriculas/**: Wizard e status de matrículas
- **modalidades/**: Diálogos de modalidades
- **notifications/**: Painel de notificações
- **planos/**: Diálogos de planos
- **portal/**: Modal Pix
- **professores/**: Listagem e wizard de professores
- **salas/**: Diálogos de salas
- **settings/**: Navegação de configurações
- **shared/**: Utilitários e componentes compartilhados
- **theme/**: Provider de tema
- **turmas/**: Diálogos e tipos de turmas
- **ui/**: Componentes de interface genéricos (botão, input, dialog, toast, etc)
- **usuarios/**: Diálogos de usuários

---

## Padrões de Uso

- **Responsabilidade única**: Cada componente resolve apenas uma função específica.
- **Tipagem forte**: Todos os componentes utilizam interfaces e tipos do TypeScript.
- **Reutilização**: Componentes genéricos ficam em `ui/` ou `shared/` e são usados em múltiplos domínios.
- **Diálogos**: Padrão de dialogs para CRUD, confirmação e edição.
- **Wizards**: Fluxos multi-step para cadastros complexos (ex: alunos, colaboradores, matrículas).
- **Feedback visual**: Toasts, skeletons, badges e estados de loading/erro.
- **Responsividade**: Todos os componentes seguem o padrão mobile-first.

---

## Exemplos de Aplicação

### 1. Uso de Diálogos
```tsx
import { AlunoEditDialog } from '@/components/alunos/AlunoEditDialog';

<AlunoEditDialog aluno={aluno} onSave={handleSave} />
```

### 2. Componentes Genéricos
```tsx
import { Button } from '@/components/ui/button';

<Button onClick={submitForm}>Salvar</Button>
```

### 3. Wizard Multi-step
```tsx
import { MatriculaWizardDialog } from '@/components/matriculas/MatriculaWizardDialog';

<MatriculaWizardDialog open={open} onClose={closeWizard} />
```

### 4. Feedback Visual
```tsx
import { CustomToast } from '@/components/CustomToast';

<CustomToast message="Operação realizada com sucesso!" type="success" />
```

---

## Convenções

- **Imports absolutos**: Sempre usar `@/components/...` para importar.
- **Nomenclatura**: PascalCase para componentes, camelCase para props e funções.
- **Barrels**: Usar `index.ts` para exportação agrupada quando aplicável.
- **Testes**: Componentes críticos possuem testes unitários em `apps/web/tests` ou junto ao domínio.

---

## Como contribuir

1. Crie componentes com responsabilidade única e tipagem forte.
2. Siga a estrutura de pastas e padrões do projeto.
3. Adicione exemplos de uso e testes ao criar novos componentes.
4. Utilize componentes genéricos sempre que possível para evitar duplicação.

---

## Referências
- [Boas práticas Alusa](../../.github/instructions/boas%20pr%C3%A1ticas.instructions.md)
- [Clean Architecture](https://github.com/ryanmcdermott/clean-code-javascript)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

---

> Para dúvidas ou sugestões, consulte o time de desenvolvimento ou abra uma issue.
