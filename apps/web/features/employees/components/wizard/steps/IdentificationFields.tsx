'use client';
import { useFormContext } from 'react-hook-form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectValue,
} from '@/components/ui/select';
import { FieldError, FieldLabel, IMaskControlled, DateMaskControlled, WizardInput, WizardSelectTrigger } from '../ui';
import { Calendar } from '@/components/icons/icons';
import { Controller } from 'react-hook-form';
import type { ColaboradorInput } from '@alusa/lib/schemas/colaborador';

export default function IdentificationFields() {
  const { control, register, clearErrors } = useFormContext<ColaboradorInput>();
  const baseInputClasses = 'rounded-md';
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      <div className="md:col-span-2">
        <FieldLabel htmlFor="colab-nome" required>
          Nome completo
        </FieldLabel>
        <WizardInput
          id="colab-nome"
          {...register('nome')}
          placeholder="Digite o nome completo"
          className={baseInputClasses}
          requiredIndicator
        />
        <FieldError name="nome" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-nome-social">Nome social</FieldLabel>
        <WizardInput
          id="colab-nome-social"
          {...register('nomeSocial')}
          placeholder="Opcional"
          className={baseInputClasses}
        />
        <FieldError name="nomeSocial" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-data-nasc" required>
          Data de nascimento
        </FieldLabel>
        <DateMaskControlled
          name="dataNasc"
          id="colab-data-nasc"
          ariaLabel="Data de nascimento"
          rightIcon={<Calendar className="h-4 w-4 text-gray-600" aria-hidden="true" />}
          inputClassName={baseInputClasses}
          requiredIndicator
        />
        <FieldError name="dataNasc" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-cpf">CPF</FieldLabel>
        <IMaskControlled
          id="colab-cpf"
          name="cpf"
          mask="000.000.000-00"
          placeholder="000.000.000-00"
          ariaLabel="CPF"
          inputClassName={baseInputClasses}
        />
        <FieldError name="cpf" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-rg">RG</FieldLabel>
        <WizardInput id="colab-rg" {...register('rg')} className={baseInputClasses} />
        <FieldError name="rg" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-genero">Gênero</FieldLabel>
        <Controller
          control={control}
          name="genero"
          render={({ field }) => (
            <Select value={field.value ?? undefined} onValueChange={(value) => { field.onChange(value); clearErrors('genero'); }}>
        <WizardSelectTrigger name="genero" id="colab-genero" className={baseInputClasses}>
                <SelectValue placeholder="Selecione" />
        </WizardSelectTrigger>
              <SelectContent className="colaborador-wizard-corner-smoothing">
                <SelectItem value="MASCULINO">Masculino</SelectItem>
                <SelectItem value="FEMININO">Feminino</SelectItem>
                <SelectItem value="NAO_BINARIO">Não-binário</SelectItem>
                <SelectItem value="OUTRO">Outro</SelectItem>
                <SelectItem value="PREFERE_NAO_INFORMAR">Prefere não informar</SelectItem>
              </SelectContent>
            </Select>
          )}
        />
        <FieldError name="genero" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-email" required>
          Email
        </FieldLabel>
        <WizardInput
          id="colab-email"
          type="email"
          {...register('email')}
          placeholder="email@exemplo.com"
          className={baseInputClasses}
          requiredIndicator
        />
        <FieldError name="email" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-telefone1" required>
          Telefone
        </FieldLabel>
        <IMaskControlled
          id="colab-telefone1"
          name="telefone1"
          mask="(00) 00000-0000"
          placeholder="(00) 00000-0000"
          ariaLabel="Telefone"
          inputClassName={baseInputClasses}
          requiredIndicator
        />
        <FieldError name="telefone1" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-emergencia">Contato de Emergência</FieldLabel>
        <IMaskControlled
          id="colab-emergencia"
          name="contatoEmergenciaTelefone"
          mask="(00) 00000-0000"
          placeholder="(00) 00000-0000"
          ariaLabel="Contato de Emergência"
          inputClassName={baseInputClasses}
        />
        <FieldError name="contatoEmergenciaTelefone" />
      </div>
    </div>
  );
}
