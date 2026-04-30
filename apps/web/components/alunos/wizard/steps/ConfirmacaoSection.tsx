"use client";
import type { AlunoInput } from "../../../../../../prisma/zod/aluno";

interface Props {
  all: AlunoInput & {
    codigoInterno?: string | null;
    modalidadePrincipal?: string | null;
    nivel?: string | null;
    origemCadastro?: string | null;
    tamanhoCamiseta?: string | null;
    tamanhoCalcado?: string | null;
    tags?: string[];
    consentimentoImagem?: boolean;
    consentimentoComunicacoes?: boolean;
  };
  fotoPreview: string | null;
}

export default function ConfirmacaoSection({ all, fotoPreview }: Props) {
  const tagsJoined = Array.isArray(all.tags) ? all.tags.join(', ') : '';
  const fmtDate = all.dataNasc ? new Date(all.dataNasc as unknown as Date).toLocaleDateString() : '';
  const grupos: Array<{titulo: string; itens: Array<[string, string | null | undefined]>}> = [
    {
      titulo: 'Identificação',
      itens: [
        ['Nome', all.nome],
        ['Nome social', all.nomeSocial],
        ['Data de nascimento', fmtDate],
        ['CPF', all.cpf],
      ],
    },
    {
      titulo: 'Contato',
      itens: [
        ['Email', all.email],
        ['Telefone', all.telefone],
      ],
    },
    {
      titulo: 'Endereço',
      itens: [
        ['CEP', all.enderecoCep],
        ['Endereço', all.enderecoLogradouro],
        ['Número', all.enderecoNumero],
        ['Bairro', all.enderecoBairro],
        ['Cidade', all.enderecoCidade],
        ['UF', all.enderecoUf],
      ],
    },
    {
      titulo: 'Perfil',
      itens: [
        ['Modalidade principal', all.modalidadePrincipal],
        ['Nível', all.nivel],
        ['Origem cadastro', all.origemCadastro],
        ['Tam. Camiseta', all.tamanhoCamiseta],
        ['Tam. Calçado', all.tamanhoCalcado],
        ['Tags', tagsJoined],
        ['Consent. Imagem', all.consentimentoImagem ? 'Sim' : 'Não'],
        ['Consent. Comunicações', all.consentimentoComunicacoes ? 'Sim' : 'Não'],
      ],
    },
  ];
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-16 w-16 overflow-hidden rounded-full border bg-slate-100">
          {fotoPreview ? (
            <img src={fotoPreview} alt="Foto do aluno" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px] text-slate-500">Sem foto</div>
          )}
        </div>
        <div>
          <h4 className="text-sm font-semibold text-slate-800">{all.nome || "-"}</h4>
          <p className="text-xs text-slate-500">Revise as informações antes de concluir.</p>
        </div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {grupos.map((g) => (
          <div key={g.titulo} className="rounded-md border border-slate-200 p-3">
            <h5 className="mb-2 text-xs font-semibold text-slate-700">{g.titulo}</h5>
            <dl className="text-xs">
              {g.itens.map(([k,v]) => (
                <div key={k} className="flex justify-between gap-3 py-0.5">
                  <dt className="text-slate-500">{k}</dt>
                  <dd className="max-w-[260px] truncate font-medium text-slate-800" title={String(v || "")}>{v || '-'}</dd>
                </div>
              ))}
            </dl>
          </div>
        ))}
      </div>
      {all.responsavel && (
        <div className="rounded-md border border-slate-200 p-3">
          <h5 className="mb-2 text-xs font-semibold text-slate-700">Responsável</h5>
          <div className="grid gap-2 md:grid-cols-2 text-xs">
            <span><b>Nome:</b> {all.responsavel?.nome || "-"}</span>
            <span><b>CPF:</b> {all.responsavel?.cpf || "-"}</span>
            <span><b>E-mail:</b> {all.responsavel?.email || "-"}</span>
            <span><b>Telefone:</b> {all.responsavel?.telefone || "-"}</span>
          </div>
        </div>
      )}
      <p className="text-[11px] text-slate-500">Clique em <b>Concluir</b> para salvar o cadastro.</p>
    </div>
  );
}
