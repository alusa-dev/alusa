"use client";
import { useFormContext } from "react-hook-form";
import type { ColaboradorInput } from "@alusa/lib/schemas/colaborador";

export default function ConfirmationSection() {
  const { watch } = useFormContext<ColaboradorInput>();
  const all = watch();
  const toDate = (d: Date | string) => (d instanceof Date ? d : new Date(d));
  const fmtDate = (d?: Date | string | null) => (d ? toDate(d).toLocaleDateString() : "");
  const grupos: Array<{ titulo: string; itens: Array<[string, string | null | undefined]> }> = [
    {
      titulo: "Identificação",
      itens: [
        ["Nome", all.nome],
        ["Nome social", all.nomeSocial ?? null],
        ["CPF", all.cpf],
        ["Data de nascimento", fmtDate(all.dataNasc)],
  ["Gênero", all.genero ?? null],
      ],
    },
    {
      titulo: "Contato",
      itens: [
  ["Email", all.email ?? null],
  ["Telefone 1", all.telefone1 ?? null],
        ["Contato de emergência", all.contatoEmergenciaTelefone ?? null],
      ],
    },
    {
      titulo: "Endereço",
      itens: [
  ["CEP", all.enderecoCep ?? null],
  ["Endereço", all.enderecoLogradouro ?? null],
  ["Número", all.enderecoNumero ?? null],
  ["Bairro", all.enderecoBairro ?? null],
  ["Cidade", all.enderecoCidade ?? null],
  ["UF", all.enderecoUf ?? null],
      ],
    },
    {
      titulo: "Vínculo",
      itens: [
        ["Cargo/Função", all.cargo],
        ["Especialidade/Área", all.especialidade ?? null],
  ["Status", all.status],
        ["Admissão", fmtDate(all.dataAdmissao)],
        ["Desligamento", fmtDate(all.dataDesligamento)],
  ["Observações", all.observacoes ?? null],
  ["Salário (R$)", typeof (all as unknown) === 'object' && all && typeof (all as { salario?: number }).salario === 'number' ? new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format((all as { salario: number }).salario) : null],
      ],
    },
    {
      titulo: "Acesso",
      itens: [
        ["Conceder acesso", all.temAcesso ? "Sim" : "Não"],
  ["Perfil", all.roleUsuario ?? null],
      ],
    },
  ];
  return (
    <div className="space-y-6">
      <div className="grid gap-3 md:grid-cols-2">
        {grupos.map((g) => (
          <div key={g.titulo} className="rounded-xl bg-slate-50/70 p-4 alusa-dark:bg-[color:var(--color-bg-card-soft)]">
            <h5 className="mb-3 text-sm font-semibold text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]">
              {g.titulo}
            </h5>
            <dl className="text-xs alusa-dark:text-[color:var(--color-text-secondary)]">
              {g.itens.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 py-0.5">
                  <dt className="text-slate-500 alusa-dark:text-[color:var(--color-text-secondary)]">{k}</dt>
                  <dd
                    className="max-w-[260px] truncate font-medium text-slate-800 alusa-dark:text-[color:var(--color-text-primary)]"
                    title={String(v || '')}
                  >
                    {v || '-'}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-slate-500">Clique em <b>Concluir</b> para salvar o cadastro.</p>
    </div>
  );
}
