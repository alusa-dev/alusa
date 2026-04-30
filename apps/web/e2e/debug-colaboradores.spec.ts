import { test } from '@playwright/test';

test('Deve acessar a página de colaboradores', async ({ page }) => {
  // Navegar para a página de colaboradores
  await page.goto('http://localhost:3001/colaboradores');
  
  // Aguardar um pouco
  await page.waitForTimeout(3000);
  
  // Fazer screenshot para debug
  await page.screenshot({ path: 'debug-colaboradores-page.png' });
  
  // Verificar o que está sendo exibido
  const title = await page.title();
  console.log('Title:', title);
  
  const url = page.url();
  console.log('URL atual:', url);
  
  const body = await page.textContent('body');
  console.log('Conteúdo da página:', body?.substring(0, 200));
});