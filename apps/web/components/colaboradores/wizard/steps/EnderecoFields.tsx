"use client";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { FieldError, FieldLabel, IMaskControlled } from "../ui";
import { useEffect, useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import type { ColaboradorInput } from "../../../../../../packages/lib/src/schemas/colaborador";

function toastError(msg: string) {
  try {
    // compat com ambientes onde toast.error não exista
    if (typeof toast.error === "function") return toast.error(msg);
    return toast.custom(() => (
      <div className="text-sm font-medium text-red-600">{msg}</div>
    ));
  } catch {
    /* noop */
  }
}

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

export default function EnderecoFields() {
  const { register, watch, setValue } = useFormContext<ColaboradorInput>();
  const baseInputClasses =
    "h-10 px-3 bg-white border border-gray-300 placeholder:text-gray-400 text-gray-900 shadow-none rounded-md";

  const cepVal = watch("enderecoCep");
  const [loading, setLoading] = useState(false);
  const lastCepRef = useRef<string>("");

  useEffect(() => {
    const raw = (cepVal || "").replace(/\D/g, "");
    if (raw.length === 8 && raw !== lastCepRef.current) {
      lastCepRef.current = raw;
      setLoading(true);
      lookupCep(raw)
        .then((r) => {
          if (r) {
            setValue("enderecoLogradouro", r.logradouro, { shouldDirty: true });
            setValue("enderecoBairro", r.bairro, { shouldDirty: true });
            setValue("enderecoCidade", r.cidade, { shouldDirty: true });
            setValue("enderecoUf", r.uf, { shouldDirty: true });
          } else {
            toastError("CEP não encontrado");
          }
        })
        .finally(() => setLoading(false));
    }
  }, [cepVal, setValue]);

  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      <div>
        <FieldLabel htmlFor="colab-cep">CEP</FieldLabel>
        <IMaskControlled
          id="colab-cep"
          name="enderecoCep"
          mask="00000-000"
          placeholder="00000-000"
          ariaLabel="CEP"
          inputClassName={baseInputClasses}
        />
        <FieldError name="enderecoCep" />
        {loading && (
          <div className="mt-1 text-[10px] text-violet-600 animate-pulse">
            Buscando CEP...
          </div>
        )}
      </div>
      <div className="md:col-span-2">
        <FieldLabel htmlFor="colab-logradouro">Logradouro</FieldLabel>
        <Input
          id="colab-logradouro"
          {...register("enderecoLogradouro")}
          className={baseInputClasses}
          placeholder="Rua/Av., travessa..."
          disabled={loading}
        />
        <FieldError name="enderecoLogradouro" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-numero">Número</FieldLabel>
        <Input id="colab-numero" {...register("enderecoNumero")} className={baseInputClasses} placeholder="Nº" />
        <FieldError name="enderecoNumero" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-complemento">Complemento</FieldLabel>
        <Input id="colab-complemento" {...register("enderecoComplemento")} className={baseInputClasses} placeholder="Apto, bloco..." />
        <FieldError name="enderecoComplemento" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-bairro">Bairro</FieldLabel>
        <Input id="colab-bairro" {...register("enderecoBairro")} className={baseInputClasses} placeholder="Ex.: Centro" />
        <FieldError name="enderecoBairro" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-cidade">Cidade</FieldLabel>
        <Input id="colab-cidade" {...register("enderecoCidade")} className={baseInputClasses} placeholder="Ex.: Recife" />
        <FieldError name="enderecoCidade" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-uf">UF</FieldLabel>
        <Input id="colab-uf" maxLength={2} {...register("enderecoUf")} placeholder="SP" className={baseInputClasses} />
        <FieldError name="enderecoUf" />
      </div>
    </div>
  );
}
