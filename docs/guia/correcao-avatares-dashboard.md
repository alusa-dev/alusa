# Guia de Correção: Avatares no Card "Total de alunos"

## Problema

- O card "Total de alunos" não exibia avatares corretamente devido a falhas na API `/api/dashboard/metrics` (erro 500 por referência a tabela inexistente e ausência de filtro por conta).
- O frontend dependia de dados dinâmicos, mas não tinha fallback visual robusto, causando sumiço dos avatares.

## Solução

- Backend ajustado para filtrar alunos por `contaId` e remover referências a tabelas inexistentes.
- Card atualizado para sempre exibir 3 avatares: alunos reais da conta logada e placeholders visuais quando faltar dados.
- Garantia de consistência visual e multi-tenant.

## Boas práticas

- Validar existência de modelos/tabelas antes de referenciar.
- Filtrar dados por contexto do usuário (multi-tenant).
- Implementar fallback visual em componentes dinâmicos.
- Usar logs e testes automatizados para garantir integridade dos endpoints.
- Entregar fatias verticais completas (backend + frontend + testes).

## Teste rápido

1. Cadastre alunos na conta logada.
2. Acesse o dashboard: o card deve mostrar sempre 3 avatares (alunos reais + placeholders).
3. Remova todos os alunos: placeholders continuam visíveis.

---

_Sugestão de commit:_
`fix: garantir 3 avatares no card de alunos, corrigindo API e fallback visual`
