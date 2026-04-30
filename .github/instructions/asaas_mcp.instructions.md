---
applyTo: '**'
---

## Asaas MCP (Model Context Protocol) — Contrato de Uso na Alusa

### Objetivo
Padronizar e tornar seguras as interações com o Asaas via MCP, garantindo:
- chamadas corretas (read-before-write)
- validação de pré-condições de negócio da Alusa
- prevenção de efeitos colaterais financeiros
- rastreabilidade e auditoria

### O que é o MCP do Asaas
- O MCP do Asaas é um servidor público que expõe a especificação OpenAPI como recurso estruturado para o assistente:
  - listar endpoints
  - obter schemas de request/response
  - gerar snippets
  - executar chamadas (com autenticação)
  - pesquisar documentação
- Endpoint MCP: https://docs.asaas.com/mcp
- O acesso é via cliente MCP; execução de chamadas exige `access_token` do Asaas e deve ser tratada como credencial sensível.

### Regras de Ouro (Invioláveis)
1. **Read-before-write**: antes de POST/PUT/DELETE, sempre fazer GET/list para confirmar estado atual.
2. **Nunca inferir estado financeiro**: status de pagamento/cancelamento/inadimplência é “verdade externa” do Asaas; no sistema, refletimos via eventos/webhooks.
3. **Responsável financeiro é o pagador**:
   - apenas o responsável financeiro pode ser `Customer` no Asaas (logo, pode ter `asaasCustomerId`)
   - aluno dependente não deve virar Customer
4. **Subconta correta sempre**: qualquer chamada deve operar na subconta/token correspondente à instituição (isolamento financeiro).
5. **Sem mutações silenciosas**: nenhuma ação de escrita deve ocorrer “porque parece certo”.
   - só executar mutação se houver intenção explícita do fluxo (ex.: “criar cobrança”, “cancelar assinatura”, etc.)
6. **Confirmação pós-escrita**: após mutação, confirmar o recurso via GET e registrar IDs retornados.

### Fluxo Padrão para Qualquer Ação via MCP
Para qualquer demanda:
1) **Descobrir** (MCP → schema): identificar endpoint correto e parâmetros obrigatórios.
2) **Validar pré-condições (Alusa)**:
   - existe instituição e subconta válida?
   - existe responsável financeiro definido?
   - já existe `asaasCustomerId` do responsável?
   - o vínculo matrícula → plano → responsável está consistente?
3) **Ler estado no Asaas (GET/list)**:
   - procurar customer/cobrança/assinatura existente antes de criar/alterar.
4) **Executar mutação mínima (POST/PUT/DELETE)**
   - somente o estritamente necessário
   - registrar `id` e campos-chave retornados
5) **Verificar** (GET pós-escrita)
6) **Persistir e auditar**:
   - salvar IDs externos (customerId/paymentId/subscriptionId)
   - salvar payload essencial e correlação (requestId interno, timestamps)

### Políticas para Chamadas de Escrita (POST/PUT/DELETE)
- **Criar customer**: apenas para responsável financeiro e apenas se não existir customer equivalente.
- **Criar cobrança/assinatura**: somente se houver vínculo rastreável com matrícula/plano e pagador (responsável).
- **Cancelar/suspender**: preferir ações reversíveis quando possível e sempre registrar motivação e relação com matrícula/plano.
- **Evitar ações críticas em produção** sem contexto suficiente (ex.: estornos/cancelamentos em lote).

### Confiabilidade de Versão da API
- Por padrão, o MCP usa a versão estável mais recente da documentação.
- Se precisar reproduzir comportamento antigo ou validar mudanças, usar `?branch=<nome_do_branch>` na URL do MCP (quando aplicável).

### Uso do LLMs.txt
- Considerar o `llms.txt` do Asaas como guia para reduzir alucinações e manter terminologia/rotas corretas ao consultar documentação.

### Padrões de Saída (como o assistente deve responder ao executar/planejar chamadas MCP)
Sempre retornar:
- endpoint usado + objetivo
- pré-condições verificadas (checklist)
- IDs externos relevantes (ex.: customerId, paymentId, subscriptionId)
- próximos passos (ex.: “aguardar webhook X para confirmar status”, ou “confirmado via GET”)
- riscos/impactos (ex.: “ação financeira irreversível”)