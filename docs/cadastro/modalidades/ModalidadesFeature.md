# Documentação — Cadastro de Modalidades

---

## 1. Estrutura de Pastas e Arquivos
- Página principal: `apps/web/app/(app)/modalidades/page.tsx`
- Componentes UI: `apps/web/features/modalidades/components/`
  - `ModalidadeCard.tsx` (card individual)
  - `ModalidadeList.tsx` (listagem)
  - `ModalidadeDialog.tsx` (modal de cadastro/edição)
  - `ModalidadeForm.tsx` (formulário)
  - `ModalidadeDetails.tsx` (visualização detalhada)
  - `ModalidadeDeleteConfirm.tsx` (modal de confirmação de remoção)
  - `ModalidadeImport.tsx` (importação de modalidades)
  - `ModalidadeExport.tsx` (exportação de dados)
  - `ModalidadeHistory.tsx` (histórico de alterações)
  - `ModalidadeAttachment.tsx` (anexos/documentos)
- Hooks: `apps/web/features/modalidades/hooks/`
  - `useModalidades.ts` (listagem)
  - `useModalidadeDialog.ts` (controle de modal)
  - `useModalidadeForm.ts` (controle de formulário)
  - `useModalidadeDetails.ts` (fetch de detalhes)
  - `useModalidadeImport.ts` (importação)
  - `useModalidadeExport.ts` (exportação)
  - `useModalidadeHistory.ts` (histórico)
  - `useModalidadeAttachment.ts` (anexos)
- Tipos: `apps/web/features/modalidades/types.ts`
  - `Modalidade`, `ModalidadeStatus`, `ModalidadePayload`, `ModalidadeFilter`, `ModalidadeHistory`, `ModalidadeAttachment`
- Serviços/API: `apps/web/features/modalidades/services/`
  - `modalidadeService.ts` (CRUD)
  - `modalidadeApi.ts` (fetch, integração REST)
  - `modalidadeImportService.ts` (importação)
  - `modalidadeExportService.ts` (exportação)
  - `modalidadeHistoryService.ts` (histórico)
  - `modalidadeAttachmentService.ts` (anexos)
- Testes: `apps/web/features/modalidades/__tests__/`
  - Testes unitários, integração, mocks, E2E

---

## 2. Padrão Visual
- Layout mobile-first, grid/lista responsiva
- Cards: `rounded-xl`, `shadow-md`, `p-4` ou `p-6`, ícone à esquerda
- Título: `font-semibold text-lg`, nome da modalidade
- Campos exibidos: nome, descrição, status, recursos, ações
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
- Listagem de modalidades via hook `useModalidades` (fetch API, paginação, busca, filtro por status)
- Cadastro/Edição via `ModalidadeDialog` e `ModalidadeForm` (validação Zod, feedback inline)
- Remoção com confirmação (`ModalidadeDeleteConfirm`)
- Visualização de detalhes (`ModalidadeDetails`), exibe todos campos e histórico
- Importação de modalidades via `ModalidadeImport` (CSV/Excel, validação, feedback visual)
- Exportação de dados via `ModalidadeExport` (PDF/Excel, filtros aplicados)
- Histórico de alterações via `ModalidadeHistory` (log de mudanças, timeline)
- Anexos/documentos via `ModalidadeAttachment` (upload, visualização, download)
- API REST: `/api/modalidades` (`GET`, `POST`, `PUT`, `DELETE`)
  - Payload: nome, descrição, status, recursos, anexos
  - Validação de dados com Zod (backend e frontend)
  - Regras de negócio: nome obrigatório e único, status ativo/inativo
  - Permissões: regras de acesso para cadastro, edição, remoção, importação/exportação
- Estados: loading (skeleton/spinner), erro (toast/modal), vazio (empty state)
- Feedback visual: toast/modal para sucesso/erro, loading nos botões
- Paginação e busca: hooks e componentes para filtro por nome, status, busca global
- Importação/exportação: suporte para CSV/Excel/PDF
- Histórico de alterações: exibir log de mudanças, timeline visual
- Anexos/documentos: upload, visualização, download, validação de tipos

---

## 4. Componentes Utilizados
- `ModalidadeCard`: exibe dados resumidos e ações rápidas
- `ModalidadeList`: renderiza grid/lista de modalidades
- `ModalidadeDialog`: modal para cadastro/edição
- `ModalidadeForm`: formulário controlado, validação Zod
- `ModalidadeDetails`: visualização detalhada
- `ModalidadeDeleteConfirm`: modal de confirmação
- `ModalidadeImport`: importação de modalidades
- `ModalidadeExport`: exportação de dados
- `ModalidadeHistory`: histórico de alterações
- `ModalidadeAttachment`: anexos/documentos
- Botões: editar, remover, visualizar, exportar, importar, anexar
- Hooks: `useModalidades`, `useModalidadeDialog`, `useModalidadeForm`, `useModalidadeDetails`, `useModalidadeImport`, `useModalidadeExport`, `useModalidadeHistory`, `useModalidadeAttachment`
- Tipos: `Modalidade`, `ModalidadeStatus`, `ModalidadePayload`, `ModalidadeFilter`, `ModalidadeHistory`, `ModalidadeAttachment`
- Serviços: `modalidadeService` (CRUD), `modalidadeApi` (fetch), `modalidadeImportService`, `modalidadeExportService`, `modalidadeHistoryService`, `modalidadeAttachmentService`

---

## 5. Testes
- Unitários para hooks (`useModalidades`, `useModalidadeDialog`, `useModalidadeForm`, `useModalidadeImport`, `useModalidadeExport`, `useModalidadeHistory`, `useModalidadeAttachment`, validação Zod)
- Unitários para componentes (`ModalidadeCard`, `ModalidadeList`, `ModalidadeDialog`, `ModalidadeForm`, `ModalidadeDetails`, `ModalidadeDeleteConfirm`, `ModalidadeImport`, `ModalidadeExport`, `ModalidadeHistory`, `ModalidadeAttachment`)
- Integração para rotas API (`api/modalidades`)
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
- Documente regras de negócio relevantes (ex: nome obrigatório, status válido)
- Adote empty states amigáveis e feedback visual claro
- Garanta navegação por teclado e uso de labels associadas
- Proteja dados sensíveis e valide no backend
- Implemente logs/histórico de alterações
- Documente permissões e regras de acesso
- Mantenha documentação atualizada conforme evolução da feature

---

## 7. Expansão e Customização
- Para novos fluxos (ex: filtro avançado, importação/exportação de modalidades, relatórios), crie componentes e hooks específicos
- Nomeie arquivos conforme a função
- Mantenha clareza e separação por contexto
- Adicione campos customizados conforme necessidade da instituição
- Integre com outros domínios (turmas, planos, combos) via relacionamentos
- Suporte a anexos/documentos (regulamentos, fotos, laudos) se necessário
- Permita exportação de dados para relatórios
- Implemente logs/histórico de alterações e permissões avançadas

---

## 8. Exemplo de Fluxo Completo
1. Usuário acessa `/modalidades`
2. Lista de modalidades carrega via `useModalidades` (com paginação e busca)
3. Clique em "Nova Modalidade" abre `ModalidadeDialog`
4. Formulário valida dados via Zod
5. Submit chama API POST `/api/modalidades`
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
