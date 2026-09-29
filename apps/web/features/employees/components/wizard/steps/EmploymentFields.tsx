"use client";
import { Controller, useFormContext } from "react-hook-form";
import { Select, SelectContent, SelectItem, SelectValue } from "@/components/ui/select";
import { FieldError, FieldLabel, DateMaskControlled, MoneyMaskControlled, WizardInput, WizardSelectTrigger, useWizardFieldClass } from "../ui";
import { Calendar } from "@/components/icons/icons";
import type { ColaboradorInput } from "@alusa/lib/schemas/colaborador";

export default function EmploymentFields() {
  const { control, register, clearErrors } = useFormContext<ColaboradorInput>();
  const baseInputClasses = "rounded-md";
  const observacoesState = useWizardFieldClass("observacoes");
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      <div>
        <FieldLabel htmlFor="colab-cargo" required>Cargo</FieldLabel>
        <Controller
          control={control}
          name="cargo"
          defaultValue={"RECEPCAO" as any}
          render={({ field }) => (
            <Select value={field.value ?? "RECEPCAO"} onValueChange={(value) => { field.onChange(value); clearErrors("cargo"); }}>
              <WizardSelectTrigger name="cargo" id="colab-cargo" requiredIndicator className={baseInputClasses}><SelectValue placeholder="Selecione" /></WizardSelectTrigger>
              <SelectContent className="colaborador-wizard-corner-smoothing">
                <SelectItem value="PROFESSOR">Professor</SelectItem>
                <SelectItem value="RECEPCAO">Recepção</SelectItem>
                <SelectItem value="FINANCEIRO">Financeiro</SelectItem>
                <SelectItem value="ADMINISTRATIVO">Administrativo</SelectItem>
                <SelectItem value="OUTRO">Outro</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <FieldError name="cargo" />
      </div>
      <div className="md:col-span-2">
        <FieldLabel htmlFor="colab-especialidade">Especialidade/Área</FieldLabel>
        <WizardInput id="colab-especialidade" {...register("especialidade")} className={baseInputClasses} placeholder="Ex.: Ballet, Jazz, Recepção" />
        <FieldError name="especialidade" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-status">Status</FieldLabel>
        <Controller
          control={control}
          name="status"
          defaultValue={"ATIVO" as any}
          render={({ field }) => (
            <Select value={field.value ?? "ATIVO"} onValueChange={(value) => { field.onChange(value); clearErrors("status"); }}>
              <WizardSelectTrigger name="status" id="colab-status" className={baseInputClasses}><SelectValue placeholder="Status" /></WizardSelectTrigger>
              <SelectContent className="colaborador-wizard-corner-smoothing">
                <SelectItem value="ATIVO">Ativo</SelectItem>
                <SelectItem value="INATIVO">Inativo</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <FieldError name="status" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-admissao">Data de admissão</FieldLabel>
        <DateMaskControlled
          id="colab-admissao"
          name="dataAdmissao"
          ariaLabel="Data de admissão"
          rightIcon={<Calendar className="h-4 w-4 text-gray-600" aria-hidden="true" />}
          inputClassName={baseInputClasses}
        />
        <FieldError name="dataAdmissao" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-salario">Salário (R$)</FieldLabel>
        <MoneyMaskControlled name="salario" id="colab-salario" ariaLabel="Salário" inputClassName={baseInputClasses} />
        <FieldError name="salario" />
      </div>
      {/* Campo de desligamento removido por solicitação */}
      <div className="col-span-full">
        <FieldLabel htmlFor="colab-observacoes">Observações</FieldLabel>
        <textarea
          id="colab-observacoes"
          {...register("observacoes")}
          rows={3}
          onChange={() => clearErrors("observacoes")}
          aria-invalid={observacoesState.invalid || undefined}
          className={`wizard-field-input min-h-24 w-full rounded-md border border-transparent bg-slate-100 px-3 py-2 text-[13px] leading-5 text-slate-900 shadow-none placeholder:text-slate-400 focus:border-[#9ca3af] focus:bg-transparent focus:outline-none focus-visible:outline-none focus-visible:ring-0 alusa-dark:bg-[color:var(--color-bg-elevated)] alusa-dark:text-[color:var(--color-input-text)] ${observacoesState.className ?? ""}`}
          placeholder="Notas gerais sobre o colaborador (opcional)"
        />
        <FieldError name="observacoes" />
      </div>
    </div>
  );
}
