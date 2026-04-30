# Especificação: Editor de Contratos Estilo Notion

## 1. Visão Geral
O objetivo é reformular a experiência de criação e edição de templates de contrato (`TemplateEditor`), substituindo o atual `textarea` simples e a lista lateral de variáveis por um **Editor de Texto Rico (Rich Text Editor)** moderno e fluido, inspirado na experiência de usuário do Notion.

## 2. Objetivos de UX/UI
*   **Interface Limpa (Canvas Infinito):** Remover distrações. O editor deve parecer um documento em branco. O título do contrato deve ser editável no próprio corpo (como um H1) ou um campo discreto no topo.
*   **Inserção Dinâmica de Variáveis (`@` Mentions):**
    *   Ao digitar `@`, um menu suspenso (dropdown) deve aparecer na posição do cursor.
    *   Este menu listará as variáveis disponíveis (ex: "Nome do Aluno", "CPF", "Valor").
    *   A seleção deve inserir um "Chip" ou "Badge" visual no texto, representando a variável (ex: `@[Aluno]`).
    *   Internamente, isso deve ser salvo como o placeholder correspondente (ex: `{{aluno.nome}}`).
*   **Formatação Contextual (Bubble Menu):**
    *   Ao selecionar um trecho de texto, um menu flutuante deve aparecer imediatamente acima da seleção.
    *   Opções: Negrito, Itálico, Sublinhado, H1, H2, H3, Alinhamento, Listas.
*   **Slash Commands (`/`):** (Opcional/Futuro) Digitar `/` para inserir blocos como tabelas, divisores, imagens.

## 3. Stack Tecnológica
Para atingir esse nível de customização e controle sobre o renderizador, utilizaremos o **Tiptap**.

*   **Core:** `@tiptap/react`, `@tiptap/starter-kit`
*   **Extensões Necessárias:**
    *   `@tiptap/extension-mention`: Para a funcionalidade do `@`.
    *   `@tiptap/extension-bubble-menu`: Para o menu flutuante.
    *   `@tiptap/extension-placeholder`: Para textos de ajuda quando vazio.
    *   `tippy.js` (ou similar): Para gerenciar o posicionamento dos popups (o Tiptap usa isso internamente ou sugere).

## 4. Arquitetura dos Componentes

### 4.1. `RichTextEditor` (Novo Componente)
Componente principal que encapsula o `useEditor` e renderiza a área de edição (`EditorContent`).
*   **Props:**
    *   `content`: string (HTML ou JSON do Tiptap).
    *   `onChange`: função para atualizar o estado pai.
    *   `variables`: array de objetos `{ label: string, value: string }` para o menu do `@`.

### 4.2. `MetricsList` (Menu do `@`)
Um componente customizado para renderizar a lista de sugestões do `@`.
*   Deve ser navegável por teclado (setas e Enter).
*   Deve filtrar as opções conforme o usuário digita após o `@`.

### 4.3. `BubbleMenuTools`
O menu flutuante que contém os botões de formatação (Bold, Italic, etc).
*   Só aparece quando `editor.isEditable` e há uma seleção de texto não vazia.

### 4.4. `TemplateEditor` (Refatoração)
O componente de página existente (`apps/web/features/contratos/components/TemplateEditor.tsx`) será drasticamente simplificado:
*   Remover a coluna lateral de variáveis.
*   Remover o `textarea`.
*   Integrar o novo `RichTextEditor`.

## 5. Plano de Implementação

1.  **Instalação de Dependências:** Adicionar pacotes do Tiptap.
2.  **Setup do Editor Básico:** Criar o componente `RichTextEditor` com `StarterKit`.
3.  **Implementação do `@` Variables:**
    *   Configurar a extensão `Mention`.
    *   Criar a lógica de renderização da lista (sugestão).
    *   Definir como o "node" da menção será renderizado (Badge visual).
4.  **Implementação do Bubble Menu:**
    *   Criar o componente visual do menu.
    *   Conectar aos comandos do editor (toggleBold, toggleHeading, etc).
5.  **Integração e Estilização:**
    *   Aplicar estilos CSS (Tailwind) para remover bordas padrão e dar o visual "Notion".
    *   Ajustar a persistência (converter HTML <-> Tiptap JSON se necessário, ou apenas salvar HTML limpo).

## 6. Mapeamento de Variáveis
A lista de variáveis (`PLACEHOLDERS`) atual será mapeada para o formato do menu:
*   De: `aluno.nome`
*   Para Item de Menu: `{ id: '{{aluno.nome}}', label: 'Nome do Aluno' }`
