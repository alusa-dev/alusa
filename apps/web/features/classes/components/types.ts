export interface Modalidade {
  id: string;
  nome: string;
}

export interface Sala {
  id: string;
  nome: string;
}

export interface Professor {
  id: string;
  nome: string;
  nomeLegal?: string;
  email?: string;
  telefone?: string;
  especialidades?: string[];
  foto?: string | null;
  status?: string;
}
