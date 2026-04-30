"use client";
import { Controller, useFormContext } from "react-hook-form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FieldError, FieldLabel } from "../ui";
import type { ColaboradorInput } from "../../../../../../packages/lib/src/schemas/colaborador";

export default function AcessoFields() {
  const { control, watch } = useFormContext<ColaboradorInput>();
  const temAcesso = watch("temAcesso");
  const baseInputClasses = "h-10 px-3 bg-white border border-gray-300 placeholder:text-gray-400 text-gray-900 shadow-none";
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      <div className="md:col-span-3 flex items-center gap-3">
        <Controller
          control={control}
          name="temAcesso"
          render={({ field }) => (
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300 text-violet-600 focus:ring-violet-500"
                checked={!!field.value}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => field.onChange(e.target.checked)}
              />
              Conceder acesso ao sistema
            </label>
          )}
        />
        <FieldError name="temAcesso" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-role">Perfil de acesso</FieldLabel>
        <Controller
          control={control}
          name="roleUsuario"
          render={({ field }) => (
            <Select value={field.value ?? undefined} onValueChange={field.onChange} disabled={!temAcesso}>
              <SelectTrigger id="colab-role" className={baseInputClasses}><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="ADMIN">Admin</SelectItem>
                <SelectItem value="FINANCEIRO">Financeiro</SelectItem>
                <SelectItem value="RECEPCAO">Recepção</SelectItem>
                <SelectItem value="PROFESSOR">Professor</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <FieldError name="roleUsuario" />
      </div>
    </div>
  );
}
