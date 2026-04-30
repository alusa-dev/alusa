'use client';

import { useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { AlertCircle, Edit } from '@/components/icons/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from '@/components/ui/toast';
import { CustomToast } from '@/components/ui/toast';
import {
  portalPerfilInputDTOSchema,
  type PortalPerfilDTO,
  type PortalPerfilInputDTO,
} from '@/features/portal/dtos';

export function PortalPerfilFeature() {
  const { data: session, update: updateSession } = useSession();
  const [perfil, setPerfil] = useState<PortalPerfilDTO | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<PortalPerfilInputDTO>({
    resolver: zodResolver(portalPerfilInputDTOSchema),
  });

  useEffect(() => {
    async function loadPerfil() {
      try {
        setLoading(true);
        const response = await fetch('/api/portal/perfil');
        if (!response.ok) {
          throw new Error('Erro ao carregar perfil');
        }
        const result = await response.json();
        setPerfil(result);
        reset({
          nome: result.nome,
          email: result.email || '',
          telefone: result.telefone || '',
          enderecoCep: result.enderecoCep || '',
          enderecoLogradouro: result.enderecoLogradouro || '',
          enderecoNumero: result.enderecoNumero || '',
          enderecoComplemento: result.enderecoComplemento || '',
          enderecoBairro: result.enderecoBairro || '',
          enderecoCidade: result.enderecoCidade || '',
          enderecoUf: result.enderecoUf || '',
        });
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    }

    if (session?.user) {
      loadPerfil();
    }
  }, [session, reset]);

  const onSubmit = async (data: PortalPerfilInputDTO) => {
    try {
      setSubmitting(true);
      const response = await fetch('/api/portal/perfil', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || 'Erro ao atualizar perfil');
      }

      const updated = await response.json();
      setPerfil(updated);
      setIsEditing(false);
      
      // Atualizar sessão se o nome mudou
      if (data.nome !== session?.user?.name) {
        await updateSession();
      }

      toast.custom((t) => (
        <CustomToast
          variant="success"
          title="Perfil atualizado"
          description="Suas informações foram atualizadas com sucesso."
          onClose={() => toast.dismiss(t)}
        />
      ));
    } catch (err) {
      toast.custom((t) => (
        <CustomToast
          variant="error"
          title="Erro ao atualizar"
          description={(err as Error).message}
          onClose={() => toast.dismiss(t)}
        />
      ));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-96" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-3 p-4 bg-red-50 border border-red-200 rounded-lg text-red-800">
        <AlertCircle className="h-5 w-5" />
        <span>{error}</span>
      </div>
    );
  }

  if (!perfil) return null;

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gray-900">Meu Perfil</h1>
          <p className="mt-2 text-gray-600">Gerencie suas informações pessoais</p>
        </div>
        {!isEditing && (
          <button
            onClick={() => setIsEditing(true)}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium"
          >
            <Edit className="h-4 w-4" />
            Editar Perfil
          </button>
        )}
      </div>

      {/* Formulário */}
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
        {/* Informações Pessoais */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Informações Pessoais</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Nome */}
            <div className="md:col-span-2">
              <label htmlFor="nome" className="block text-sm font-medium text-gray-700 mb-2">
                Nome Completo *
              </label>
              <input
                {...register('nome')}
                type="text"
                disabled={!isEditing}
                className={`w-full px-4 py-3 border rounded-lg transition-colors ${
                  isEditing ? 'bg-white border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent' : 'bg-gray-50 border-gray-200'
                }`}
              />
              {errors.nome && (
                <p className="mt-1 text-sm text-red-600">{errors.nome.message}</p>
              )}
            </div>

            {/* E-mail */}
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-2">
                E-mail *
              </label>
              <input
                {...register('email')}
                type="email"
                disabled={!isEditing}
                className={`w-full px-4 py-3 border rounded-lg transition-colors ${
                  isEditing ? 'bg-white border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent' : 'bg-gray-50 border-gray-200'
                }`}
              />
              {errors.email && (
                <p className="mt-1 text-sm text-red-600">{errors.email.message}</p>
              )}
            </div>

            {/* Telefone */}
            <div>
              <label htmlFor="telefone" className="block text-sm font-medium text-gray-700 mb-2">
                Telefone *
              </label>
              <input
                {...register('telefone')}
                type="tel"
                disabled={!isEditing}
                className={`w-full px-4 py-3 border rounded-lg transition-colors ${
                  isEditing ? 'bg-white border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent' : 'bg-gray-50 border-gray-200'
                }`}
              />
              {errors.telefone && (
                <p className="mt-1 text-sm text-red-600">{errors.telefone.message}</p>
              )}
            </div>

            {/* CPF (somente leitura) */}
            {perfil.cpf && (
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  CPF
                </label>
                <input
                  type="text"
                  value={perfil.cpf}
                  disabled
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg bg-gray-50"
                />
              </div>
            )}

            {/* Data de Nascimento (somente leitura para alunos) */}
            {perfil.dataNasc && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Data de Nascimento
                </label>
                <input
                  type="text"
                  value={new Date(perfil.dataNasc).toLocaleDateString('pt-BR')}
                  disabled
                  className="w-full px-4 py-3 border border-gray-200 rounded-lg bg-gray-50"
                />
              </div>
            )}
          </div>
        </div>

        {/* Endereço */}
        <div className="bg-white rounded-xl border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Endereço</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* CEP */}
            <div>
              <label htmlFor="enderecoCep" className="block text-sm font-medium text-gray-700 mb-2">
                CEP
              </label>
              <input
                {...register('enderecoCep')}
                type="text"
                disabled={!isEditing}
                className={`w-full px-4 py-3 border rounded-lg transition-colors ${
                  isEditing ? 'bg-white border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent' : 'bg-gray-50 border-gray-200'
                }`}
              />
            </div>

            {/* Logradouro */}
            <div className="md:col-span-2">
              <label htmlFor="enderecoLogradouro" className="block text-sm font-medium text-gray-700 mb-2">
                Logradouro
              </label>
              <input
                {...register('enderecoLogradouro')}
                type="text"
                disabled={!isEditing}
                className={`w-full px-4 py-3 border rounded-lg transition-colors ${
                  isEditing ? 'bg-white border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent' : 'bg-gray-50 border-gray-200'
                }`}
              />
            </div>

            {/* Número */}
            <div>
              <label htmlFor="enderecoNumero" className="block text-sm font-medium text-gray-700 mb-2">
                Número
              </label>
              <input
                {...register('enderecoNumero')}
                type="text"
                disabled={!isEditing}
                className={`w-full px-4 py-3 border rounded-lg transition-colors ${
                  isEditing ? 'bg-white border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent' : 'bg-gray-50 border-gray-200'
                }`}
              />
            </div>

            {/* Complemento */}
            <div>
              <label htmlFor="enderecoComplemento" className="block text-sm font-medium text-gray-700 mb-2">
                Complemento
              </label>
              <input
                {...register('enderecoComplemento')}
                type="text"
                disabled={!isEditing}
                className={`w-full px-4 py-3 border rounded-lg transition-colors ${
                  isEditing ? 'bg-white border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent' : 'bg-gray-50 border-gray-200'
                }`}
              />
            </div>

            {/* Bairro */}
            <div>
              <label htmlFor="enderecoBairro" className="block text-sm font-medium text-gray-700 mb-2">
                Bairro
              </label>
              <input
                {...register('enderecoBairro')}
                type="text"
                disabled={!isEditing}
                className={`w-full px-4 py-3 border rounded-lg transition-colors ${
                  isEditing ? 'bg-white border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent' : 'bg-gray-50 border-gray-200'
                }`}
              />
            </div>

            {/* Cidade */}
            <div>
              <label htmlFor="enderecoCidade" className="block text-sm font-medium text-gray-700 mb-2">
                Cidade
              </label>
              <input
                {...register('enderecoCidade')}
                type="text"
                disabled={!isEditing}
                className={`w-full px-4 py-3 border rounded-lg transition-colors ${
                  isEditing ? 'bg-white border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent' : 'bg-gray-50 border-gray-200'
                }`}
              />
            </div>

            {/* UF */}
            <div>
              <label htmlFor="enderecoUf" className="block text-sm font-medium text-gray-700 mb-2">
                UF
              </label>
              <input
                {...register('enderecoUf')}
                type="text"
                maxLength={2}
                disabled={!isEditing}
                className={`w-full px-4 py-3 border rounded-lg transition-colors ${
                  isEditing ? 'bg-white border-gray-300 focus:ring-2 focus:ring-violet-500 focus:border-transparent' : 'bg-gray-50 border-gray-200'
                }`}
              />
            </div>
          </div>
        </div>

        {/* Ações */}
        {isEditing && (
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="px-6 py-3 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? 'Salvando...' : 'Salvar Alterações'}
            </button>
            <button
              type="button"
              onClick={() => {
                setIsEditing(false);
                reset();
              }}
              disabled={submitting}
              className="px-6 py-3 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
            >
              Cancelar
            </button>
          </div>
        )}
      </form>
    </div>
  );
}

