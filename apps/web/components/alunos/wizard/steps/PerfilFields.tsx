"use client";
import { useFormContext, Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FieldError, FieldLabel, wizardFieldInputClass } from "../ui";
import type { AlunoInput } from "../../../../../../prisma/zod/aluno";

export default function PerfilFields() {
  const { register, control } = useFormContext<AlunoInput>();
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
      <div>
        <FieldLabel>Modalidade principal</FieldLabel>
  <Input {...register("modalidadePrincipal")} placeholder="Ex.: Ballet" className={wizardFieldInputClass} />
        <FieldError name="modalidadePrincipal" />
      </div>
      <div>
        <FieldLabel>Nível</FieldLabel>
  <Input {...register("nivel")} placeholder="Ex.: Intermediário" className={wizardFieldInputClass} />
        <FieldError name="nivel" />
      </div>
      <div>
        <FieldLabel>Origem cadastro</FieldLabel>
  <Input {...register("origemCadastro")} placeholder="Ex.: Indicação" className={wizardFieldInputClass} />
        <FieldError name="origemCadastro" />
      </div>
      <div>
        <FieldLabel>Tam. Camiseta</FieldLabel>
        <Controller
          control={control}
          name="tamanhoCamiseta"
          render={({ field }) => (
            <Select value={field.value ?? undefined} onValueChange={field.onChange}>
              <SelectTrigger className={cn(wizardFieldInputClass, 'h-10')}>
                <SelectValue placeholder="PP/P/M/G/GG" />
              </SelectTrigger>
              <SelectContent>
                {['PP','P','M','G','GG','XG'].map(t => (
                  <SelectItem key={t} value={t}>{t}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
        <FieldError name="tamanhoCamiseta" />
      </div>
      <div>
        <FieldLabel>Tam. Calçado</FieldLabel>
  <Input {...register("tamanhoCalcado")} placeholder="Ex.: 37" className={wizardFieldInputClass} />
        <FieldError name="tamanhoCalcado" />
      </div>
      <div className="md:col-span-2">
        <FieldLabel>Tags (separadas por vírgula)</FieldLabel>
  <Input {...register("tags" as const)} placeholder="Ex.: bolsista, potencial indicação" className={wizardFieldInputClass} />
      </div>
    </div>
  );
}
