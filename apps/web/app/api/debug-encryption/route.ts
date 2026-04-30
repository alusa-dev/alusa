import { NextResponse } from 'next/server';
import { loadAsaasCredentials } from '@alusa/database';

export async function GET() {
  const hasEncryptionKey = Boolean(process.env.ENCRYPTION_KEY);
  const encryptionKeyLength = process.env.ENCRYPTION_KEY?.length ?? 0;
  
  // Testa carregar credenciais para uma conta específica
  const testContaId = 'ca37e235-4310-4499-9a55-9cc46d06d7d9';
  let credentialsResult: { success: boolean; error?: string; hasApiKey?: boolean } = { success: false };
  
  try {
    const creds = await loadAsaasCredentials(testContaId);
    credentialsResult = {
      success: true,
      hasApiKey: Boolean(creds?.apiKey),
    };
  } catch (error) {
    credentialsResult = {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }

  return NextResponse.json({
    hasEncryptionKey,
    encryptionKeyLength,
    credentialsResult,
    nodeEnv: process.env.NODE_ENV,
  });
}
