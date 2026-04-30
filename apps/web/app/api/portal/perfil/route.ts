import { NextRequest } from 'next/server';
import prisma from '@/lib/prisma';
import { requirePortalUser } from '@/features/portal/api-helpers';
import { portalPerfilDTOSchema, portalPerfilInputDTOSchema } from '@/features/portal/dtos';
import { mapPortalPerfilToDTO } from '@/features/portal/mappers';
import { jsonNoStore } from '@/lib/http-security';

export async function GET() {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;
    const { user } = auth;

    // 3. Buscar dados baseado no tipo de usuário
    if (user.role === 'ALUNO') {
      const aluno = await prisma.aluno.findFirst({
        where: {
          usuario: { id: user.id },
          contaId: user.contaId,
        },
        select: {
          id: true,
          nome: true,
          email: true,
          telefone: true,
          cpf: true,
          dataNasc: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoComplemento: true,
          enderecoBairro: true,
          enderecoCidade: true,
          enderecoUf: true,
        },
      });

      if (!aluno) {
        return jsonNoStore({ error: 'Aluno não encontrado' }, { status: 404 });
      }

      return jsonNoStore(
        portalPerfilDTOSchema.parse(
          mapPortalPerfilToDTO({
            tipo: 'ALUNO',
            nome: aluno.nome,
            email: aluno.email,
            telefone: aluno.telefone,
            cpf: aluno.cpf,
            dataNasc: aluno.dataNasc,
            enderecoCep: aluno.enderecoCep,
            enderecoLogradouro: aluno.enderecoLogradouro,
            enderecoNumero: aluno.enderecoNumero,
            enderecoComplemento: aluno.enderecoComplemento,
            enderecoBairro: aluno.enderecoBairro,
            enderecoCidade: aluno.enderecoCidade,
            enderecoUf: aluno.enderecoUf,
          }),
        ),
      );
    } else if (user.role === 'RESPONSAVEL') {
      const responsavel = await prisma.responsavel.findFirst({
        where: {
          usuarioId: user.id,
          contaId: user.contaId,
        },
        select: {
          id: true,
          nome: true,
          email: true,
          telefone: true,
          cpf: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoComplemento: true,
          enderecoBairro: true,
          enderecoCidade: true,
          enderecoUf: true,
        },
      });

      if (!responsavel) {
        return jsonNoStore({ error: 'Responsável não encontrado' }, { status: 404 });
      }

      return jsonNoStore(
        portalPerfilDTOSchema.parse(
          mapPortalPerfilToDTO({
            tipo: 'RESPONSAVEL',
            nome: responsavel.nome,
            email: responsavel.email,
            telefone: responsavel.telefone,
            cpf: responsavel.cpf,
            enderecoCep: responsavel.enderecoCep,
            enderecoLogradouro: responsavel.enderecoLogradouro,
            enderecoNumero: responsavel.enderecoNumero,
            enderecoComplemento: responsavel.enderecoComplemento,
            enderecoBairro: responsavel.enderecoBairro,
            enderecoCidade: responsavel.enderecoCidade,
            enderecoUf: responsavel.enderecoUf,
          }),
        ),
      );
    }

    return jsonNoStore({ error: 'Tipo de usuário inválido' }, { status: 400 });
  } catch (error) {
    console.error('Erro ao buscar perfil:', error);
    return jsonNoStore({ error: 'Erro ao carregar perfil' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const auth = await requirePortalUser();
    if ('response' in auth) return auth.response;
    const { user } = auth;

    // 3. Validar dados recebidos
    const body = await req.json();
    const validation = portalPerfilInputDTOSchema.safeParse(body);

    if (!validation.success) {
      return jsonNoStore(
        { error: 'Dados inválidos', details: validation.error.errors },
        { status: 400 },
      );
    }

    const data = validation.data;

    // 4. Atualizar dados baseado no tipo de usuário
    if (user.role === 'ALUNO') {
      const aluno = await prisma.aluno.findFirst({
        where: {
          usuario: { id: user.id },
          contaId: user.contaId,
        },
        select: { id: true },
      });

      if (!aluno) {
        return jsonNoStore({ error: 'Aluno não encontrado' }, { status: 404 });
      }

      const updated = await prisma.aluno.update({
        where: { id: aluno.id },
        data: {
          nome: data.nome,
          email: data.email,
          telefone: data.telefone,
          enderecoCep: data.enderecoCep || null,
          enderecoLogradouro: data.enderecoLogradouro || null,
          enderecoNumero: data.enderecoNumero || null,
          enderecoComplemento: data.enderecoComplemento || null,
          enderecoBairro: data.enderecoBairro || null,
          enderecoCidade: data.enderecoCidade || null,
          enderecoUf: data.enderecoUf || null,
        },
        select: {
          nome: true,
          email: true,
          telefone: true,
          cpf: true,
          dataNasc: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoComplemento: true,
          enderecoBairro: true,
          enderecoCidade: true,
          enderecoUf: true,
        },
      });

      // Atualizar também o nome no usuário se mudou
      await prisma.usuario.update({
        where: { id: user.id },
        data: { nome: data.nome },
      });

      return jsonNoStore(
        portalPerfilDTOSchema.parse(
          mapPortalPerfilToDTO({
            tipo: 'ALUNO',
            nome: updated.nome,
            email: updated.email,
            telefone: updated.telefone,
            cpf: updated.cpf,
            dataNasc: updated.dataNasc,
            enderecoCep: updated.enderecoCep,
            enderecoLogradouro: updated.enderecoLogradouro,
            enderecoNumero: updated.enderecoNumero,
            enderecoComplemento: updated.enderecoComplemento,
            enderecoBairro: updated.enderecoBairro,
            enderecoCidade: updated.enderecoCidade,
            enderecoUf: updated.enderecoUf,
          }),
        ),
      );
    } else if (user.role === 'RESPONSAVEL') {
      const responsavel = await prisma.responsavel.findFirst({
        where: {
          usuarioId: user.id,
          contaId: user.contaId,
        },
        select: { id: true },
      });

      if (!responsavel) {
        return jsonNoStore({ error: 'Responsável não encontrado' }, { status: 404 });
      }

      const updated = await prisma.responsavel.update({
        where: { id: responsavel.id },
        data: {
          nome: data.nome,
          email: data.email,
          telefone: data.telefone,
          enderecoCep: data.enderecoCep || null,
          enderecoLogradouro: data.enderecoLogradouro || null,
          enderecoNumero: data.enderecoNumero || null,
          enderecoComplemento: data.enderecoComplemento || null,
          enderecoBairro: data.enderecoBairro || null,
          enderecoCidade: data.enderecoCidade || null,
          enderecoUf: data.enderecoUf || null,
        },
        select: {
          nome: true,
          email: true,
          telefone: true,
          cpf: true,
          enderecoCep: true,
          enderecoLogradouro: true,
          enderecoNumero: true,
          enderecoComplemento: true,
          enderecoBairro: true,
          enderecoCidade: true,
          enderecoUf: true,
        },
      });

      // Atualizar também o nome no usuário se mudou
      await prisma.usuario.update({
        where: { id: user.id },
        data: { nome: data.nome },
      });

      return jsonNoStore(
        portalPerfilDTOSchema.parse(
          mapPortalPerfilToDTO({
            tipo: 'RESPONSAVEL',
            nome: updated.nome,
            email: updated.email,
            telefone: updated.telefone,
            cpf: updated.cpf,
            enderecoCep: updated.enderecoCep,
            enderecoLogradouro: updated.enderecoLogradouro,
            enderecoNumero: updated.enderecoNumero,
            enderecoComplemento: updated.enderecoComplemento,
            enderecoBairro: updated.enderecoBairro,
            enderecoCidade: updated.enderecoCidade,
            enderecoUf: updated.enderecoUf,
          }),
        ),
      );
    }

    return jsonNoStore({ error: 'Tipo de usuário inválido' }, { status: 400 });
  } catch (error) {
    console.error('Erro ao atualizar perfil:', error);
    return jsonNoStore({ error: 'Erro ao atualizar perfil' }, { status: 500 });
  }
}
