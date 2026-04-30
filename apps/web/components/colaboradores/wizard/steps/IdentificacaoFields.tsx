'use client';
import { useFormContext } from 'react-hook-form';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FieldError, FieldLabel, IMaskControlled, DateMaskControlled } from '../ui';
import { Calendar } from '@/components/icons/icons';
import { Controller } from 'react-hook-form';
import type { ColaboradorInput } from '../../../../../../packages/lib/src/schemas/colaborador';

export default function IdentificacaoFields() {
  const { control, register } = useFormContext<ColaboradorInput>();
  const baseInputClasses =
    'h-10 px-3 bg-white border border-gray-300 placeholder:text-gray-400 text-gray-900 shadow-none rounded-md';
  return (
    <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
      <div className="md:col-span-2">
        <FieldLabel htmlFor="colab-nome" required>
          Nome completo
        </FieldLabel>
        <Input
          id="colab-nome"
          {...register('nome')}
          placeholder="Digite o nome completo"
          className={baseInputClasses}
        />
        <FieldError name="nome" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-nome-social">Nome social</FieldLabel>
        <Input
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
        <Input id="colab-rg" {...register('rg')} className={baseInputClasses} />
        <FieldError name="rg" />
      </div>
      <div>
        <FieldLabel htmlFor="colab-genero">Gênero</FieldLabel>
        <Controller
          control={control}
          name="genero"
          render={({ field }) => (
            <Select value={field.value ?? undefined} onValueChange={field.onChange}>
              <SelectTrigger id="colab-genero" className={baseInputClasses}>
                <SelectValue placeholder="Selecione" />
              </SelectTrigger>
              <SelectContent>
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
        <Input
          id="colab-email"
          type="email"
          {...register('email')}
          placeholder="email@exemplo.com"
          className={baseInputClasses}
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
