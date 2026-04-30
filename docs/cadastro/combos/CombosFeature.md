# Documentação — Cadastro de Combos

---

## 1. Estrutura de Pastas e Arquivos
- Página principal: `apps/web/app/(app)/combos/page.tsx`
- Componentes UI: `apps/web/features/combos/components/`
  - `ComboCard.tsx` (card individual)
  - `ComboList.tsx` (listagem)
  - `ComboDialog.tsx` (modal de cadastro/edição)
  - `ComboForm.tsx` (formulário)
  - `ComboDetails.tsx` (visualização detalhada)
  - `ComboDeleteConfirm.tsx` (modal de confirmação de remoção)
  - `ComboImport.tsx` (importação de combos)
  - `ComboExport.tsx` (exportação de dados)
  - `ComboHistory.tsx` (histórico de alterações)
  - `ComboAttachment.tsx` (anexos/documentos)
- Hooks: `apps/web/features/combos/hooks/`
  - `useCombos.ts` (listagem)
  - `useComboDialog.ts` (controle de modal)
  - `useComboForm.ts` (controle de formulário)
  - `useComboDetails.ts` (fetch de detalhes)
  - `useComboImport.ts` (importação)
  - `useComboExport.ts` (exportação)
  - `useComboHistory.ts` (histórico)
  - `useComboAttachment.ts` (anexos)
- Tipos: `apps/web/features/combos/types.ts`
  - `Combo`, `ComboStatus`, `ComboPayload`, `ComboFilter`, `ComboHistory`, `ComboAttachment`
- Serviços/API: `apps/web/features/combos/services/`
  - `comboService.ts` (CRUD)
  - `comboApi.ts` (fetch, integração REST)
  - `comboImportService.ts` (importação)
  - `comboExportService.ts` (exportação)
  - `comboHistoryService.ts` (histórico)
  - `comboAttachmentService.ts` (anexos)
- Testes: `apps/web/features/combos/__tests__/`
  - Testes unitários, integração, mocks, E2E

---

## 2. Padrão Visual
- Layout mobile-first, grid/lista responsiva
- Cards: `rounded-xl`, `shadow-md`, `p-4` ou `p-6`, ícone à esquerda
- Título: `font-semibold text-lg`, nome do combo
- Campos exibidos: nome, valor, benefícios, status, ações
- Botões: `bg-brand-primary`, feedback visual (hover, disabled, loading)
- Espaçamento entre cards: `gap-4` ou `gap-6`
- Modal de cadastro/edição: `rounded-2xl`, `p-8`, campos alinhados verticalmente
- Inputs: `auth-input` (padrão do projeto), labels claras, validação inline
- Empty state: mensagem amigável, botão de ação para cadastro
- Loading: skeletons ou spinner centralizado
- Importação/exportação: botões e modais dedicados
- Histórico: timeline visual, cards de alteração
- Anexos: visualização de arquivos, upload, download
- Relatórios: exportação para PDF/Excel
- Acessibilidade: botões com `aria-label`, cards com `role="region"`, navegação por teclado, labels associadas aos inputs
- Responsividade: grid ajusta colunas conforme breakpoints, modais adaptam largura

---

## 3. Lógica e Fluxo
- Listagem de combos via hook `useCombos` (fetch API, paginação, busca, filtro por status)
- Cadastro/Edição via `ComboDialog` e `ComboForm` (validação Zod, feedback inline)
- Remoção com confirmação (`ComboDeleteConfirm`)
- Visualização de detalhes (`ComboDetails`), exibe todos campos e histórico
- Importação de combos via `ComboImport` (CSV/Excel, validação, feedback visual)
- Exportação de dados via `ComboExport` (PDF/Excel, filtros aplicados)
- Histórico de alterações via `ComboHistory` (log de mudanças, timeline)
- Anexos/documentos via `ComboAttachment` (upload, visualização, download)
- API REST: `/api/combos` (`GET`, `POST`, `PUT`, `DELETE`)
  - Payload: nome, valor, benefícios, status, anexos
  - Validação de dados com Zod (backend e frontend)
  - Regras de negócio: nome obrigatório e único, valor válido, status ativo/inativo
  - Permissões: regras de acesso para cadastro, edição, remoção, importação/exportação
- Estados: loading (skeleton/spinner), erro (toast/modal), vazio (empty state)
- Feedback visual: toast/modal para sucesso/erro, loading nos botões
- Paginação e busca: hooks e componentes para filtro por nome, valor, status, busca global
- Importação/exportação: suporte para CSV/Excel/PDF
- Histórico de alterações: exibir log de mudanças, timeline visual
- Anexos/documentos: upload, visualização, download, validação de tipos

---

## 4. Componentes Utilizados
- `ComboCard`: exibe dados resumidos e ações rápidas
- `ComboList`: renderiza grid/lista de combos
- `ComboDialog`: modal para cadastro/edição
- `ComboForm`: formulário controlado, validação Zod
- `ComboDetails`: visualização detalhada
- `ComboDeleteConfirm`: modal de confirmação
- `ComboImport`: importação de combos
- `ComboExport`: exportação de dados
- `ComboHistory`: histórico de alterações
- `ComboAttachment`: anexos/documentos
- Botões: editar, remover, visualizar, exportar, importar, anexar
- Hooks: `useCombos`, `useComboDialog`, `useComboForm`, `useComboDetails`, `useComboImport`, `useComboExport`, `useComboHistory`, `useComboAttachment`
- Tipos: `Combo`, `ComboStatus`, `ComboPayload`, `ComboFilter`, `ComboHistory`, `ComboAttachment`
- Serviços: `comboService` (CRUD), `comboApi` (fetch), `comboImportService`, `comboExportService`, `comboHistoryService`, `comboAttachmentService`

---

## 5. Testes
- Unitários para hooks (`useCombos`, `useComboDialog`, `useComboForm`, `useComboImport`, `useComboExport`, `useComboHistory`, `useComboAttachment`, validação Zod)
- Unitários para componentes (`ComboCard`, `ComboList`, `ComboDialog`, `ComboForm`, `ComboDetails`, `ComboDeleteConfirm`, `ComboImport`, `ComboExport`, `ComboHistory`, `ComboAttachment`)
- Integração para rotas API (`api/combos`)
- E2E para fluxo completo (cadastro, edição, remoção, busca, filtro, importação/exportação, histórico, anexos)
- Cobertura mínima recomendada: 80%
- Testes de edge cases: dados inválidos, duplicidade de nome, falha de conexão, permissões

---

## 6. Recomendações Gerais
- Centralize tokens visuais e variantes
- Use utilitário `cn` para merge de classes Tailwind
- Mantenha responsividade e acessibilidade
- Teste todos fluxos (unitário, integração, E2E)
- Siga padrão de props e estrutura para novos cards/listas
- Documente regras de negócio relevantes (ex: nome obrigatório, valor válido)
- Adote empty states amigáveis e feedback visual claro
- Garanta navegação por teclado e uso de labels associadas
- Proteja dados sensíveis e valide no backend
- Implemente logs/histórico de alterações
- Documente permissões e regras de acesso
- Mantenha documentação atualizada conforme evolução da feature

---

## 7. Expansão e Customização
- Para novos fluxos (ex: filtro avançado, importação/exportação de combos, relatórios), crie componentes e hooks específicos
- Nomeie arquivos conforme a função
- Mantenha clareza e separação por contexto
- Adicione campos customizados conforme necessidade da instituição
- Integre com outros domínios (planos, modalidades, alunos) via relacionamentos
- Suporte a anexos/documentos (regulamentos, fotos, laudos) se necessário
- Permita exportação de dados para relatórios
- Implemente logs/histórico de alterações e permissões avançadas

---

## 8. Exemplo de Fluxo Completo
1. Usuário acessa `/combos`
2. Lista de combos carrega via `useCombos` (com paginação e busca)
3. Clique em "Novo Combo" abre `ComboDialog`
4. Formulário valida dados via Zod
5. Submit chama API POST `/api/combos`
6. Backend valida, verifica duplicidade de nome, persiste no banco
7. Frontend atualiza lista e mostra toast de sucesso
8. Edição/remoção seguem fluxo similar, com confirmação
9. Visualização detalhada exibe todos campos e histórico
10. Importação/exportação disponíveis via botões
11. Histórico de alterações exibido em timeline
12. Anexos/documentos podem ser enviados e visualizados
13. Permissões controlam acesso às ações

---

## 9. Observações
- Sempre garantir que dados sensíveis sejam validados e protegidos
- Adotar empty states amigáveis para listas vazias
- Feedback visual claro para todas ações
- Seguir guidelines de UX do projeto
- Validar regras de negócio no backend e frontend
- Documentar integrações com outros domínios
- Manter documentação atualizada conforme evolução da feature
- Documentar permissões e fluxos de acesso
- Garantir conformidade com LGPD e boas práticas de segurança
