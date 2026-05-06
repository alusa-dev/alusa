"use client";
import * as Popover from "@radix-ui/react-popover";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FieldError, FieldLabel, IMaskControlled } from "../ui";
import { toast } from "@/components/ui/toast";
import { listResponsaveis, type ResponsavelListItem } from "@/features/cadastro/responsaveis/services/responsaveis-service";
import { Search as SearchIcon } from "@/components/icons/icons";
import { cn } from "@/lib/utils";
function toastError(msg: string) {
  try {
    if (typeof toast.error === 'function') return toast.error(msg);
    return toast.custom(() => <div className="text-sm font-medium text-red-600">{msg}</div>);
  } catch {/* noop */}
}
import { useCallback, useEffect, useRef, useState } from "react";
import type { AlunoInput } from "../../../../../../prisma/zod/aluno";

type ResponsavelTabMode = "existente" | "novo";

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
  const {
    register,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = useFormContext<AlunoInput>();
  const cepVal = watch("responsavel.enderecoCep");
  const responsavelModo = (watch("responsavelModo") || "existente") as ResponsavelTabMode;
  const responsavelExistenteId = watch("responsavelExistenteId");
  const responsavel = watch("responsavel");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [loadingResponsaveis, setLoadingResponsaveis] = useState(false);
  const [responsaveis, setResponsaveis] = useState<ResponsavelListItem[]>([]);
  const [responsaveisError, setResponsaveisError] = useState<string | null>(null);
  const lastCepRef = useRef<string>("");
  const listAbortRef = useRef<AbortController | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
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

  useEffect(() => {
    if (responsavelModo !== "existente" || responsavelExistenteId) {
      listAbortRef.current?.abort();
      setLoadingResponsaveis(false);
      setOpen(false);
      setResponsaveis([]);
      return;
    }

    if (!query.trim()) {
      listAbortRef.current?.abort();
      setLoadingResponsaveis(false);
      setResponsaveis([]);
      setResponsaveisError(null);
      setOpen(false);
      return;
    }

    listAbortRef.current?.abort();
    const controller = new AbortController();
    listAbortRef.current = controller;

    const timer = window.setTimeout(async () => {
      setLoadingResponsaveis(true);
      setResponsaveisError(null);
      try {
        const items = await listResponsaveis({ signal: controller.signal, query });
        setResponsaveis(items);
        setOpen(true);
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") {
          return;
        }
        setResponsaveis([]);
        setResponsaveisError((error as Error).message || "Erro ao carregar responsáveis");
      } finally {
        setLoadingResponsaveis(false);
      }
    }, 180);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, responsavelModo, responsavelExistenteId]);

  const handleModoChange = useCallback(
    (value: string) => {
      const nextMode = value === "novo" ? "novo" : "existente";
      const selectedId = getValues("responsavelExistenteId");

      setValue("responsavelModo", nextMode, { shouldDirty: true, shouldValidate: true });

      if (nextMode === "novo" && selectedId) {
        setValue("responsavelExistenteId", null, { shouldDirty: true, shouldValidate: true });
        setValue("responsavel", null, { shouldDirty: true, shouldValidate: true });
        setQuery("");
      }
    },
    [getValues, setValue],
  );

  const handleSelectResponsavel = useCallback(
    (item: ResponsavelListItem) => {
      setValue("responsavelModo", "existente", { shouldDirty: true, shouldValidate: true });
      setValue("responsavelExistenteId", item.id, { shouldDirty: true, shouldValidate: true });
      setValue(
        "responsavel",
        {
          nome: item.nome,
          cpf: item.cpf,
          email: item.email,
          telefone: item.telefone,
          financeiro: item.financeiro,
        },
        { shouldDirty: true, shouldValidate: true },
      );
      setQuery(item.nome);
      setOpen(false);
    },
    [setValue],
  );

  const clearResponsavelSelecionado = useCallback(() => {
    setValue("responsavelExistenteId", null, { shouldDirty: true, shouldValidate: true });
    setValue("responsavel", null, { shouldDirty: true, shouldValidate: true });
    setQuery("");
    setOpen(false);
  }, [setValue]);

  const responsavelSelectionError =
    typeof errors.responsavelExistenteId?.message === "string"
      ? errors.responsavelExistenteId.message
      : errors.responsavel && typeof errors.responsavel === "object" && "message" in errors.responsavel
        ? String(errors.responsavel.message)
        : null;

  const selectedResponsavel =
    responsavelModo === "existente" && responsavelExistenteId
      ? {
          id: responsavelExistenteId,
          nome: responsavel?.nome || "Responsável selecionado",
          cpf: responsavel?.cpf || "",
          email: responsavel?.email || "",
          telefone: responsavel?.telefone || "",
        }
      : null;

  const showDropdown =
    responsavelModo === "existente" &&
    !selectedResponsavel &&
    open &&
    query.trim().length > 0;

  return (
    <div className="space-y-4">
      <Tabs value={responsavelModo} onValueChange={handleModoChange}>
        <TabsList className="h-10 rounded-xl bg-slate-100/80 p-1">
          <TabsTrigger value="existente" className="h-8 rounded-lg px-4 py-0 text-sm shadow-none">
            Escolher responsável
          </TabsTrigger>
          <TabsTrigger value="novo" className="h-8 rounded-lg px-4 py-0 text-sm shadow-none">
            Criar responsável
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {responsavelModo === "existente" ? (
        <div className="space-y-4">
          <p className="text-xs text-slate-500">
            Reutilize um responsável já cadastrado para evitar duplicidade e vincular este aluno ao cadastro correto.
          </p>

          {selectedResponsavel ? (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1 text-sm text-slate-700">
                  <div className="font-semibold text-slate-900">{selectedResponsavel.nome}</div>
                  <div>CPF: {selectedResponsavel.cpf || "-"}</div>
                  <div>E-mail: {selectedResponsavel.email || "-"}</div>
                  <div>Telefone: {selectedResponsavel.telefone || "-"}</div>
                </div>
                <button
                  type="button"
                  className="text-xs font-medium text-violet-600 hover:text-violet-700"
                  onClick={clearResponsavelSelecionado}
                >
                  Trocar responsável
                </button>
              </div>
            </div>
          ) : (
            <>
              <div>
                <FieldLabel htmlFor="resp-existente-search" required>Buscar responsável</FieldLabel>
                <Popover.Root open={showDropdown} onOpenChange={setOpen}>
                  <Popover.Anchor asChild>
                    <div className="relative">
                      <SearchIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-gray-400" />
                      <input
                        ref={inputRef}
                        id="resp-existente-search"
                        type="text"
                        value={query}
                        onChange={(event) => {
                          const value = event.currentTarget.value;
                          setQuery(value);
                          if (!value.trim()) {
                            setOpen(false);
                            return;
                          }
                          if (!open) setOpen(true);
                        }}
                        onFocus={() => {
                          if (query.trim()) setOpen(true);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Escape") setOpen(false);
                        }}
                        placeholder="Digite nome, CPF ou e-mail"
                        className="flex h-10 w-full rounded-lg border border-gray-300 bg-white py-2 pl-10 pr-3 text-sm text-gray-900 placeholder:text-gray-400 focus:border-[#5c2f91] focus:outline-none focus:ring-2 focus:ring-[#5c2f91]/30 disabled:cursor-not-allowed disabled:opacity-50"
                        aria-autocomplete="list"
                        aria-expanded={showDropdown}
                        aria-controls="responsavel-existente-suggestions"
                      />
                    </div>
                  </Popover.Anchor>
                  <Popover.Portal>
                    <Popover.Content
                      className="z-[99999] w-[var(--radix-popover-trigger-width)] overflow-hidden rounded-lg border border-gray-200 bg-white shadow-lg"
                      sideOffset={4}
                      align="start"
                      onOpenAutoFocus={(event) => event.preventDefault()}
                      onInteractOutside={(event) => {
                        if (event.target === inputRef.current) return;
                        setOpen(false);
                      }}
                    >
                      <div
                        id="responsavel-existente-suggestions"
                        className="max-h-[calc(4*52px+8px)] overflow-y-auto"
                        style={{
                          scrollbarWidth: "thin",
                          scrollbarColor: "#d1d5db transparent",
                        }}
                      >
                        {loadingResponsaveis && (
                          <div className="select-none px-4 py-3 text-sm text-gray-500">
                            Carregando...
                          </div>
                        )}

                        {!loadingResponsaveis && responsaveisError && (
                          <div className="select-none px-4 py-3 text-sm text-red-600">
                            {responsaveisError}
                          </div>
                        )}

                        {!loadingResponsaveis && !responsaveisError && responsaveis.length === 0 && (
                          <div className="select-none px-4 py-3 text-sm text-gray-500">
                            Nenhum responsável encontrado
                          </div>
                        )}

                        {!loadingResponsaveis && !responsaveisError && responsaveis.slice(0, 10).map((item, index) => (
                          <button
                            key={item.id}
                            type="button"
                            className={cn(
                              "w-full cursor-pointer bg-white px-3 py-2.5 text-left text-sm text-gray-900 transition-colors",
                              "hover:bg-gray-50 focus:bg-gray-100 focus:outline-none",
                              index < Math.min(responsaveis.length, 10) - 1 && "border-b border-gray-100",
                            )}
                            onClick={() => handleSelectResponsavel(item)}
                          >
                            <span className="block font-medium text-gray-900">{item.nome}</span>
                            <span className="block text-xs text-gray-500">
                              {[item.cpf, item.email, item.telefone].filter(Boolean).join(" • ") || "Sem dados adicionais"}
                            </span>
                          </button>
                        ))}
                      </div>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              </div>

              {responsavelSelectionError && (
                <p className="text-xs text-red-600">{responsavelSelectionError}</p>
              )}

              {!query.trim() && (
                <p className="text-xs text-slate-500">
                  Digite para buscar um responsável já cadastrado. Se ele não existir, use a aba criar responsável.
                </p>
              )}
            </>
          )}

          <div className="pt-1">
            <p className="text-[11px] text-slate-500">
              Ao concluir, o aluno será vinculado ao responsável selecionado sem criar um novo cadastro.
            </p>
          </div>
        </div>
      ) : (
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
      )}
    </div>
  );
}
