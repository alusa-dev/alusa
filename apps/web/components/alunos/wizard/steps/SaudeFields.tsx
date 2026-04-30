"use client";
import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input"; // (apenas para consistência caso precise)
import { FieldError, FieldLabel, IMaskControlled } from "../ui";
import type { AlunoInput } from "../../../../../../prisma/zod/aluno";

export default function SaudeFields() {
  const { register } = useFormContext<AlunoInput>();
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      <div className="md:col-span-3">
        <FieldLabel>Alergias</FieldLabel>
        <textarea
          {...register("alergias")}
          rows={2}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-0 focus-visible:shadow-none placeholder:text-gray-400"
          placeholder="Liste alergias conhecidas (ou deixe em branco)"
        />
      </div>
      <div className="md:col-span-3">
        <FieldLabel>Restrições médicas</FieldLabel>
        <textarea
          {...register("restricoesMedicas")}
          rows={2}
          className="w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm outline-none focus-visible:ring-0 focus-visible:shadow-none placeholder:text-gray-400"
          placeholder="Descreva restrições, medicamentos, etc. (opcional)"
        />
      </div>
      <div>
        <FieldLabel>Contato de emergência — nome</FieldLabel>
  <Input {...register("contatoEmergenciaNome")} placeholder="Pessoa para contato" className="h-10 border-gray-300 bg-white shadow-none placeholder:text-gray-400" />
        <FieldError name="contatoEmergenciaNome" />
      </div>
      <div>
        <FieldLabel>Contato de emergência — telefone</FieldLabel>
        <IMaskControlled
          name="contatoEmergenciaTelefone"
          mask={["(00) 0000-0000", "(00) 00000-0000"]}
          placeholder="(00) 00000-0000"
          ariaLabel="Telefone de emergência"
        />
        <FieldError name="contatoEmergenciaTelefone" />
      </div>
    </div>
  );
}
