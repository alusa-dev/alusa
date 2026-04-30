# Documentação — Cadastro de Salas

---

## 1. Estrutura de Pastas e Arquivos
- Página principal: `apps/web/app/(app)/salas/page.tsx`
- Componentes UI: `apps/web/features/salas/components/`
  - `SalaCard.tsx` (card individual)
  - `SalaList.tsx` (listagem)
  - `SalaDialog.tsx` (modal de cadastro/edição)
  - `SalaForm.tsx` (formulário)
  - `SalaDetails.tsx` (visualização detalhada)
  - `SalaDeleteConfirm.tsx` (modal de confirmação de remoção)
  - `SalaImport.tsx` (importação de salas)
  - `SalaExport.tsx` (exportação de dados)
  - `SalaHistory.tsx` (histórico de alterações)
  - `SalaAttachment.tsx` (anexos/documentos)
- Hooks: `apps/web/features/salas/hooks/`
  - `useSalas.ts` (listagem)
  - `useSalaDialog.ts` (controle de modal)
  - `useSalaForm.ts` (controle de formulário)
  - `useSalaDetails.ts` (fetch de detalhes)
  - `useSalaImport.ts` (importação)
  - `useSalaExport.ts` (exportação)
  - `useSalaHistory.ts` (histórico)
  - `useSalaAttachment.ts` (anexos)
- Tipos: `apps/web/features/salas/types.ts`
  - `Sala`, `SalaStatus`, `SalaPayload`, `SalaFilter`, `SalaHistory`, `SalaAttachment`
- Serviços/API: `apps/web/features/salas/services/`
  - `salaService.ts` (CRUD)
  - `salaApi.ts` (fetch, integração REST)
  - `salaImportService.ts` (importação)
  - `salaExportService.ts` (exportação)
  - `salaHistoryService.ts` (histórico)
  - `salaAttachmentService.ts` (anexos)
- Testes: `apps/web/features/salas/__tests__/`
  - Testes unitários, integração, mocks, E2E

---

## 2. Padrão Visual
- Layout mobile-first, grid/lista responsiva
- Cards: `rounded-xl`, `shadow-md`, `p-4` ou `p-6`, ícone à esquerda
- Título: `font-semibold text-lg`, nome da sala
- Campos exibidos: nome, capacidade, status, localização, recursos, ações
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
- Listagem de salas via hook `useSalas` (fetch API, paginação, busca, filtro por status/capacidade)
- Cadastro/Edição via `SalaDialog` e `SalaForm` (validação Zod, feedback inline)
- Remoção com confirmação (`SalaDeleteConfirm`)
- Visualização de detalhes (`SalaDetails`), exibe todos campos e histórico
- Importação de salas via `SalaImport` (CSV/Excel, validação, feedback visual)
- Exportação de dados via `SalaExport` (PDF/Excel, filtros aplicados)
- Histórico de alterações via `SalaHistory` (log de mudanças, timeline)
- Anexos/documentos via `SalaAttachment` (upload, visualização, download)
- API REST: `/api/salas` (`GET`, `POST`, `PUT`, `DELETE`)
  - Payload: nome, capacidade, localização, recursos, status, anexos
  - Validação de dados com Zod (backend e frontend)
  - Regras de negócio: nome obrigatório, capacidade válida, status ativo/inativo
  - Permissões: regras de acesso para cadastro, edição, remoção, importação/exportação
- Estados: loading (skeleton/spinner), erro (toast/modal), vazio (empty state)
- Feedback visual: toast/modal para sucesso/erro, loading nos botões
- Paginação e busca: hooks e componentes para filtro por nome, status, capacidade, busca global
- Importação/exportação: suporte para CSV/Excel/PDF
- Histórico de alterações: exibir log de mudanças, timeline visual
- Anexos/documentos: upload, visualização, download, validação de tipos

---

## 4. Componentes Utilizados
- `SalaCard`: exibe dados resumidos e ações rápidas
- `SalaList`: renderiza grid/lista de salas
- `SalaDialog`: modal para cadastro/edição
- `SalaForm`: formulário controlado, validação Zod
- `SalaDetails`: visualização detalhada
- `SalaDeleteConfirm`: modal de confirmação
- `SalaImport`: importação de salas
- `SalaExport`: exportação de dados
- `SalaHistory`: histórico de alterações
- `SalaAttachment`: anexos/documentos
- Botões: editar, remover, visualizar, exportar, importar, anexar
- Hooks: `useSalas`, `useSalaDialog`, `useSalaForm`, `useSalaDetails`, `useSalaImport`, `useSalaExport`, `useSalaHistory`, `useSalaAttachment`
- Tipos: `Sala`, `SalaStatus`, `SalaPayload`, `SalaFilter`, `SalaHistory`, `SalaAttachment`
- Serviços: `salaService` (CRUD), `salaApi` (fetch), `salaImportService`, `salaExportService`, `salaHistoryService`, `salaAttachmentService`

---

## 5. Testes
- Unitários para hooks (`useSalas`, `useSalaDialog`, `useSalaForm`, `useSalaImport`, `useSalaExport`, `useSalaHistory`, `useSalaAttachment`, validação Zod)
- Unitários para componentes (`SalaCard`, `SalaList`, `SalaDialog`, `SalaForm`, `SalaDetails`, `SalaDeleteConfirm`, `SalaImport`, `SalaExport`, `SalaHistory`, `SalaAttachment`)
- Integração para rotas API (`api/salas`)
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
- Documente regras de negócio relevantes (ex: nome obrigatório, capacidade válida)
- Adote empty states amigáveis e feedback visual claro
- Garanta navegação por teclado e uso de labels associadas
- Proteja dados sensíveis e valide no backend
- Implemente logs/histórico de alterações
- Documente permissões e regras de acesso
- Mantenha documentação atualizada conforme evolução da feature

---

## 7. Expansão e Customização
- Para novos fluxos (ex: filtro avançado, importação/exportação de salas, relatórios), crie componentes e hooks específicos
- Nomeie arquivos conforme a função
- Mantenha clareza e separação por contexto
- Adicione campos customizados conforme necessidade da instituição
- Integre com outros domínios (turmas, reservas, recursos) via relacionamentos
- Suporte a anexos/documentos (planta, fotos, laudos) se necessário
- Permita exportação de dados para relatórios
- Implemente logs/histórico de alterações e permissões avançadas

---

## 8. Exemplo de Fluxo Completo
1. Usuário acessa `/salas`
2. Lista de salas carrega via `useSalas` (com paginação e busca)
3. Clique em "Nova Sala" abre `SalaDialog`
4. Formulário valida dados via Zod
5. Submit chama API POST `/api/salas`
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
