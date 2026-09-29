"use client";
import { useFormContext, Controller, useWatch } from "react-hook-form";
import { cn } from "@/lib/utils";
import { InfoCallout } from "@/components/ui/info-callout";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FieldError,
  FieldLabel,
  IMaskControlled,
  DateMaskControlled,
  WizardInput,
  useWizardErrorsVisible,
  wizardFieldInvalidClass,
  wizardFieldInputClass,
} from "../ui";
import { Calendar } from "@/components/icons/icons";
import type { AlunoInput } from "../../../../../../../prisma/zod/aluno";

/** Calcula se é menor de idade a partir de uma data de nascimento */
function calcularMenorIdade(dataNasc: Date | string | undefined | null): boolean {
  if (!dataNasc) return false;
  const nasc = typeof dataNasc === 'string' ? new Date(dataNasc) : dataNasc;
  if (isNaN(nasc.getTime())) return false;
  const hoje = new Date();
  let idade = hoje.getFullYear() - nasc.getFullYear();
  const mesAtual = hoje.getMonth();
  const mesNasc = nasc.getMonth();
  if (mesAtual < mesNasc || (mesAtual === mesNasc && hoje.getDate() < nasc.getDate())) {
    idade--;
  }
  return idade < 18;
}

export default function IdentificationFields() {
  const { control, register } = useFormContext<AlunoInput>();
  const errorsVisible = useWizardErrorsVisible();
  const dataNasc = useWatch({ control, name: "dataNasc" });
  const isMenorIdade = calcularMenorIdade(dataNasc);
  // CPF obrigatório apenas para +18 anos; para -18, CPF é opcional (responsável já tem CPF obrigatório)
  const cpfRequired = !isMenorIdade;
  const contatoAlunoRequired = !isMenorIdade;

  const baseInputClasses = wizardFieldInputClass;
  const fieldLabelClass = "[&>label]:mb-1 [&>label]:block";

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-[1.25fr_1fr] sm:gap-x-4 sm:gap-y-0">
        <div className={fieldLabelClass}>
          <FieldLabel htmlFor="aluno-nome" required>
            Nome completo
          </FieldLabel>
          <WizardInput
            id="aluno-nome"
            data-testid="aluno-nome"
            {...register("nome")}
            requiredIndicator
            placeholder="Digite o nome completo"
            className={baseInputClasses}
          />
          <FieldError name="nome" />
        </div>

        <div className={fieldLabelClass}>
          <FieldLabel htmlFor="aluno-nome-social">
            Nome social <span className="font-normal text-[#727272]">(Opcional)</span>
          </FieldLabel>
          <WizardInput
            id="aluno-nome-social"
            {...register("nomeSocial")}
            placeholder="Digite um nome social aqui"
            className={baseInputClasses}
          />
          <FieldError name="nomeSocial" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 md:gap-x-4 md:gap-y-0">
        <div className={fieldLabelClass}>
          <FieldLabel htmlFor="aluno-data-nasc" required>
            Data de nascimento
          </FieldLabel>
          <DateMaskControlled
            name="dataNasc"
            id="aluno-data-nasc"
            ariaLabel="Data de nascimento"
            rightIcon={<Calendar className="h-4 w-4 text-gray-600 alusa-dark:text-[color:var(--color-text-muted)]" aria-hidden="true" />}
            inputClassName={baseInputClasses}
            requiredIndicator
          />
          <FieldError name="dataNasc" />
        </div>

        <div className={fieldLabelClass}>
          <FieldLabel htmlFor="aluno-cpf" required={cpfRequired}>
            CPF
          </FieldLabel>
          <IMaskControlled
            id="aluno-cpf"
            data-testid="aluno-cpf"
            name="cpf"
            mask="000.000.000-00"
            placeholder="000.000.000-00"
            ariaLabel="CPF"
            inputClassName={baseInputClasses}
            requiredIndicator={cpfRequired}
            unmask
          />
          <FieldError name="cpf" />
        </div>

        <div className={fieldLabelClass}>
          <FieldLabel htmlFor="aluno-email" required={contatoAlunoRequired}>
            Email
          </FieldLabel>
          <WizardInput
            id="aluno-email"
            type="email"
            {...register("email")}
            requiredIndicator={contatoAlunoRequired}
            placeholder="email@exemplo.com"
            className={baseInputClasses}
          />
          <FieldError name="email" />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 md:gap-x-4 md:gap-y-0">
        <div className={fieldLabelClass}>
          <FieldLabel htmlFor="aluno-telefone" required={contatoAlunoRequired}>
            Telefone
          </FieldLabel>
          <IMaskControlled
            id="aluno-telefone"
            data-testid="aluno-telefone"
            name="telefone"
            mask={["(00) 0000-0000", "(00) 00000-0000"]}
            placeholder="(00) 00000-0000"
            ariaLabel="Telefone"
            inputClassName={baseInputClasses}
            requiredIndicator={contatoAlunoRequired}
            unmask
          />
          <FieldError name="telefone" />
        </div>

        <div className={fieldLabelClass}>
          <FieldLabel htmlFor="aluno-genero">Gênero</FieldLabel>
          <Controller
            control={control}
            name="genero"
            render={({ field, fieldState }) => (
              <Select
                value={field.value ?? undefined}
                onValueChange={field.onChange}
              >
                <SelectTrigger
                  id="aluno-genero"
                  className={cn(baseInputClasses, errorsVisible && fieldState.invalid && wizardFieldInvalidClass)}
                  aria-invalid={errorsVisible && fieldState.invalid || undefined}
                >
                  <SelectValue placeholder="Selecione" />
                </SelectTrigger>
                <SelectContent className="alusa-wizard-corner-smoothing">
                  <SelectItem value="MASCULINO">Masculino</SelectItem>
                  <SelectItem value="FEMININO">Feminino</SelectItem>
                  <SelectItem value="NAO_BINARIO">Não-binário</SelectItem>
                  <SelectItem value="OUTRO">Outro</SelectItem>
                  <SelectItem value="PREFERE_NAO_INFORMAR">
                    Prefere não informar
                  </SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <FieldError name="genero" />
        </div>

        <div className={fieldLabelClass}>
          <FieldLabel htmlFor="aluno-status">Status</FieldLabel>
          <Controller
            control={control}
            name="status"
            render={({ field, fieldState }) => (
              <Select
                value={field.value ?? "ATIVO"}
                onValueChange={field.onChange}
              >
                <SelectTrigger
                  id="aluno-status"
                  className={cn(baseInputClasses, errorsVisible && fieldState.invalid && wizardFieldInvalidClass)}
                  aria-invalid={errorsVisible && fieldState.invalid || undefined}
                >
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent className="alusa-wizard-corner-smoothing">
                  <SelectItem value="ATIVO">Ativo</SelectItem>
                  <SelectItem value="INATIVO">Inativo</SelectItem>
                </SelectContent>
              </Select>
            )}
          />
          <FieldError name="status" />
        </div>
      </div>

      {isMenorIdade && (
        <div>
          <InfoCallout size="sm">
            Para menor de idade, CPF, e-mail e telefone do aluno são opcionais nesta etapa. O contato
            principal será o do responsável.
          </InfoCallout>
        </div>
      )}
    </div>
  );
}
