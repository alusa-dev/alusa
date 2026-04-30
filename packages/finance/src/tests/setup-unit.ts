/**
 * Setup leve para testes unitários que não dependem de banco de dados
 * Use em testes de mappers, helpers, e funções puras
 */

// Mock de variáveis de ambiente que podem ser necessárias
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString('base64');

// Não há dependência de banco aqui
