// Augmentation oficial NextAuth para incluir campos adicionais em User/Session/JWT
import { DefaultSession, DefaultUser } from 'next-auth';
import { JWT as DefaultJWT } from 'next-auth/jwt';

declare module 'next-auth' {
  interface User extends DefaultUser {
    role: string;
    contaId: string | null;
    emailVerified: boolean;
    accountActive?: boolean;
  }
  interface Session {
    user: {
      id: string;
      email: string;
      name: string;
      role: string;
      contaId: string | null;
      emailVerified: boolean;
      accountActive?: boolean;
      financeStatus?: string;
      financeIntegrationMode?: string;
      externalAsaasOnboardingStatus?: string;
      foto?: string | null;
      image?: string | null;
    } & DefaultSession['user'];
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id?: string;
    role?: string;
    contaId?: string | null;
    emailVerified?: boolean;
    accountActive?: boolean;
    financeStatus?: string;
    financeIntegrationMode?: string;
    externalAsaasOnboardingStatus?: string;
  }
}

// Fallback para libs sem tipos (se necessário)
declare module 'bcryptjs';
