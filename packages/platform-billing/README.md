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
Fechamentos usam um histórico temporal append-only, sem PII, preenchido por
triggers nas alterações relevantes de aluno, matrícula, plano, combo e desconto.
A migration cria um baseline com timestamp verdadeiro; competências anteriores
à cobertura não recebem contagem fabricada. Esses gaps ficam auditados como
`IGNORED`, sem marcar o fechamento financeiro como resolvido. Falhas transitórias
permanecem abertas e recuperáveis. Triggers e fechamento usam lock transacional
por Conta: eventos recebem horário de mutação após o lock da linha, e o fechamento
espera transações de escrita em andamento. Se uma mesma transação tiver mudanças
de elegibilidade dos dois lados do instante de corte, o cálculo fica inconclusivo
para evitar uma projeção parcial. Snapshots reconstruídos ficam marcados e não
participam de mudança de faixa nem sincronização de quantidade; três fechamentos
mensais consecutivos capturados normalmente continuam necessários para uma
mudança comercial futura.
