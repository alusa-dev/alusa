"use client";

import * as React from "react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { IMaskInput } from "react-imask";
import { findCEP } from "@/lib/cep";
import { toast } from "@/components/ui/toast";
import { professorCreateSchema as ProfessorCreateSchema, type ProfessorCreateDTO } from "../../../../packages/lib/src/schemas/professor";

type Props = {
  open: boolean;
  onOpenChange: (_: boolean) => void;
  contaId: string;
  onSaved?: (_id: string) => void;
};

const ESPECIALIDADES = ["Ballet", "Jazz", "Hip-Hop", "Contemporâneo", "Sapateado", "Outros"] as const;

export default function ProfessorWizardDialog({ open, onOpenChange, contaId, onSaved }: Props) {
  const [step, setStep] = React.useState(1);
  const maxStep = 4;
  const methods = useForm<ProfessorCreateDTO>({
    resolver: zodResolver(ProfessorCreateSchema),
    defaultValues: {
      contaId,
      nome: "",
      cpf: "",
      dataNasc: undefined as unknown as Date,
      email: "",
      telefoneCel: "",
      especialidades: [],
      status: "ATIVO",
    },
    mode: "onChange",
  });

  React.useEffect(() => { if (!open) setStep(1); }, [open]);

  async function onSubmitAll(data: ProfessorCreateDTO) {
    try {
      const res = await fetch("/api/professores", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const json = await res.json();
      if (!res.ok) {
        const err = (json?.error?.message || json?.error || "Falha ao salvar") as string;
        toast.error(err);
        return;
      }
      toast.success("Professor cadastrado com sucesso");
      onSaved?.(json.data.id);
      onOpenChange(false);
    } catch {
      toast.error("Erro de comunicação");
    }
  }

  const pct = (step / maxStep) * 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Cadastro de Professor" className="max-w-3xl">
        <FormProvider {...methods}>
          <div className="space-y-4">
            <Progress value={pct} />

            {step === 1 && <StepPessoais />}
            {step === 2 && <StepContatoEndereco onCepFilled={async () => { /* noop */ }} />}
            {step === 3 && <StepProfissional />}
            {step === 4 && <StepResumo />}

            <div className="flex justify-between pt-2">
              <Button type="button" variant="outline" onClick={() => setStep(s => Math.max(1, s - 1))} disabled={step === 1}>Voltar</Button>
              {step < maxStep ? (
                <Button type="button" onClick={async () => {
                  const ok = await methods.trigger();
                  if (!ok) { toast.error("Corrija os campos para avançar"); return; }
                  setStep(s => Math.min(maxStep, s + 1));
                }}>Próximo</Button>
              ) : (
                <Button type="button" onClick={methods.handleSubmit(onSubmitAll)}>Concluir</Button>
              )}
            </div>
          </div>
        </FormProvider>
      </DialogContent>
    </Dialog>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) { return <label className="text-xs text-slate-600">{children}</label>; }

function StepPessoais() {
  const { register, formState: { errors } } = useFormContextSafe<ProfessorCreateDTO>();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-1">
        <FieldLabel>Nome</FieldLabel>
        <Input placeholder="Nome completo" {...register("nome")} />
        {errors.nome && <p className="text-xs text-red-600">{errors.nome.message}</p>}
      </div>
      <div className="space-y-1">
        <FieldLabel>CPF</FieldLabel>
  <IMaskInput mask="000.000.000-00" placeholder="000.000.000-00" className="w-full border border-gray-300 bg-white rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-all duration-200 hover:border-purple-300 hover:bg-purple-25 focus:outline-none focus:ring-0 focus:shadow-none focus:border-gray-300 focus:bg-white" {...register("cpf")} />
        {errors.cpf && <p className="text-xs text-red-600">{errors.cpf.message as string}</p>}
      </div>
      <div className="space-y-1">
        <FieldLabel>RG (opcional)</FieldLabel>
        <Input placeholder="RG" {...register("rg")} />
      </div>
      <div className="space-y-1">
        <FieldLabel>Data de Nascimento</FieldLabel>
        <Input type="date" {...register("dataNasc", { valueAsDate: true })} />
        {errors.dataNasc && <p className="text-xs text-red-600">{errors.dataNasc.message as string}</p>}
      </div>
      <div className="space-y-1">
        <FieldLabel>Sexo</FieldLabel>
        <Input placeholder="Masculino/Feminino/..." {...register("sexo")} />
      </div>
      <div className="space-y-1">
        <FieldLabel>Estado Civil</FieldLabel>
        <Input placeholder="Solteiro(a)/Casado(a)/..." {...register("estadoCivil")} />
      </div>
      <div className="space-y-1 md:col-span-2">
        <FieldLabel>Nacionalidade</FieldLabel>
        <Input placeholder="Brasileira, ..." {...register("nacionalidade")} />
      </div>
    </div>
  );
}

function StepContatoEndereco({ onCepFilled }: { onCepFilled?: () => Promise<void> | void }) {
  const { register, setValue, formState: { errors } } = useFormContextSafe<ProfessorCreateDTO>();
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-1">
        <FieldLabel>E-mail</FieldLabel>
        <Input type="email" placeholder="email@exemplo.com" {...register("email")} />
        {errors.email && <p className="text-xs text-red-600">{errors.email.message as string}</p>}
      </div>
      <div className="space-y-1">
        <FieldLabel>Telefone Celular</FieldLabel>
  <IMaskInput mask="(00) 00000-0000" placeholder="(00) 00000-0000" className="w-full border border-gray-300 bg-white rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-all duration-200 hover:border-purple-300 hover:bg-purple-25 focus:outline-none focus:ring-0 focus:shadow-none focus:border-gray-300 focus:bg-white" {...register("telefoneCel")} />
        {errors.telefoneCel && <p className="text-xs text-red-600">{errors.telefoneCel.message as string}</p>}
      </div>
      <div className="space-y-1">
        <FieldLabel>Telefone Fixo (opcional)</FieldLabel>
  <IMaskInput mask="(00) 0000-0000" placeholder="(00) 0000-0000" className="w-full border border-gray-300 bg-white rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-all duration-200 hover:border-purple-300 hover:bg-purple-25 focus:outline-none focus:ring-0 focus:shadow-none focus:border-gray-300 focus:bg-white" {...register("telefoneFixo")} />
      </div>
      <div className="space-y-1">
        <FieldLabel>CEP</FieldLabel>
  <IMaskInput mask="00000-000" placeholder="00000-000" className="w-full border border-gray-300 bg-white rounded px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 transition-all duration-200 hover:border-purple-300 hover:bg-purple-25 focus:outline-none focus:ring-0 focus:shadow-none focus:border-gray-300 focus:bg-white" {...register("cep")}
          onBlur={async (e: React.FocusEvent<HTMLInputElement>) => {
            const raw = e.currentTarget.value.replace(/\D/g, "");
            if (raw.length === 8) {
              try {
                const d = await findCEP(raw);
                setValue("logradouro", d.logradouro || "");
                setValue("bairro", d.bairro || "");
                setValue("cidade", d.cidade || "");
                setValue("uf", d.uf || "");
                await onCepFilled?.();
              } catch { /* silêncio */ }
            }
          }}
        />
      </div>
      <div className="space-y-1">
        <FieldLabel>Logradouro</FieldLabel>
        <Input placeholder="Rua ..." {...register("logradouro")} />
      </div>
      <div className="space-y-1">
        <FieldLabel>Número</FieldLabel>
        <Input placeholder="123" {...register("numero")} />
      </div>
      <div className="space-y-1">
        <FieldLabel>Complemento</FieldLabel>
        <Input placeholder="Apto, Bloco..." {...register("complemento")} />
      </div>
      <div className="space-y-1">
        <FieldLabel>Bairro</FieldLabel>
        <Input placeholder="Bairro" {...register("bairro")} />
      </div>
      <div className="space-y-1">
        <FieldLabel>Cidade</FieldLabel>
        <Input placeholder="Cidade" {...register("cidade")} />
      </div>
      <div className="space-y-1">
        <FieldLabel>UF</FieldLabel>
        <Input placeholder="UF" maxLength={2} {...register("uf")} />
      </div>
    </div>
  );
}

function StepProfissional() {
  const { register, watch, setValue } = useFormContextSafe<ProfessorCreateDTO>();
  const esp = watch("especialidades") || [];
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <div className="space-y-1">
        <FieldLabel>Formação</FieldLabel>
        <Input placeholder="Ex.: Licenciatura em Dança" {...register("formacao")} />
      </div>
      <div className="space-y-1">
        <FieldLabel>Status Contratual</FieldLabel>
  <Select onValueChange={(v) => setValue("statusContratual", v as "EFETIVO" | "TEMPORARIO" | "PRESTADOR" | "VOLUNTARIO") }>
          <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="EFETIVO">Efetivo</SelectItem>
            <SelectItem value="TEMPORARIO">Temporário</SelectItem>
            <SelectItem value="PRESTADOR">Prestador</SelectItem>
            <SelectItem value="VOLUNTARIO">Voluntário</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1 md:col-span-2">
        <FieldLabel>Especialidades</FieldLabel>
        <div className="flex flex-wrap gap-2">
          {ESPECIALIDADES.map(opt => (
            <button key={opt} type="button" onClick={() => {
              const current: string[] = Array.isArray(esp) ? esp : [];
              const optStr = String(opt);
              const has = current.includes(optStr);
              setValue("especialidades", has ? current.filter((e: string) => e !== optStr) : [...current, optStr]);
            }} className={`px-2 py-1 rounded border text-xs ${ (Array.isArray(esp) ? esp : []).includes(String(opt)) ? 'bg-violet-600 text-white border-violet-700' : 'bg-white text-slate-700 border-slate-300' }`}>
              {opt}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-1">
        <FieldLabel>Data de Admissão</FieldLabel>
        <Input type="date" {...register("dataAdmissao", { valueAsDate: true })} />
      </div>
      <div className="space-y-1">
        <FieldLabel>Carga Horária (h/sem)</FieldLabel>
        <Input type="number" min={1} step={1} {...register("cargaHoraria", { valueAsNumber: true })} />
      </div>
      <div className="space-y-1 md:col-span-2">
        <FieldLabel>Mini Bio</FieldLabel>
        <textarea rows={3} className="w-full border rounded px-3 py-2 text-sm" {...register("miniBio")} />
      </div>
      <div className="space-y-1 md:col-span-2">
        <FieldLabel>Foto (URL)</FieldLabel>
        <Input placeholder="https://..." {...register("foto")} />
      </div>
    </div>
  );
}

function StepResumo() {
  const { getValues, setValue } = useFormContextSafe<ProfessorCreateDTO>();
  const v = getValues();
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
        <div><strong>Nome:</strong> {v.nome}</div>
        <div><strong>CPF:</strong> {v.cpf}</div>
        <div><strong>Email:</strong> {v.email}</div>
        <div><strong>Celular:</strong> {v.telefoneCel}</div>
        <div><strong>Status:</strong> {v.status}</div>
        <div className="md:col-span-2"><strong>Especialidades:</strong> {(v.especialidades || []).join(", ") || '-'}</div>
      </div>
      <div>
        <FieldLabel>Status</FieldLabel>
        <div className="mt-1">
          <Select value={v.status} onValueChange={(s) => setValue("status", s as "ATIVO" | "INATIVO")}>
            <SelectTrigger className="w-[200px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="ATIVO">ATIVO</SelectItem>
              <SelectItem value="INATIVO">INATIVO</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}

import { useFormContext, type FieldValues } from "react-hook-form";
function useFormContextSafe<T extends FieldValues>() { return useFormContext<T>(); }
