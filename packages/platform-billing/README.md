# @alusa/platform-billing

Cobrança da assinatura comercial da Alusa via Stripe: faixas por alunos
elegíveis, trial, acesso, webhooks e reconciliação.

Não misturar com cobranças educacionais das escolas no Asaas. Toda operação
tenant-scoped deve receber `contaId` validado pelo chamador.

O preço inicial vem da quantidade efetiva calculada no servidor ou, antes das
primeiras matrículas, da estimativa concluída e persistida no onboarding. O
payload do checkout não define faixa ou preço. Alunos contam uma vez por Conta
quando têm matrícula efetiva e onerosa em qualquer periodicidade suportada;
inadimplência não remove elegibilidade e bolsa integral pode removê-la.

As faixas mensais são: 1–25 R$ 169; 26–50 R$ 229; 51–100 R$ 289;
101–150 R$ 349; 151–200 R$ 419; 201–300 R$ 479; 301–400 R$ 559;
401–500 R$ 649. Mais de 500 exige atendimento especializado para novas
contratações e não bloqueia a operação de escolas já contratadas. Mudanças
exigem três fechamentos consecutivos na mesma faixa.

O trial dura 14 dias sem exigir cartão. A inclusão opcional de cartão durante o
trial usa Setup Checkout separado, com consentimento explícito, e não converte
o plano nem inicia cobrança. A contratação ocorre em Checkout explícito e a
ativação depende de confirmação financeira Stripe.
O job não reconstrói uma competência perdida usando dados atuais: cria issue
`MONTHLY_CLOSE_INCONCLUSIVE` e preserva a faixa vigente. Uma competência mais
recente não resolve o mês ausente por si só. A manutenção pode reconstruir a
competência original quando a contagem histórica passa as verificações de
`updatedAt`, existe marcador de cobertura anterior ao mês e não houve matrícula
excluída após o fechamento. Caso contrário, a issue permanece aberta. Contas
ainda fora do billing ou abertas depois do fim do período não recebem issues
retroativas de fechamento. A recuperação não agenda mudança de preço; só o
fluxo mensal normal avalia três competências consecutivas e aplica qualquer
alteração em ciclo futuro.
