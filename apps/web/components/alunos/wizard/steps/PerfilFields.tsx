"use client";
import { useFormContext, Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { FieldError, FieldLabel, wizardFieldInputClass } from "../ui";
import type { AlunoInput } from "../../../../../../prisma/zod/aluno";

export default function PerfilFields() {
  const { register, control, watch, setValue } = useFormContext<AlunoInput>();
  const consentimentoImagem = watch("consentimentoImagem");
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
      <div className="md:col-span-4 grid gap-4 sm:grid-cols-2">
        <div className="flex items-start gap-2 rounded-md border border-slate-200 p-3 alusa-dark:border-[color:var(--color-border-default)]">
          <input
            type="checkbox"
            id="consentimentoImagem"
            className="mt-0.5 h-4 w-4"
            checked={!!consentimentoImagem}
            onChange={(e) => setValue("consentimentoImagem", e.target.checked, { shouldValidate: true })}
          />
          <label htmlFor="consentimentoImagem" className="cursor-pointer select-none text-xs leading-snug text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            Autorizo uso de imagem do aluno em materiais institucionais.
          </label>
        </div>
        <div className="flex items-start gap-2 rounded-md border border-slate-200 p-3 alusa-dark:border-[color:var(--color-border-default)]">
          <Controller
            control={control}
            name="consentimentoComunicacoes"
            render={({ field }) => (
              <input
                type="checkbox"
                id="consentimentoComunicacoes"
                className="mt-0.5 h-4 w-4"
                checked={!!field.value}
                onChange={(e) => field.onChange(e.target.checked)}
              />
            )}
          />
          <label htmlFor="consentimentoComunicacoes" className="cursor-pointer select-none text-xs leading-snug text-slate-600 alusa-dark:text-[color:var(--color-text-secondary)]">
            Aceito receber comunicações (avisos, lembretes e novidades) por e-mail/telefone.
          </label>
        </div>
      </div>
    </div>
  );
}
