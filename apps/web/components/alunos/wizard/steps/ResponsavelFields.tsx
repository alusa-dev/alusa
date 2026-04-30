"use client";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { FieldError, FieldLabel, IMaskControlled } from "../ui";
import { toast } from "@/components/ui/toast";
function toastError(msg: string) {
  try {
    if (typeof toast.error === 'function') return toast.error(msg);
    return toast.custom(() => <div className="text-sm font-medium text-red-600">{msg}</div>);
  } catch {/* noop */}
}
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlunoInput } from "../../../../../../prisma/zod/aluno";

async function lookupCep(rawCep: string) {
  const cep = rawCep.replace(/\D/g, "");
  if (cep.length !== 8) return null;
  try {
    const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
    if (!res.ok) return null;
    const data = await res.json();
    if (data.erro) return null;
    return {
      logradouro: data.logradouro || "",
      bairro: data.bairro || "",
      cidade: data.localidade || "",
      uf: data.uf || "",
    };
  } catch {
    return null;
  }
}

export default function ResponsavelFields() {
  const { register, watch, setValue } = useFormContext<AlunoInput>();
  const cepVal = watch("responsavel.enderecoCep");
  const [loading, setLoading] = useState(false);
  const lastCepRef = useRef<string>("");
  const runCepLookup = useCallback(
    async (rawCep: string) => {
      const cep = rawCep.replace(/\D/g, "");
      if (cep.length !== 8) {
        toastError("Informe um CEP válido com 8 dígitos");
        return;
      }
      if (cep === lastCepRef.current && loading) return;
      lastCepRef.current = cep;
      setLoading(true);
      try {
        const r = await lookupCep(cep);
        if (r) {
          setValue("responsavel.enderecoLogradouro", r.logradouro, { shouldDirty: true });
          setValue("responsavel.enderecoBairro", r.bairro, { shouldDirty: true });
          setValue("responsavel.enderecoCidade", r.cidade, { shouldDirty: true });
          setValue("responsavel.enderecoUf", r.uf, { shouldDirty: true });
        } else {
          toastError("CEP do responsável não encontrado");
        }
      } finally {
        setLoading(false);
      }
    },
    [loading, setValue],
  );
  useEffect(() => {
    const raw = (cepVal || "").replace(/\D/g, "");
    if (raw.length === 8 && raw !== lastCepRef.current) {
      runCepLookup(raw);
    }
  }, [cepVal, runCepLookup]);
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
      <div className="md:col-span-2">
        <FieldLabel htmlFor="resp-nome" required>Nome do responsável</FieldLabel>
  <Input id="resp-nome" {...register("responsavel.nome" as const)} placeholder="Ex.: João dos Santos" className="h-10 border-gray-300 bg-white shadow-none placeholder:text-gray-400" />
        <FieldError name="responsavel.nome" />
      </div>
      <div>
        <FieldLabel htmlFor="resp-cpf" required>CPF</FieldLabel>
        <IMaskControlled id="resp-cpf" data-testid="resp-cpf" name="responsavel.cpf" mask="000.000.000-00" placeholder="000.000.000-00" ariaLabel="CPF do responsável" unmask />
        <FieldError name="responsavel.cpf" />
      </div>
      <div>
        <FieldLabel htmlFor="resp-email" required>E-mail</FieldLabel>
  <Input id="resp-email" type="email" {...register("responsavel.email" as const)} placeholder="email@exemplo.com" className="h-10 border-gray-300 bg-white shadow-none placeholder:text-gray-400" />
        <FieldError name="responsavel.email" />
      </div>
      <div>
        <FieldLabel htmlFor="resp-telefone" required>Telefone</FieldLabel>
        <IMaskControlled
          id="resp-telefone"
          data-testid="resp-telefone"
          name="responsavel.telefone"
          mask={["(00) 0000-0000", "(00) 00000-0000"]}
          placeholder="(00) 00000-0000"
          ariaLabel="Telefone do responsável"
          unmask
        />
        <FieldError name="responsavel.telefone" />
      </div>
      <div>
        <FieldLabel htmlFor="resp-cep" required>CEP</FieldLabel>
        <IMaskControlled
          id="resp-cep"
          data-testid="resp-cep"
          name="responsavel.enderecoCep"
          mask="00000-000"
          placeholder="00000-000"
          ariaLabel="CEP do responsável"
          onBlur={(event) => runCepLookup(event.currentTarget.value)}
          unmask
        />
        <FieldError name="responsavel.enderecoCep" />
        <button
          type="button"
          className="mt-1 text-[11px] text-violet-600 hover:text-violet-700 disabled:opacity-60"
          onClick={() => runCepLookup(cepVal || "")}
          disabled={loading}
        >
          Buscar CEP automaticamente
        </button>
        {loading && <div className="mt-1 text-[10px] text-violet-600 animate-pulse">Buscando CEP...</div>}
      </div>
      <div className="md:col-span-2">
        <FieldLabel htmlFor="resp-logradouro">Endereço</FieldLabel>
  <Input id="resp-logradouro" {...register("responsavel.enderecoLogradouro" as const)} placeholder="Rua/Av." disabled={loading} className="h-10 border-gray-300 bg-white shadow-none placeholder:text-gray-400" />
      </div>
      <div>
        <FieldLabel htmlFor="resp-numero">Número</FieldLabel>
  <Input id="resp-numero" {...register("responsavel.enderecoNumero" as const)} placeholder="Nº" disabled={loading} className="h-10 border-gray-300 bg-white shadow-none placeholder:text-gray-400" />
      </div>
      <div>
        <FieldLabel htmlFor="resp-complemento">Complemento</FieldLabel>
  <Input id="resp-complemento" {...register("responsavel.enderecoComplemento" as const)} placeholder="Apto, bloco" disabled={loading} className="h-10 border-gray-300 bg-white shadow-none placeholder:text-gray-400" />
      </div>
      <div>
        <FieldLabel htmlFor="resp-bairro">Bairro</FieldLabel>
  <Input id="resp-bairro" {...register("responsavel.enderecoBairro" as const)} placeholder="Bairro" disabled={loading} className="h-10 border-gray-300 bg-white shadow-none placeholder:text-gray-400" />
      </div>
      <div>
        <FieldLabel htmlFor="resp-cidade">Cidade</FieldLabel>
  <Input id="resp-cidade" {...register("responsavel.enderecoCidade" as const)} placeholder="Cidade" disabled={loading} className="h-10 border-gray-300 bg-white shadow-none placeholder:text-gray-400" />
      </div>
      <div>
        <FieldLabel htmlFor="resp-uf">UF</FieldLabel>
  <Input id="resp-uf" maxLength={2} {...register("responsavel.enderecoUf" as const)} placeholder="UF" disabled={loading} className="h-10 border-gray-300 bg-white shadow-none placeholder:text-gray-400" />
      </div>
      <div className="flex items-start gap-2 rounded-md border border-slate-200 p-3 md:col-span-2">
        <input type="checkbox" id="responsavelFinanceiro" className="mt-0.5 h-4 w-4" {...register("responsavel.financeiro" as const)} />
        <label htmlFor="responsavelFinanceiro" className="text-xs text-slate-600 leading-snug cursor-pointer select-none">
          Este responsável será o pagador (financeiro)
        </label>
      </div>
      <div className="md:col-span-4 pt-1">
        <p className="text-[11px] text-slate-500">
          Dados completos do responsável são necessários para emissão de cobranças futuras (Asaas).
        </p>
      </div>
    </div>
  );
}
