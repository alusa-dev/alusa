import { GET } from '../app/api/professores/route';

(async () => {
  const response = await GET(new Request('http://localhost/api/professores?contaId=conta-default'));
  const json = await response.json();
  console.log(response.status, JSON.stringify(json, null, 2));
})();
