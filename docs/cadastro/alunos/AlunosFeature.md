# Documentação — Cadastro de Alunos

---

## 1. Estrutura de Pastas e Arquivos
- Página principal: `apps/web/app/(app)/alunos/page.tsx`
- Componentes UI: `apps/web/features/alunos/components/`
  - `AlunoCard.tsx` (card individual)
  - `AlunoList.tsx` (listagem)
  - `AlunoDialog.tsx` (modal de cadastro/edição)
  - `AlunoForm.tsx` (formulário)
  - `AlunoDetails.tsx` (visualização detalhada)
  - `AlunoDeleteConfirm.tsx` (modal de confirmação de remoção)
  - `AlunoImport.tsx` (importação de alunos)
  - `AlunoExport.tsx` (exportação de dados)
  - `AlunoHistory.tsx` (histórico de alterações)
  - `AlunoAttachment.tsx` (anexos/documentos)
- Hooks: `apps/web/features/alunos/hooks/`
  - `useAlunos.ts` (listagem)
  - `useAlunoDialog.ts` (controle de modal)
  - `useAlunoForm.ts` (controle de formulário)
  - `useAlunoDetails.ts` (fetch de detalhes)
  - `useAlunoImport.ts` (importação)
  - `useAlunoExport.ts` (exportação)
  - `useAlunoHistory.ts` (histórico)
  - `useAlunoAttachment.ts` (anexos)
- Tipos: `apps/web/features/alunos/types.ts`
  - `Aluno`, `AlunoStatus`, `AlunoPayload`, `AlunoFilter`, `AlunoHistory`, `AlunoAttachment`
- Serviços/API: `apps/web/features/alunos/services/`
  - `alunoService.ts` (CRUD)
  - `alunoApi.ts` (fetch, integração REST)
  - `alunoImportService.ts` (importação)
  - `alunoExportService.ts` (exportação)
  - `alunoHistoryService.ts` (histórico)
  - `alunoAttachmentService.ts` (anexos)
- Testes: `apps/web/features/alunos/__tests__/`
  - Testes unitários, integração, mocks, E2E

---

## 2. Padrão Visual
- Layout mobile-first, grid/lista responsiva
- Cards: `rounded-xl`, `shadow-md`, `p-4` ou `p-6`, ícone/avatar à esquerda
- Título: `font-semibold text-lg`, nome do aluno
- Campos exibidos: nome, matrícula, status, turma, data de nascimento, contato, CPF, RG, endereço, ações
- Botões: `bg-brand-primary`, feedback visual (hover, disabled, loading)
- Espaçamento entre cards: `gap-4` ou `gap-6`
- Modal de cadastro/edição: `rounded-2xl`, `p-8`, campos alinhados verticalmente
- Inputs: `auth-input` (padrão do projeto), labels claras, validação inline, máscara para CPF/RG/telefone
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
- Listagem de alunos via hook `useAlunos` (fetch API, paginação, busca, filtro por turma/status)
- Cadastro/Edição via `AlunoDialog` e `AlunoForm` (validação Zod, máscara de campos, feedback inline)
- Remoção com confirmação (`AlunoDeleteConfirm`)
- Visualização de detalhes (`AlunoDetails`), exibe todos campos e histórico
- Importação de alunos via `AlunoImport` (CSV/Excel, validação, feedback visual)
- Exportação de dados via `AlunoExport` (PDF/Excel, filtros aplicados)
- Histórico de alterações via `AlunoHistory` (log de mudanças, timeline)
- Anexos/documentos via `AlunoAttachment` (upload, visualização, download)
- API REST: `/api/alunos` (`GET`, `POST`, `PUT`, `DELETE`)
  - Payload: nome, matrícula, turma, data de nascimento, contato, status, CPF, RG, endereço, observações, anexos
  - Validação de dados com Zod (backend e frontend)
  - Regras de negócio: matrícula obrigatória, CPF único, data de nascimento válida, status ativo/inativo, vínculo com turma
  - Permissões: regras de acesso para cadastro, edição, remoção, importação/exportação
- Estados: loading (skeleton/spinner), erro (toast/modal), vazio (empty state)
- Feedback visual: toast/modal para sucesso/erro, loading nos botões
- Paginação e busca: hooks e componentes para filtro por nome, turma, status, busca global
- Importação/exportação: suporte para CSV/Excel/PDF
- Histórico de alterações: exibir log de mudanças, timeline visual
- Anexos/documentos: upload, visualização, download, validação de tipos

---

## 4. Componentes Utilizados
- `AlunoCard`: exibe dados resumidos e ações rápidas
- `AlunoList`: renderiza grid/lista de alunos
- `AlunoDialog`: modal para cadastro/edição
- `AlunoForm`: formulário controlado, validação Zod, máscaras
- `AlunoDetails`: visualização detalhada
- `AlunoDeleteConfirm`: modal de confirmação
- `AlunoImport`: importação de alunos
- `AlunoExport`: exportação de dados
- `AlunoHistory`: histórico de alterações
- `AlunoAttachment`: anexos/documentos
- Botões: editar, remover, visualizar, exportar, importar, anexar
- Hooks: `useAlunos`, `useAlunoDialog`, `useAlunoForm`, `useAlunoDetails`, `useAlunoImport`, `useAlunoExport`, `useAlunoHistory`, `useAlunoAttachment`
- Tipos: `Aluno`, `AlunoStatus`, `AlunoPayload`, `AlunoFilter`, `AlunoHistory`, `AlunoAttachment`
- Serviços: `alunoService` (CRUD), `alunoApi` (fetch), `alunoImportService`, `alunoExportService`, `alunoHistoryService`, `alunoAttachmentService`

---

## 5. Testes
- Unitários para hooks (`useAlunos`, `useAlunoDialog`, `useAlunoForm`, `useAlunoImport`, `useAlunoExport`, `useAlunoHistory`, `useAlunoAttachment`, validação Zod)
- Unitários para componentes (`AlunoCard`, `AlunoList`, `AlunoDialog`, `AlunoForm`, `AlunoDetails`, `AlunoDeleteConfirm`, `AlunoImport`, `AlunoExport`, `AlunoHistory`, `AlunoAttachment`)
- Integração para rotas API (`api/alunos`)
- E2E para fluxo completo (cadastro, edição, remoção, busca, filtro, importação/exportação, histórico, anexos)
- Cobertura mínima recomendada: 80%
- Testes de edge cases: dados inválidos, duplicidade de CPF, falha de conexão, permissões

---

## 6. Recomendações Gerais
- Centralize tokens visuais e variantes
- Use utilitário `cn` para merge de classes Tailwind
- Mantenha responsividade e acessibilidade
- Teste todos fluxos (unitário, integração, E2E)
- Siga padrão de props e estrutura para novos cards/listas
- Documente regras de negócio relevantes (ex: matrícula obrigatória, validação de CPF, vínculo com turma)
- Adote empty states amigáveis e feedback visual claro
- Garanta navegação por teclado e uso de labels associadas
- Proteja dados sensíveis (CPF, contato) e valide no backend
- Implemente logs/histórico de alterações
- Documente permissões e regras de acesso
- Mantenha documentação atualizada conforme evolução da feature

---

## 7. Expansão e Customização
- Para novos fluxos (ex: filtro avançado, importação/exportação de alunos, relatórios), crie componentes e hooks específicos
- Nomeie arquivos conforme a função
- Mantenha clareza e separação por contexto
- Adicione campos customizados conforme necessidade da instituição
- Integre com outros domínios (turmas, planos, combos) via relacionamentos
- Suporte a anexos/documentos (RG, comprovante de residência) se necessário
- Permita exportação de dados para relatórios
- Implemente logs/histórico de alterações e permissões avançadas

---

## 8. Exemplo de Fluxo Completo
1. Usuário acessa `/alunos`
2. Lista de alunos carrega via `useAlunos` (com paginação e busca)
3. Clique em "Novo Aluno" abre `AlunoDialog`
4. Formulário valida dados via Zod, aplica máscaras
5. Submit chama API POST `/api/alunos`
6. Backend valida, verifica duplicidade de CPF, persiste no banco
7. Frontend atualiza lista e mostra toast de sucesso
8. Edição/remoção seguem fluxo similar, com confirmação
9. Visualização detalhada exibe todos campos e histórico
10. Importação/exportação disponíveis via botões
11. Histórico de alterações exibido em timeline
12. Anexos/documentos podem ser enviados e visualizados
13. Permissões controlam acesso às ações

---

## 9. Observações
- Sempre garantir que dados sensíveis (CPF, contato) sejam validados e protegidos
- Adotar empty states amigáveis para listas vazias
- Feedback visual claro para todas ações
- Seguir guidelines de UX do projeto
- Validar regras de negócio no backend e frontend
- Documentar integrações com outros domínios
- Manter documentação atualizada conforme evolução da feature
- Documentar permissões e fluxos de acesso
- Garantir conformidade com LGPD e boas práticas de segurança
