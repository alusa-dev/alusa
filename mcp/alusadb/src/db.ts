/**
 * Pool de conexão PostgreSQL
 */

import pg from 'pg';

const { Pool } = pg;

// Configuração do pool
const poolConfig: pg.PoolConfig = {
  connectionString: process.env.DATABASE_URL,
  // Fallback para variáveis separadas
  host: process.env.PGHOST,
  port: process.env.PGPORT ? parseInt(process.env.PGPORT, 10) : undefined,
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  // Configurações de pool
  max: 5, // Máximo de conexões
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
};

// Pool singleton
let pool: pg.Pool | null = null;

/**
 * Obtém o pool de conexões (singleton)
 */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = new Pool(poolConfig);
    
    pool.on('error', (err) => {
      console.error('[alusadb] Erro no pool de conexão:', err.message);
    });
  }
  return pool;
}

/**
 * Executa uma query com timeout
 */
export async function executeQuery<T extends pg.QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: unknown[] = [],
  timeoutMs: number = 10000
): Promise<pg.QueryResult<T>> {
  const client = await getPool().connect();
  
  try {
    // Define timeout na sessão
    await client.query(`SET statement_timeout = ${timeoutMs}`);
    
    const startTime = Date.now();
    const result = await client.query<T>(sql, params);
    const executionTime = Date.now() - startTime;
    
    console.error(`[alusadb] Query executada em ${executionTime}ms`);
    
    return result;
  } finally {
    client.release();
  }
}

/**
 * Testa a conexão com o banco
 */
export async function testConnection(): Promise<boolean> {
  try {
    const result = await executeQuery('SELECT 1 as test');
    return result.rows.length > 0;
  } catch (error) {
    console.error('[alusadb] Falha ao testar conexão:', error);
    return false;
  }
}

/**
 * Fecha o pool de conexões
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    console.error('[alusadb] Pool de conexões fechado');
  }
}
