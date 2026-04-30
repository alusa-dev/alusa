# Documentação — Cadastro de Planos

---

## 1. Estrutura de Pastas e Arquivos
- Página principal: `apps/web/app/(app)/planos/page.tsx`
- Componentes UI: `apps/web/features/planos/components/`
  - `PlanoCard.tsx` (card individual)
  - `PlanoList.tsx` (listagem)
  - `PlanoDialog.tsx` (modal de cadastro/edição)
  - `PlanoForm.tsx` (formulário)
  - `PlanoDetails.tsx` (visualização detalhada)
  - `PlanoDeleteConfirm.tsx` (modal de confirmação de remoção)
  - `PlanoImport.tsx` (importação de planos)
  - `PlanoExport.tsx` (exportação de dados)
  - `PlanoHistory.tsx` (histórico de alterações)
  - `PlanoAttachment.tsx` (anexos/documentos)
- Hooks: `apps/web/features/planos/hooks/`
  - `usePlanos.ts` (listagem)
  - `usePlanoDialog.ts` (controle de modal)
  - `usePlanoForm.ts` (controle de formulário)
  - `usePlanoDetails.ts` (fetch de detalhes)
  - `usePlanoImport.ts` (importação)
  - `usePlanoExport.ts` (exportação)
  - `usePlanoHistory.ts` (histórico)
  - `usePlanoAttachment.ts` (anexos)
- Tipos: `apps/web/features/planos/types.ts`
  - `Plano`, `PlanoStatus`, `PlanoPayload`, `PlanoFilter`, `PlanoHistory`, `PlanoAttachment`
- Serviços/API: `apps/web/features/planos/services/`
  - `planoService.ts` (CRUD)
  - `planoApi.ts` (fetch, integração REST)
  - `planoImportService.ts` (importação)
  - `planoExportService.ts` (exportação)
  - `planoHistoryService.ts` (histórico)
  - `planoAttachmentService.ts` (anexos)
- Testes: `apps/web/features/planos/__tests__/`
  - Testes unitários, integração, mocks, E2E

---

## 2. Padrão Visual
- Layout mobile-first, grid/lista responsiva
- Cards: `rounded-xl`, `shadow-md`, `p-4` ou `p-6`, ícone à esquerda
- Título: `font-semibold text-lg`, nome do plano
- Campos exibidos: nome, valor, duração, status, benefícios, ações
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
- Listagem de planos via hook `usePlanos` (fetch API, paginação, busca, filtro por status/duração)
- Cadastro/Edição via `PlanoDialog` e `PlanoForm` (validação Zod, feedback inline)
- Remoção com confirmação (`PlanoDeleteConfirm`)
- Visualização de detalhes (`PlanoDetails`), exibe todos campos e histórico
- Importação de planos via `PlanoImport` (CSV/Excel, validação, feedback visual)
- Exportação de dados via `PlanoExport` (PDF/Excel, filtros aplicados)
- Histórico de alterações via `PlanoHistory` (log de mudanças, timeline)
- Anexos/documentos via `PlanoAttachment` (upload, visualização, download)
- API REST: `/api/planos` (`GET`, `POST`, `PUT`, `DELETE`)
  - Payload: nome, valor, duração, benefícios, status, anexos
  - Validação de dados com Zod (backend e frontend)
  - Regras de negócio: nome obrigatório e único, valor válido, duração positiva, status ativo/inativo
  - Permissões: regras de acesso para cadastro, edição, remoção, importação/exportação
- Estados: loading (skeleton/spinner), erro (toast/modal), vazio (empty state)
- Feedback visual: toast/modal para sucesso/erro, loading nos botões
- Paginação e busca: hooks e componentes para filtro por nome, valor, duração, status, busca global
- Importação/exportação: suporte para CSV/Excel/PDF
- Histórico de alterações: exibir log de mudanças, timeline visual
- Anexos/documentos: upload, visualização, download, validação de tipos

---

## 4. Componentes Utilizados
- `PlanoCard`: exibe dados resumidos e ações rápidas
- `PlanoList`: renderiza grid/lista de planos
- `PlanoDialog`: modal para cadastro/edição
- `PlanoForm`: formulário controlado, validação Zod
- `PlanoDetails`: visualização detalhada
- `PlanoDeleteConfirm`: modal de confirmação
- `PlanoImport`: importação de planos
- `PlanoExport`: exportação de dados
- `PlanoHistory`: histórico de alterações
- `PlanoAttachment`: anexos/documentos
- Botões: editar, remover, visualizar, exportar, importar, anexar
- Hooks: `usePlanos`, `usePlanoDialog`, `usePlanoForm`, `usePlanoDetails`, `usePlanoImport`, `usePlanoExport`, `usePlanoHistory`, `usePlanoAttachment`
- Tipos: `Plano`, `PlanoStatus`, `PlanoPayload`, `PlanoFilter`, `PlanoHistory`, `PlanoAttachment`
- Serviços: `planoService` (CRUD), `planoApi` (fetch), `planoImportService`, `planoExportService`, `planoHistoryService`, `planoAttachmentService`

---

## 5. Testes
- Unitários para hooks (`usePlanos`, `usePlanoDialog`, `usePlanoForm`, `usePlanoImport`, `usePlanoExport`, `usePlanoHistory`, `usePlanoAttachment`, validação Zod)
- Unitários para componentes (`PlanoCard`, `PlanoList`, `PlanoDialog`, `PlanoForm`, `PlanoDetails`, `PlanoDeleteConfirm`, `PlanoImport`, `PlanoExport`, `PlanoHistory`, `PlanoAttachment`)
- Integração para rotas API (`api/planos`)
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
- Documente regras de negócio relevantes (ex: nome obrigatório, valor válido, duração positiva)
- Adote empty states amigáveis e feedback visual claro
- Garanta navegação por teclado e uso de labels associadas
- Proteja dados sensíveis e valide no backend
- Implemente logs/histórico de alterações
- Documente permissões e regras de acesso
- Mantenha documentação atualizada conforme evolução da feature

---

## 7. Expansão e Customização
- Para novos fluxos (ex: filtro avançado, importação/exportação de planos, relatórios), crie componentes e hooks específicos
- Nomeie arquivos conforme a função
- Mantenha clareza e separação por contexto
- Adicione campos customizados conforme necessidade da instituição
- Integre com outros domínios (modalidades, combos, alunos) via relacionamentos
- Suporte a anexos/documentos (regulamentos, fotos, laudos) se necessário
- Permita exportação de dados para relatórios
- Implemente logs/histórico de alterações e permissões avançadas

---

## 8. Exemplo de Fluxo Completo
1. Usuário acessa `/planos`
2. Lista de planos carrega via `usePlanos` (com paginação e busca)
3. Clique em "Novo Plano" abre `PlanoDialog`
4. Formulário valida dados via Zod
5. Submit chama API POST `/api/planos`
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
