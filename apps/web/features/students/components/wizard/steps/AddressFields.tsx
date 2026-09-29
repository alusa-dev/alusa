"use client";
import { FieldError, FieldLabel, IMaskControlled, WizardInput, wizardFieldInputClass, wizardTextareaFieldClass } from "../ui";
import { useFormContext } from "react-hook-form";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlunoInput } from "../../../../../../../prisma/zod/aluno";

// Mantém comportamento original (busca CEP aluno)
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

export default function AddressFields() {
  const { register, watch, setValue } = useFormContext<AlunoInput>();
  const cepVal = watch("enderecoCep");
  const [cepLookupStatus, setCepLookupStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const lastCepRef = useRef<string>("");
  const requestIdRef = useRef(0);
  const inFlightCepRef = useRef<string | null>(null);
  const runCepLookup = useCallback(
    async (rawCep: string) => {
      const cep = rawCep.replace(/\D/g, "");
      if (cep.length !== 8 || inFlightCepRef.current === cep) return;
      if (cep === lastCepRef.current && cepLookupStatus === 'success') return;

      const requestId = ++requestIdRef.current;
      lastCepRef.current = cep;
      inFlightCepRef.current = cep;
      setCepLookupStatus('loading');
      try {
        const r = await lookupCep(cep);
        if (requestId !== requestIdRef.current) return;
        if (r) {
          setValue("enderecoLogradouro", r.logradouro, { shouldDirty: true });
          setValue("enderecoBairro", r.bairro, { shouldDirty: true });
          setValue("enderecoCidade", r.cidade, { shouldDirty: true });
          setValue("enderecoUf", r.uf, { shouldDirty: true });
          setCepLookupStatus('success');
        } else {
          setCepLookupStatus('error');
        }
      } finally {
        if (requestId === requestIdRef.current) inFlightCepRef.current = null;
      }
    },
    [cepLookupStatus, setValue],
  );
  useEffect(() => {
    const raw = (cepVal || "").replace(/\D/g, "");
    if (raw.length !== 8) {
      requestIdRef.current += 1;
      inFlightCepRef.current = null;
      lastCepRef.current = "";
      setCepLookupStatus('idle');
      return;
    }
    if (raw.length === 8 && raw !== lastCepRef.current) {
      runCepLookup(raw);
    }
  }, [cepVal, runCepLookup]);
  return (
    <div className="grid gap-4 sm:grid-cols-3 md:grid-cols-6">
      <div>
        <FieldLabel htmlFor="aluno-endereco-cep" required>CEP</FieldLabel>
        <div className="relative">
          <IMaskControlled
            id="aluno-endereco-cep"
            data-testid="aluno-endereco-cep"
            name="enderecoCep"
            mask="00000-000"
            placeholder="00000-000"
            ariaLabel="CEP"
            requiredIndicator
            inputClassName={cepLookupStatus !== 'idle' ? 'wizard-field-input--cep-status' : undefined}
            onBlur={(event) => runCepLookup(event.currentTarget.value)}
            unmask
          />
          {cepLookupStatus !== 'idle' && (
            <span
              className={`pointer-events-none absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center ${cepLookupStatus === 'success' ? 'text-emerald-600' : cepLookupStatus === 'error' ? 'text-red-600' : 'text-slate-500'}`}
              aria-hidden="true"
            >
              {cepLookupStatus === 'loading' && <LoaderCircle className="h-4 w-4 animate-spin" />}
              {cepLookupStatus === 'success' && <Check className="h-4 w-4" />}
              {cepLookupStatus === 'error' && <CircleAlert className="h-4 w-4" />}
            </span>
          )}
          <span className="sr-only" role="status" aria-live="polite">
            {cepLookupStatus === 'loading' && 'Buscando endereço pelo CEP.'}
            {cepLookupStatus === 'success' && 'Endereço encontrado pelo CEP.'}
            {cepLookupStatus === 'error' && 'Não foi possível encontrar o CEP.'}
          </span>
        </div>
        <FieldError name="enderecoCep" />
      </div>
      <div className="md:col-span-3">
        <FieldLabel htmlFor="aluno-endereco-logradouro">Endereço</FieldLabel>
  <WizardInput id="aluno-endereco-logradouro" data-testid="aluno-endereco-logradouro" {...register("enderecoLogradouro")} placeholder="Rua/Av., travessa..." disabled={cepLookupStatus === 'loading'} className={wizardFieldInputClass} />
      </div>
      <div>
        <FieldLabel htmlFor="aluno-endereco-numero">Número</FieldLabel>
  <WizardInput id="aluno-endereco-numero" data-testid="aluno-endereco-numero" {...register("enderecoNumero")} placeholder="Nº" className={wizardFieldInputClass} />
      </div>
      <div>
        <FieldLabel htmlFor="aluno-endereco-complemento">Complemento</FieldLabel>
  <WizardInput id="aluno-endereco-complemento" {...register("enderecoComplemento")} placeholder="Apto, bloco..." className={wizardFieldInputClass} />
      </div>
      <div>
        <FieldLabel htmlFor="aluno-endereco-bairro">Bairro</FieldLabel>
  <WizardInput id="aluno-endereco-bairro" data-testid="aluno-endereco-bairro" {...register("enderecoBairro")} placeholder="Ex.: Centro" className={wizardFieldInputClass} />
      </div>
      <div className="md:col-span-3">
        <FieldLabel htmlFor="aluno-endereco-cidade">Cidade</FieldLabel>
  <WizardInput id="aluno-endereco-cidade" data-testid="aluno-endereco-cidade" {...register("enderecoCidade")} placeholder="Ex.: Recife" className={wizardFieldInputClass} />
      </div>
      <div>
        <FieldLabel htmlFor="aluno-endereco-uf">UF</FieldLabel>
  <WizardInput id="aluno-endereco-uf" data-testid="aluno-endereco-uf" maxLength={2} {...register("enderecoUf")} placeholder="PE" className={wizardFieldInputClass} />
        <FieldError name="enderecoUf" />
      </div>
      <div className="md:col-span-6">
        <FieldLabel htmlFor="aluno-observacao">Observação (geral)</FieldLabel>
        <textarea
          id="aluno-observacao"
          {...register("observacao")}
          rows={3}
          className={wizardTextareaFieldClass}
          placeholder="Notas gerais sobre o aluno (opcional)"
        />
      </div>
    </div>
  );
}
