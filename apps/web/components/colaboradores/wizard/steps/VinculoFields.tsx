"use client";
import { Controller, useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldError, FieldLabel, DateMaskControlled, MoneyMaskControlled } from "../ui";
import { Calendar } from "@/components/icons/icons";
import type { ColaboradorInput } from "../../../../../../packages/lib/src/schemas/colaborador";

export default function VinculoFields() {
  const { control, register } = useFormContext<ColaboradorInput>();
  const baseInputClasses = "h-10 px-3 bg-white border border-gray-300 placeholder:text-gray-400 text-gray-900 shadow-none rounded-md";
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      <div>
        <FieldLabel htmlFor="colab-cargo" required>Cargo</FieldLabel>
        <Controller
          control={control}
          name="cargo"
          defaultValue={"RECEPCAO" as any}
          render={({ field }) => (
            <Select value={field.value ?? "RECEPCAO"} onValueChange={field.onChange}>
              <SelectTrigger id="colab-cargo" className={baseInputClasses}><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
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
        <Input id="colab-especialidade" {...register("especialidade")} className={baseInputClasses} placeholder="Ex.: Ballet, Jazz, Recepção" />
        <FieldError name="especialidade" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-status">Status</FieldLabel>
        <Controller
          control={control}
          name="status"
          defaultValue={"ATIVO" as any}
          render={({ field }) => (
            <Select value={field.value ?? "ATIVO"} onValueChange={field.onChange}>
              <SelectTrigger id="colab-status" className={baseInputClasses}><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
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
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-0 focus-visible:shadow-none placeholder:text-gray-400"
          placeholder="Notas gerais sobre o colaborador (opcional)"
        />
        <FieldError name="observacoes" />
      </div>
    </div>
  );
}
