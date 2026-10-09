# Checklist de validação prática da Alusa

Use este documento para marcar o que foi executado e confirmado por testes
manuais ou uso em escola piloto. Marque uma caixa somente depois da confirmação
de quem realizou o teste. Testes automatizados, revisão de código e builds são
evidências complementares e não substituem a validação prática.

**Escola piloto informada:** Ballet Elaine Costa.

Não inclua dados pessoais de alunos ou responsáveis, credenciais, tokens ou
informações financeiras sensíveis.

## Visão geral

- [x] **Cadastros:** fluxo completo de ponta a ponta validado.
- [x] **Eventos:** cenários listados abaixo validados na prática.
- [ ] **Loja:** cenários listados abaixo validados; falta validar cobrança via Asaas.

## Cadastros

**Confirmado por:** Usuário · **Data da confirmação:** 2026-10-06
**Escola piloto:** Ballet Elaine Costa. **Tipo de validação:** Ponta a ponta; não foi especificado se este fluxo foi testado especificamente no piloto ou em teste manual.

- [x] Cadastro de alunos.
- [x] Cadastro de responsáveis.
- [x] Cadastro de salas.
- [x] Cadastro de turmas.
- [x] Cadastro de modalidades.
- [x] Cadastro de planos.
- [x] Demais cadastros do módulo.
- [x] Fluxo completo do módulo exercitado de ponta a ponta e funcionando.

## Eventos

**Confirmado por:** Usuário · **Data da confirmação:** 2026-10-06
**Escola piloto:** Ballet Elaine Costa. **Tipo de validação:** Testes práticos; não foi especificado se estes cenários foram testados especificamente no piloto ou em teste manual.

- [x] Criar eventos.
- [x] Editar eventos.
- [x] Inscrever participantes.
- [x] Gerar cobrança pelo Asaas no ato da inscrição.
- [x] Gerar cobrança manualmente.
- [x] Registrar baixas manuais de valores.
- [x] Cancelar cobranças.
- [x] Realizar estornos.
- [x] Cancelar uma inscrição.
- [x] Excluir um inscrito.
- [x] Registrar baixas manuais parciais de valores do festival em pagamentos sucessivos, até quitar o valor.
- [x] Receber webhooks e confirmar pagamentos.

> A validação de Eventos cobre os cenários marcados acima, conforme informado,
> e não representa confirmação de todos os comportamentos possíveis do módulo.

### Bilheteria online — pendente de validação pós-implementação

Os itens abaixo são cenários planejados; nenhum é considerado validado só por haver teste automatizado ou código implementado.

- [ ] Compra e confirmação de pagamento em sandbox; emissão e entrega dos ingressos.
- [ ] Reserva expirada com assentos ainda disponíveis e pagamento tardio; reclaim integral sem duplicidade.
- [ ] Reserva expirada com assentos indisponíveis; não emitir e iniciar estorno automático.
- [ ] Solicitação de estorno integral sem check-in; bloquear PDF, e-mail e check-in até a decisão final.
- [ ] Impedir estorno com ingresso utilizado e validar corrida check-in × solicitação de estorno.
- [ ] Boleto: URL de ação segura apresentada ao comprador e notificação enviada; pedido não aparece como estornado antes da confirmação.
- [ ] Pix/cartão: webhook de estorno em andamento, recusado e concluído.
- [ ] Chargeback: eventos duplicados/fora de ordem e bloqueio de check-in/entrega; desbloqueio após resolução favorável.
- [ ] Isolamento entre Conta A e Conta B para pedido, cobrança, ingresso, estorno e webhook.
- [ ] Execução observada dos crons e processamento da outbox na versão implantada.

## Loja

**Confirmado por:** Usuário · **Data da confirmação:** 2026-10-06
**Escola piloto:** Ballet Elaine Costa. **Tipo de validação:** Testes práticos; não foi especificado se estes cenários foram testados especificamente no piloto ou em teste manual.

- [x] Cadastrar produtos.
- [x] Editar produtos.
- [x] Criar categorias.
- [x] Repor estoque.
- [x] Realizar venda manual com pagamento manual e integral do valor.
- [x] Consultar o histórico.
- [x] Gerar comprovante.
- [ ] Gerar cobrança pelo Asaas para uma venda — ainda não testado na prática.

> A validação da venda cobre o pagamento manual integral informado. Pagamentos
> parciais e outros meios de pagamento não foram confirmados neste registro.

## Próximas validações

Use as caixas abaixo para acompanhar testes ainda pendentes. Acrescente o nome
do cenário e o módulo antes de executar.

- [ ] **Módulo / cenário:** ______________________________
  - **Data:** __________ · **Confirmado por:** __________________
  - **Resultado / observações:** __________________________________________

## Como atualizar

- Marque `[x]` somente os cenários executados e confirmados na prática.
- Para falhas ou resultados parciais, deixe a caixa desmarcada e anote o estado,
  o que ocorreu e o que falta validar.
- Registre a data e quem confirmou cada cenário ou grupo de cenários.
- Não generalize a validação de um cenário para todo o módulo.

## Histórico de atualização

- **2026-10-06 — Usuário:** registrados os cenários confirmados de cadastros, Eventos e Loja e o nome da escola piloto; cobrança Asaas da Loja permanece pendente.
