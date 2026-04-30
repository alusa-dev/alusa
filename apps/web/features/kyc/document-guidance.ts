import type { VerificationAction } from './constants';

type DocumentGuidance = {
  title: string;
  checklist: string[];
  tips?: string[];
};

function normalizeDocumentType(action: Pick<VerificationAction, 'documentType' | 'uploadType'>): string {
  return String(action.uploadType ?? action.documentType ?? '').trim().toUpperCase();
}

export function getKycDocumentGuidance(
  action: Pick<VerificationAction, 'documentType' | 'uploadType'>,
): DocumentGuidance {
  const documentType = normalizeDocumentType(action);

  switch (documentType) {
    case 'IDENTIFICATION':
      return {
        title: 'Envie a frente e o verso de um documento oficial com foto do titular',
        checklist: [
          'Use RG ou CNH válidos e legíveis.',
          'Envie a frente em um campo e o verso no outro, sem inverter as imagens.',
          'Garanta que foto, nome e número do documento estejam visíveis, sem cortes ou reflexos.',
        ],
        tips: ['Evite fotos escuras, tremidas ou com brilho sobre o plástico.'],
      };
    case 'IDENTIFICATION_SELFIE':
      return {
        title: 'Envie uma selfie nítida do titular',
        checklist: [
          'Mantenha o rosto inteiro visível e centralizado na imagem.',
          'Use boa iluminação e fundo simples para facilitar a análise.',
          'Evite óculos escuros, sombras fortes ou qualquer item cobrindo o rosto.',
        ],
        tips: ['Se a câmera estiver desfocada, tire outra foto antes de enviar.'],
      };
    case 'ALLOW_BANK_ACCOUNT_DEPOSIT_STATEMENT':
      return {
        title: 'Envie um comprovante bancário legível',
        checklist: [
          'Use um arquivo onde nome do titular, banco e dados da conta estejam visíveis.',
          'Garanta que todas as informações importantes estejam na mesma imagem ou PDF.',
        ],
      };
    default:
      return {
        title: 'Confira o arquivo antes de enviar',
        checklist: [
          'Use um arquivo legível e completo.',
          'Evite cortes, reflexos e baixa iluminação.',
        ],
      };
  }
}

export function getKycActionLabel(action: Pick<VerificationAction, 'mode' | 'documentType' | 'uploadType'>): string {
  if (action.mode === 'REDIRECT') return 'Continuar verificação';

  const documentType = normalizeDocumentType(action);
  if (documentType === 'IDENTIFICATION') return 'Enviar frente e verso';
  if (documentType === 'IDENTIFICATION_SELFIE') return 'Enviar selfie';
  return 'Enviar arquivo';
}
