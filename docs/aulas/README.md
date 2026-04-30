# Módulo Aulas

Esta pasta consolida a documentação operacional e técnica do módulo Aulas já implementado na Alusa.

## Escopo

O módulo cobre o fluxo:

- matrícula → turma → agenda → frequência → reposição

O objetivo é operar o calendário acadêmico real da escola sem duplicar regra entre cadastro, agenda e execução diária.

## Submódulos

- Agenda: calendário operacional centralizado por ocorrência
- Frequência: lançamento e histórico de chamada por turma e por evento
- Reposições: compensação individual ou coletiva vinculada a origem e destino

## Invariantes do módulo

- Turma continua sendo cadastro-base; Aulas consome turma, professor e sala
- Agenda é a fonte operacional das ocorrências
- Frequência sempre pertence a um evento real da agenda
- Reposição sempre precisa ser rastreável entre origem e destino
- Professor só enxerga o próprio escopo quando houver vínculo ativo resolvido
- A UI não deve oferecer ações que o backend rejeita pela política operacional

## Índice

- arquitetura.md
- agenda.md
- frequencia.md
- reposicoes.md
- testes-e-validacao.md

## Referência histórica

Existe um documento macro anterior em docs/feature-aulas.md. Esta pasta complementa esse material com o contrato atual da implementação.
