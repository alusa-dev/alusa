# Documentação — Cadastro de Colaboradores

---

## 1. Estrutura de Pastas e Arquivos
- Página principal: `apps/web/app/(app)/colaboradores/page.tsx`
- Novo colaborador: `apps/web/app/(app)/colaboradores/new/page.tsx`
- Componentes UI: `apps/web/features/colaboradores/components/`
  - `ColaboradorCard.tsx` (card individual)
  - `ColaboradorList.tsx` (listagem)
  - `ColaboradorDialog.tsx` (modal de cadastro/edição)
  - `ColaboradorForm.tsx` (formulário)
  - `ColaboradorDetails.tsx` (visualização detalhada)
  - `ColaboradorDeleteConfirm.tsx` (modal de confirmação de remoção)
  - `ColaboradorImport.tsx` (importação de colaboradores)
  - `ColaboradorExport.tsx` (exportação de dados)
  - `ColaboradorHistory.tsx` (histórico de alterações)
  - `ColaboradorAttachment.tsx` (anexos/documentos)
- Hooks: `apps/web/features/colaboradores/hooks/`
  - `useColaboradores.ts` (listagem)
  - `useColaboradorDialog.ts` (controle de modal)
  - `useColaboradorForm.ts` (controle de formulário)
  - `useColaboradorDetails.ts` (fetch de detalhes)
  - `useColaboradorImport.ts` (importação)
  - `useColaboradorExport.ts` (exportação)
  - `useColaboradorHistory.ts` (histórico)
  - `useColaboradorAttachment.ts` (anexos)
- Tipos: `apps/web/features/colaboradores/types.ts`
  - `Colaborador`, `ColaboradorStatus`, `ColaboradorPayload`, `ColaboradorFilter`, `ColaboradorHistory`, `ColaboradorAttachment`
- Serviços/API: `apps/web/features/colaboradores/services/`
  - `colaboradorService.ts` (CRUD)
  - `colaboradorApi.ts` (fetch, integração REST)
  - `colaboradorImportService.ts` (importação)
  - `colaboradorExportService.ts` (exportação)
  - `colaboradorHistoryService.ts` (histórico)
  - `colaboradorAttachmentService.ts` (anexos)
- Testes: `apps/web/features/colaboradores/__tests__/`
  - Testes unitários, integração, mocks, E2E

---

## 2. Padrão Visual
- Layout mobile-first, grid/lista responsiva
- Cards: `rounded-xl`, `shadow-md`, `p-4` ou `p-6`, ícone/avatar à esquerda
- Título: `font-semibold text-lg`, nome do colaborador
- Campos exibidos: nome, cargo, status, matrícula, data de admissão, contato, CPF, RG, endereço, ações
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
- Listagem de colaboradores via hook `useColaboradores` (fetch API, paginação, busca, filtro por cargo/status)
- Cadastro/Edição via `ColaboradorDialog` e `ColaboradorForm` (validação Zod, máscara de campos, feedback inline)
- Remoção com confirmação (`ColaboradorDeleteConfirm`)
- Visualização de detalhes (`ColaboradorDetails`), exibe todos campos e histórico
- Importação de colaboradores via `ColaboradorImport` (CSV/Excel, validação, feedback visual)
- Exportação de dados via `ColaboradorExport` (PDF/Excel, filtros aplicados)
- Histórico de alterações via `ColaboradorHistory` (log de mudanças, timeline)
- Anexos/documentos via `ColaboradorAttachment` (upload, visualização, download)
- API REST: `/api/colaboradores` (`GET`, `POST`, `PUT`, `DELETE`)
  - Payload: nome, cargo, matrícula, data de admissão, contato, status, CPF, RG, endereço, observações, anexos
  - Validação de dados com Zod (backend e frontend)
  - Regras de negócio: matrícula obrigatória, CPF único, data de admissão válida, status ativo/inativo
  - Permissões: regras de acesso para cadastro, edição, remoção, importação/exportação
- Estados: loading (skeleton/spinner), erro (toast/modal), vazio (empty state)
- Feedback visual: toast/modal para sucesso/erro, loading nos botões
- Paginação e busca: hooks e componentes para filtro por nome, cargo, status, busca global
- Importação/exportação: suporte para CSV/Excel/PDF
- Histórico de alterações: exibir log de mudanças, timeline visual
- Anexos/documentos: upload, visualização, download, validação de tipos

---

## 4. Componentes Utilizados
- `ColaboradorCard`: exibe dados resumidos e ações rápidas
- `ColaboradorList`: renderiza grid/lista de colaboradores
- `ColaboradorDialog`: modal para cadastro/edição
- `ColaboradorForm`: formulário controlado, validação Zod, máscaras
- `ColaboradorDetails`: visualização detalhada
- `ColaboradorDeleteConfirm`: modal de confirmação
- `ColaboradorImport`: importação de colaboradores
- `ColaboradorExport`: exportação de dados
- `ColaboradorHistory`: histórico de alterações
- `ColaboradorAttachment`: anexos/documentos
- Botões: editar, remover, visualizar, exportar, importar, anexar
- Hooks: `useColaboradores`, `useColaboradorDialog`, `useColaboradorForm`, `useColaboradorDetails`, `useColaboradorImport`, `useColaboradorExport`, `useColaboradorHistory`, `useColaboradorAttachment`
- Tipos: `Colaborador`, `ColaboradorStatus`, `ColaboradorPayload`, `ColaboradorFilter`, `ColaboradorHistory`, `ColaboradorAttachment`
- Serviços: `colaboradorService` (CRUD), `colaboradorApi` (fetch), `colaboradorImportService`, `colaboradorExportService`, `colaboradorHistoryService`, `colaboradorAttachmentService`

---

## 5. Testes
- Unitários para hooks (`useColaboradores`, `useColaboradorDialog`, `useColaboradorForm`, `useColaboradorImport`, `useColaboradorExport`, `useColaboradorHistory`, `useColaboradorAttachment`, validação Zod)
- Unitários para componentes (`ColaboradorCard`, `ColaboradorList`, `ColaboradorDialog`, `ColaboradorForm`, `ColaboradorDetails`, `ColaboradorDeleteConfirm`, `ColaboradorImport`, `ColaboradorExport`, `ColaboradorHistory`, `ColaboradorAttachment`)
- Integração para rotas API (`api/colaboradores`)
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
- Documente regras de negócio relevantes (ex: matrícula obrigatória, validação de CPF, vínculo com cargo)
- Adote empty states amigáveis e feedback visual claro
- Garanta navegação por teclado e uso de labels associadas
- Proteja dados sensíveis (CPF, contato) e valide no backend
- Implemente logs/histórico de alterações
- Documente permissões e regras de acesso
- Mantenha documentação atualizada conforme evolução da feature

---

## 7. Expansão e Customização
- Para novos fluxos (ex: filtro avançado, importação/exportação de colaboradores, relatórios), crie componentes e hooks específicos
- Nomeie arquivos conforme a função
- Mantenha clareza e separação por contexto
- Adicione campos customizados conforme necessidade da instituição
- Integre com outros domínios (turmas, permissões, áreas) via relacionamentos
- Suporte a anexos/documentos (RG, comprovante de residência, contrato) se necessário
- Permita exportação de dados para relatórios
- Implemente logs/histórico de alterações e permissões avançadas

---

## 8. Exemplo de Fluxo Completo
1. Usuário acessa `/colaboradores`
2. Lista de colaboradores carrega via `useColaboradores` (com paginação e busca)
3. Clique em "Novo Colaborador" abre `ColaboradorDialog`
4. Formulário valida dados via Zod, aplica máscaras
5. Submit chama API POST `/api/colaboradores`
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
