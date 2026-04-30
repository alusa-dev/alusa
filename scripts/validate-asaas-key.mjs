// scripts/validate-asaas-key.mjs
// Valida se o .env.local está corretamente configurado para o Asaas (sandbox)


import fs from 'fs'
import path from 'path'
import dotenv from 'dotenv'
import fetch from 'node-fetch'

function tryLoadEnv(envPath) {
  if (fs.existsSync(envPath)) {
    dotenv.config({ path: envPath })
    return true
  }
  return false
}

const rootEnv = path.resolve(process.cwd(), '.env.local')
const webEnv = path.resolve(process.cwd(), 'apps/web/.env.local')

let loaded = false
if (tryLoadEnv(rootEnv)) {
  console.log('ℹ️  .env.local da raiz carregado')
  loaded = true
}
if (tryLoadEnv(webEnv)) {
  console.log('ℹ️  .env.local de apps/web carregado (sobrepõe raiz)')
  loaded = true
}
if (!loaded) {
  console.error('❌ Nenhum .env.local encontrado')
  process.exit(1)
}

const key = process.env.ASAAS_API_KEY


console.log('--- VALIDANDO ASAAS_API_KEY ---')


if (!key) {
  console.error('❌ ASAAS_API_KEY não encontrada em nenhum .env.local')
  process.exit(1)
}


console.log('Valor recebido pelo Node:')
console.log(key)
console.log('Tamanho:', key.length)

// 1️⃣ Validação literal
if (key.startsWith('\\$')) {
  console.error('❌ ERRO: a chave contém "\\$" (escape inválido)')
  process.exit(1)
}

if (!key.startsWith('$aact_')) {
  console.error('❌ ERRO: formato inesperado de chave ASAAS')
  process.exit(1)
}

console.log('✅ Formato literal OK')


// 2️⃣ Teste real com Asaas (header correto: access_token)
const response = await fetch('https://sandbox.asaas.com/api/v3/myAccount', {
  headers: {
    access_token: key,
  },
})

if (response.status === 200) {
  const data = await response.json()
  console.log('✅ Chave aceita pelo Asaas')
  console.log('Conta:', data.name || data.companyName || '(sem nome)')
  process.exit(0)
}

console.error('❌ Chave rejeitada pelo Asaas')
console.error('Status:', response.status)
console.error('Resposta:', await response.text())
process.exit(1)
