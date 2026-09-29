"use client";
import * as React from "react";
import { type UseFormReturn } from "react-hook-form";
import { toast } from "@/components/ui/toast";

type StepId =
  | "identificacao"
  | "endereco"
  | "saude"
  | "perfil"
  | "foto"
  | "responsavel"
  | "confirmar";

export function useAlunoWizardSteps(isMinor: boolean) {
  return React.useMemo(
    () =>
      [
        { id: "identificacao" as const, label: "IDENTIFICAÇÃO" },
        { id: "endereco" as const, label: "ENDEREÇO" },
        { id: "saude" as const, label: "SAÚDE & EMERGÊNCIA" },
        { id: "perfil" as const, label: "PERFIL" },
        { id: "foto" as const, label: "FOTO" },
        ...(isMinor ? [{ id: "responsavel" as const, label: "RESPONSÁVEL" }] : []),
        { id: "confirmar" as const, label: "CONFIRMAR" },
      ] satisfies { id: StepId; label: string }[],
    [isMinor]
  );
}

export function useWizardDraft<T extends Record<string, unknown>>(
  methods: UseFormReturn<T>,
  fotoPreview: string | null
) {
  React.useEffect(() => {
    type W = Window & { __alunoDraftTimer?: number };
    const sub = methods.watch(() => {
      const w = window as W;
      if (w.__alunoDraftTimer) clearTimeout(w.__alunoDraftTimer);
      w.__alunoDraftTimer = window.setTimeout(() => {
        try {
          const values = methods.getValues();
          const draft: Record<string, unknown> = { ...values };
            if (fotoPreview) draft.__fotoDataUrl = fotoPreview;
          localStorage.setItem("alunoWizardDraft", JSON.stringify(draft));
        } catch {
          /* noop */
        }
      }, 300);
    });
    return () => sub.unsubscribe();
  }, [methods, fotoPreview]);
}

// Hook para auto-preenchimento de CEP genérico
export function useCepAutoFill(
  cepValue: string | undefined,
  setValues: (_v: { logradouro?: string; bairro?: string; cidade?: string; uf?: string }) => void,
  opts?: { onNotFound?: () => void }
) {
  const lastRef = React.useRef("");
  const [loading, setLoading] = React.useState(false);

  React.useEffect(() => {
    const raw = (cepValue || "").replace(/\D/g, "");
    if (raw.length === 8 && raw !== lastRef.current) {
      lastRef.current = raw;
      setLoading(true);
      fetch(`https://viacep.com.br/ws/${raw}/json/`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data || data.erro) {
            opts?.onNotFound?.();
            return;
          }
          setValues({
            logradouro: data.logradouro || "",
            bairro: data.bairro || "",
            cidade: data.localidade || "",
            uf: data.uf || "",
          });
        })
        .catch(() => {
          opts?.onNotFound?.();
        })
        .finally(() => setLoading(false));
    }
  }, [cepValue, opts, setValues]);

  return loading;
}

// Pequeno helper para mostrar toast de CEP não encontrado
export function toastCepNaoEncontrado(alvo: string) {
  toast.error(`CEP ${alvo} não encontrado`);
}
