# Documentação — Cadastro de Turmas

---

## 1. Estrutura de Pastas e Arquivos
- Página principal: `apps/web/app/(app)/turmas/page.tsx`
- Componentes UI: `apps/web/features/turmas/components/`
  - `TurmaCard.tsx` (card individual)
  - `TurmaList.tsx` (listagem)
  - `TurmaDialog.tsx` (modal de cadastro/edição)
  - `TurmaForm.tsx` (formulário)
  - `TurmaDetails.tsx` (visualização detalhada)
  - `TurmaDeleteConfirm.tsx` (modal de confirmação de remoção)
  - `TurmaImport.tsx` (importação de turmas)
  - `TurmaExport.tsx` (exportação de dados)
  - `TurmaHistory.tsx` (histórico de alterações)
  - `TurmaAttachment.tsx` (anexos/documentos)
- Hooks: `apps/web/features/turmas/hooks/`
  - `useTurmas.ts` (listagem)
  - `useTurmaDialog.ts` (controle de modal)
  - `useTurmaForm.ts` (controle de formulário)
  - `useTurmaDetails.ts` (fetch de detalhes)
  - `useTurmaImport.ts` (importação)
  - `useTurmaExport.ts` (exportação)
  - `useTurmaHistory.ts` (histórico)
  - `useTurmaAttachment.ts` (anexos)
- Tipos: `apps/web/features/turmas/types.ts`
  - `Turma`, `TurmaStatus`, `TurmaPayload`, `TurmaFilter`, `TurmaHistory`, `TurmaAttachment`
- Serviços/API: `apps/web/features/turmas/services/`
  - `turmaService.ts` (CRUD)
  - `turmaApi.ts` (fetch, integração REST)
  - `turmaImportService.ts` (importação)
  - `turmaExportService.ts` (exportação)
  - `turmaHistoryService.ts` (histórico)
  - `turmaAttachmentService.ts` (anexos)
- Testes: `apps/web/features/turmas/__tests__/`
  - Testes unitários, integração, mocks, E2E

---

## 2. Padrão Visual
- Layout mobile-first, grid/lista responsiva
- Cards: `rounded-xl`, `shadow-md`, `p-4` ou `p-6`, ícone à esquerda
- Título: `font-semibold text-lg`, nome da turma
- Campos exibidos: nome, modalidade, sala, professor, capacidade, status, ações
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
- Listagem de turmas via hook `useTurmas` (fetch API, paginação, busca, filtro por modalidade/sala/status)
- Cadastro/Edição via `TurmaDialog` e `TurmaForm` (validação Zod, feedback inline)
- Remoção com confirmação (`TurmaDeleteConfirm`)
- Visualização de detalhes (`TurmaDetails`), exibe todos campos e histórico
- Importação de turmas via `TurmaImport` (CSV/Excel, validação, feedback visual)
- Exportação de dados via `TurmaExport` (PDF/Excel, filtros aplicados)
- Histórico de alterações via `TurmaHistory` (log de mudanças, timeline)
- Anexos/documentos via `TurmaAttachment` (upload, visualização, download)
- API REST: `/api/turmas` (`GET`, `POST`, `PUT`, `DELETE`)
  - Payload: nome, modalidade, sala, professor, capacidade, status, anexos
  - Validação de dados com Zod (backend e frontend)
  - Regras de negócio: nome obrigatório e único, capacidade válida, vínculo com sala/modalidade/professor, status ativo/inativo
  - Permissões: regras de acesso para cadastro, edição, remoção, importação/exportação
- Estados: loading (skeleton/spinner), erro (toast/modal), vazio (empty state)
- Feedback visual: toast/modal para sucesso/erro, loading nos botões
- Paginação e busca: hooks e componentes para filtro por nome, modalidade, sala, status, busca global
- Importação/exportação: suporte para CSV/Excel/PDF
- Histórico de alterações: exibir log de mudanças, timeline visual
- Anexos/documentos: upload, visualização, download, validação de tipos

---

## 4. Componentes Utilizados
- `TurmaCard`: exibe dados resumidos e ações rápidas
- `TurmaList`: renderiza grid/lista de turmas
- `TurmaDialog`: modal para cadastro/edição
- `TurmaForm`: formulário controlado, validação Zod
- `TurmaDetails`: visualização detalhada
- `TurmaDeleteConfirm`: modal de confirmação
- `TurmaImport`: importação de turmas
- `TurmaExport`: exportação de dados
- `TurmaHistory`: histórico de alterações
- `TurmaAttachment`: anexos/documentos
- Botões: editar, remover, visualizar, exportar, importar, anexar
- Hooks: `useTurmas`, `useTurmaDialog`, `useTurmaForm`, `useTurmaDetails`, `useTurmaImport`, `useTurmaExport`, `useTurmaHistory`, `useTurmaAttachment`
- Tipos: `Turma`, `TurmaStatus`, `TurmaPayload`, `TurmaFilter`, `TurmaHistory`, `TurmaAttachment`
- Serviços: `turmaService` (CRUD), `turmaApi` (fetch), `turmaImportService`, `turmaExportService`, `turmaHistoryService`, `turmaAttachmentService`

---

## 5. Testes
- Unitários para hooks (`useTurmas`, `useTurmaDialog`, `useTurmaForm`, `useTurmaImport`, `useTurmaExport`, `useTurmaHistory`, `useTurmaAttachment`, validação Zod)
- Unitários para componentes (`TurmaCard`, `TurmaList`, `TurmaDialog`, `TurmaForm`, `TurmaDetails`, `TurmaDeleteConfirm`, `TurmaImport`, `TurmaExport`, `TurmaHistory`, `TurmaAttachment`)
- Integração para rotas API (`api/turmas`)
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
- Documente regras de negócio relevantes (ex: nome obrigatório, capacidade válida, vínculo com sala/modalidade/professor)
- Adote empty states amigáveis e feedback visual claro
- Garanta navegação por teclado e uso de labels associadas
- Proteja dados sensíveis e valide no backend
- Implemente logs/histórico de alterações
- Documente permissões e regras de acesso
- Mantenha documentação atualizada conforme evolução da feature

---

## 7. Expansão e Customização
- Para novos fluxos (ex: filtro avançado, importação/exportação de turmas, relatórios), crie componentes e hooks específicos
- Nomeie arquivos conforme a função
- Mantenha clareza e separação por contexto
- Adicione campos customizados conforme necessidade da instituição
- Integre com outros domínios (salas, modalidades, professores, alunos) via relacionamentos
- Suporte a anexos/documentos (regulamentos, fotos, laudos) se necessário
- Permita exportação de dados para relatórios
- Implemente logs/histórico de alterações e permissões avançadas

---

## 8. Exemplo de Fluxo Completo
1. Usuário acessa `/turmas`
2. Lista de turmas carrega via `useTurmas` (com paginação e busca)
3. Clique em "Nova Turma" abre `TurmaDialog`
4. Formulário valida dados via Zod
5. Submit chama API POST `/api/turmas`
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
