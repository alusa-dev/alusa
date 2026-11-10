# Classificação acadêmica por matrícula e curso

A classificação é um snapshot em `MatriculaVinculoAcademico`, único por tenant,
matrícula e modalidade (curso). `MatriculaTurma` registra as participações em
turmas; turmas da mesma modalidade compartilham o vínculo acadêmico. O cálculo
é independente para cada curso do aluno.

## Inferência de períodos

A escola não configura ciclos nem cobertura histórica manualmente. O motor usa
os dados acadêmicos já existentes e só classifica continuidade quando consegue
provar a sequência dos períodos:

- Ciclos acadêmicos persistidos continuam válidos como evidência legada e são
  consultados para classificação, mas não são criados ou editados pela interface.
- Rótulos de período reconhecidos seguem os formatos anuais `YYYY` e semestrais
  `YYYY.1` / `YYYY.2` (com separadores equivalentes aceitos pelo normalizador).
- Para vínculos originados por rematrícula, `RematriculaItem.targetPeriodId`
  pode identificar o período de origem quando o rótulo é reconhecido.
- Na ausência dessas fontes, datas de início e fim só são usadas quando a faixa
  permite inferir uma duração anual ou semestral inequívoca.
- A campanha organiza o processo, mas não comprova período nem continuidade.
  Entrada tardia continua sendo rematrícula quando a sequência imediata está
  comprovada; diferença de datas ou campanha, sozinha, não basta.

Períodos personalizados, cadências mistas, rótulos desconhecidos, lacunas sem
sequência confiável e histórico legado contraditório resultam em
`HISTORICO_INDETERMINADO`. A ausência de dados não prova ausência de matrícula.
Sem vínculo efetivo anterior no curso e sem registro legado conflitante, a
classificação é `PRIMEIRO_INGRESSO`. Continuidade comprovada no período
imediatamente seguinte é `REMATRICULA`; vínculo efetivo anterior com ruptura
formal ou lacuna comprovada é `RETORNO`. Transferência formal mantém a
classificação `TRANSFERENCIA` e a relação auditável entre origem e destino.

A vigência só conta depois da ativação efetiva. Matrícula futura ainda não
ativada e matrícula cancelada antes da vigência não comprovam que o aluno
estudou. Reativação de pausa é uma operação sobre o mesmo vínculo, não uma nova
classificação. Histórico e vínculo financeiro anteriores são preservados.

## Compatibilidade e operações

Os registros antigos de ciclos e cobertura histórica permanecem no banco, sem
backfill destrutivo. Ciclos existentes servem como evidência compatível para o
motor; registros de cobertura antigos podem apoiar a interpretação do histórico
que já documentaram. A aplicação não oferece configuração ou escrita manual de
ciclos, cobertura ou ciclo da turma. A remoção desses controles não apaga
associações legadas.

Classificações e correções administrativas continuam auditáveis. A relação de
transferência é criada/formalizada por operação explícita no fluxo acadêmico,
com origem, destino, motivo e autoria; referência simples a outra matrícula não
é suficiente. Correções de histórico insuficiente registram valores anteriores
e novos, motivo, autor e data. Dados ambíguos permanecem indeterminados até
validação autorizada.

O preview e o commit de rematrícula aplicam a mesma inferência a cada curso
selecionado, inclusive em combos multi-curso. Só permitem continuidade quando
origem e destino provam períodos imediatamente adjacentes; evidência
insuficiente retorna bloqueio de reconciliação, sem transformar o caso em
primeiro ingresso ou retorno por suposição. Cancelamento formal orienta uma
nova matrícula classificada como retorno conforme o histórico.

## Limites conhecidos

Datas de matrícula sem ciclo/rótulo salvo só permitem inferência quando a
duração corresponde claramente a um período anual ou semestral suportado. A
inferência não reconstrói períodos personalizados nem inventa ciclos
intermediários. Nesses casos, é necessária validação administrativa do
histórico; nenhuma campanha ou data isolada substitui essa evidência.
