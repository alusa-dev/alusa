# Observações E2E — Meu Dinheiro / Transferências (DevTools)

> Sessão: 2026-06-18 · Conta sandbox **wl01** (`gestao.alusa+wl01@gmail.com`) · Ambiente local `localhost:3000`

## Performance

- **Polling agressivo** em `/api/finance/realtime/events` enquanto `/financeiro/conta` permanece aberta (dezenas de GETs por minuto). Revisar intervalo ou pausar quando aba inativa.
- **CLS** na carga inicial da página Saldo: **0,00** (trace DevTools).

## Console / acessibilidade

- Sem erros JavaScript críticos no fluxo de transferência.
- Issues Chrome: campos de formulário sem `id`/`name`; campos sem label associada; modal de senha sem username oculto (aviso de acessibilidade).
- Logs `[finance-realtime]` apenas informativos.

## Testes concluídos (sessão 1)

| Cenário | Resultado | Notas |
|---------|-----------|-------|
| Pix EMAIL BACEN `cliente-a00001@pix.bcb.gov.br` R$10 | ✅ Sucesso | Wizard taxa R$2 → saldo −R$12; listagem enriquecida (Joao Silva, BACEN); detalhe Concluído + comprovante |
| Pix EMAIL inválida `chave-invalida@test.com` | ✅ Bloqueio correto | API 400 `PIX_KEY_NAO_ENCONTRADA`; toast com orientação sandbox; saldo inalterado |
| TED formulário BB 001 + CNPJ formatado | ⚠️ Parcial | API 200 PENDING; Asaas liquidou como **Pix**; falhou PSP; saldo estornado |

## Observações de produto (bugs / inconsistências)

### P1 — Taxa exibida R$ 0,00 vs débito real

- Wizard estima taxa Pix **R$ 2,00** e total **R$ 12,00** corretamente.
- Após sucesso, **listagem e detalhe** mostram taxa **R$ 0,00**, embora o saldo tenha caído **R$ 12,00**.
- Hipótese: merge de metadados Asaas (`transferFee`) vs estimativa local; ou fee cobrada fora do campo exibido.

### P2 — Operação "Pix" para transferência iniciada como bancária

- Formulário: "Transferência bancária".
- Asaas retorna `operationType: PIX` (arranjo automático — esperado no sandbox).
- Listagem/detalhe mostram **Pix**, o que pode confundir o operador que escolheu TED.

### P3 — Nome do banco na listagem vs detalhe

- Listagem: `Banco 001` (código).
- Detalhe: `BANCO DO BRASIL S.A.` (nome oficial via GET/webhook).
- Enriquecimento funciona no detalhe; listagem ainda usa fallback por código.

### P4 — Transferência fantasma "Solicitada"

- Após bateria de testes, apareceu linha extra **Solicitada** sem metadados de destinatário (`cmqk4wngq0043wuh277qza9wh`).
- Investigar origem (retry/idempotência/reconciliação).

### P5 — TED sandbox com conta fictícia

- Falha esperada: *"Pagamento rejeitado pelo PSP do recebedor"*.
- Runbook já documenta confirmação manual no painel Asaas para TED sandbox.

### P6 — Registro local órfão após erro Asaas (Pix inválida)

- Chave `chave-invalida@test.com`: API retorna **400** `PIX_KEY_NAO_ENCONTRADA`, toast correto, saldo inalterado.
- Mesmo assim foi criado `TransferRequest` local (`cmqk4wngq0043wuh277qza9wh`) com **`asaasTransferId: null`**, status inicial **Solicitada/Aguardando**.
- Operador vê pendência fantasma na listagem até cancelar manualmente.
- **Causa provável:** persistência local antes do POST Asaas, sem rollback em erro de validação PSP.

### P7 — Copy errada no dialog de cancelamento

- Ao cancelar transferência pendente, o alerta exibe: *"Fluxo afetado: matrícula - plano - cobrança - pagamento"*.
- Template reutilizado de outro domínio (matrícula/cobrança); deve falar de transferência/saldo.

### P8 — UI não atualiza status após cancelamento (sem reload)

- `POST .../cancel` → **200**, toast "Transferência cancelada".
- Tela permaneceu **Aguardando** com botão **Cancelar** até **reload manual**.
- Após reload: status **Cancelada** correto; taxa exibida **—** (não R$ 0,00).

### P9 — Máscara monetária interpreta "10" como R$ 0,10

- No campo valor, `fill("10")` (automação / colar número inteiro) vira **R$ 0,10** no resumo.
- Operador humano digitando centavos por último pode ter o mesmo efeito se parar cedo demais.
- Usar **"10,00"** ou digitar até completar reais evita envio acidental de valor errado.

### P10 — Débito de saldo vs taxa estimada no wizard (inconsistente)

- Primeiro Pix BACEN (`a00001`): saldo **−R$ 12,00** (valor + taxa).
- Segundo Pix BACEN (`a00004`): wizard estima **R$ 12,00** total, mas saldo caiu **−R$ 10,00** imediatamente; `feeValue` no banco **0** após conclusão.
- Hipótese: taxa cobrada de forma assimétrica entre transferências ou campo Asaas `transferFee` não populado no sandbox.

### P11 — Listagem de transferência cancelada sem metadados

- Linha cancelada (`cmqk4wngq0043wuh277qza9wh`): colunas Nome/CPF/Banco **—** ou **Pix** genérico; taxa **—** (detalhe ok após reload).
- Mesmo padrão de órfãos P6: registros sem enriquecimento Asaas poluem a tabela.

### P12 — Listagem demora a refletir status Concluída

- Após Pix `a00004` concluir no banco (`DONE`), listagem ainda mostrou **Pendente** por alguns segundos; detalhe já **Concluído** ao abrir.
- Realtime/polling atualiza, mas com lag perceptível.

### P13 — Modal de senha permanece aberto após erro 400

- Pix EVP inválida: API **400** (console), saldo inalterado, mas dialog **Confirmar com senha** não fecha automaticamente; wizard volta à etapa 5 permitindo reenvio.

### P14 — CPF com 11 dígitos classificado como PHONE

- Chave `12389111100` e `123.891.111-00` (padrão BACEN Joao Silva) → UI exibe **"Chave reconhecida como PHONE"**.
- CPF formatado com dígitos verificadores válidos (`529.982.247-25`) → **CPF** correto.
- Ambiguidade CPF×telefone (11 dígitos) pode enviar tipo errado ao Asaas se operador não perceber.

### P15 — Duplo clique em "Confirmar" cria dois órfãos (sem idempotência UI)

- EVP inválida submetida 2× (duplo clique): dois `TransferRequest` (`cmqk5ga4u…`, `cmqk5h5ef…`), ambos `REQUESTED`, `asaasTransferId: null`.
- Reforça P6 e exige debounce/idempotency-key no client ou rollback server-side.

---

## Testes concluídos (sessão 2)

| Cenário | Resultado | Notas |
|---------|-----------|-------|
| Cancelamento pendente (`cmqk4wngq0043wuh277qza9wh`) | ✅ API OK | P7 copy; P8 refresh; pós-reload **Cancelada** |
| Pix EMAIL `cliente-a00004@pix.bcb.gov.br` R$10 | ✅ Sucesso | Jose Silva Silva; E2E; comprovante; P1 taxa R$0; P10 débito −10 |
| Pix CPF formatado `529.982.247-25` | ✅ Detecção UI | Reconhecido como **CPF** (não submetido — chave fictícia) |
| Pix CPF 11 dígitos `12389111100` / `123.891.111-00` | ⚠️ Bug P14 | Classificado como **PHONE** |
| Pix telefone `11999887766` | ✅ Detecção UI | Reconhecido como **PHONE** |
| Pix telefone `+5511999887766` | ✅ Detecção UI | Reconhecido como **PHONE** (+55 normalizado na UI) |
| Pix EVP aleatória `550e8400-e29b-41d4-a716-446655440000` | ✅ Bloqueio API | 400; P6 órfãos; P13 modal; P15 duplo submit |
| TED terceiro PF **sem** `ownerBirthDate` | ✅ Bloqueio UI | Campo data aparece; botão **Próxima etapa** desabilitado |
| TED terceiro PF **com** `ownerBirthDate` | [ ] Não exercitado | UI validada só até bloqueio; submit E2E pendente |

---

## Sessão 3 — testes adicionais (2026-06-18)

| Cenário | Resultado |
|---------|-----------|
| Cancelar órfãos EVP (`cmqk5h5ef…`, `cmqk5ga4u…`) | ✅ Cancelamento local sem Asaas; status **Cancelada** na listagem |
| P8 revalidação | ✅ Status **Cancelada** atualizou na listagem após cancel (sem reload manual neste fluxo) |
| Link comprovante em órfão cancelado | ⚠️ “Ver comprovante” com href `#` (P16) |
| Busca por titular “Joao” | ⚠️ Filtro não restringe linhas sem nome (P18) |
| Hint tipo de chave Pix | ⚠️ Exibe `EMAIL`/`PHONE` em inglês, não `formatPixKeyType` (P17) |

### P16 — Link “Ver comprovante” sem URL

- Detalhe de transferência cancelada localmente (sem `transactionReceiptUrl`) ainda mostra ação **Ver comprovante** apontando para `#`.

### P17 — Tipo de chave Pix em inglês na UI

- Mensagem usa `{detectedPixKeyType}` cru (`EMAIL`, `PHONE`, `EVP`) em vez de **E-mail**, **Telefone**, **Chave aleatória (Pix)**.

### P18 — Busca na listagem pouco efetiva

- Campo “Buscar por nome ou documento” não oculta linhas órfãs/canceladas sem metadados ao buscar “Joao”.

---

## Plano de implementação

Ver [`docs/plans/finance-transfer-improvements.md`](../plans/finance-transfer-improvements.md) — fases 0–5, matriz P1–P19, referências Asaas MCP/OpenAPI.

---

## Cenários pendentes (pós-sessão 3)

- [ ] TED terceiro PF **com** `ownerBirthDate` (submit E2E até Asaas)
- [ ] Pix CPF BACEN válido como chave (depende CPF registrado no sandbox)
- [ ] Saldo insuficiente no wizard (valor + taxa > R$ 190,54)
- [ ] Transferência agendada (`scheduleDate` futuro)
- [ ] Cancelamento remoto de transferência **PENDING** real no Asaas (`canBeCancelled`)

## Saldo observado (fim sessão 3)

| Momento | Saldo |
|---------|-------|
| Início sessão 3 | R$ 190,54 |
| Fim sessão 3 | R$ 190,54 |
