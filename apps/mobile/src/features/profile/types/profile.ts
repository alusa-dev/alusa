export type MobileProfile = {
  personal: {
    name: string;
    email: string;
    telefone: string | null;
    birthDate: string | null;
    bio: string | null;
    locale: string;
    theme: string;
  };
  school: {
    id: string;
    name: string;
    cpfCnpj: string | null;
    status: string;
    timezone: string;
    role: string;
    address: {
      cep: string | null;
      street: string | null;
      number: string | null;
      neighborhood: string | null;
      city: string | null;
      state: string | null;
    };
  };
  permissions: {
    canEditPersonal: boolean;
    canEditSchool: boolean;
    canEditSchoolLegalIdentity: boolean;
  };
};

export type MobileProfileUpdateInput = {
  personal?: {
    name?: string;
    telefone?: string | null;
    bio?: string | null;
  };
  school?: {
    name?: string;
    timezone?: string;
    address?: {
      street?: string;
      number?: string;
      neighborhood?: string;
      city?: string;
      state?: string;
      cep?: string;
    };
  };
};
