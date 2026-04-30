import cepPromise from 'cep-promise';

export type CepData = { cep: string; logradouro?: string; bairro?: string; cidade?: string; uf?: string };

export async function findCEP(cep: string): Promise<CepData> {
  const raw = cep.replace(/\D/g, '');
  if (raw.length !== 8) throw new Error('CEP inválido');
  const d = await cepPromise(raw);
  return { cep: raw, logradouro: d.street, bairro: d.neighborhood, cidade: d.city, uf: d.state };
}
