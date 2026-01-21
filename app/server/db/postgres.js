// PostgreSQL adapter para deploy online
const { Pool } = require('pg');
const config = require('../config');

let pool = null;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
  }
  return pool;
}

// Schema PostgreSQL
const schema = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(100) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  wallet_solana VARCHAR(255),
  wallet_evm VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS viewed_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  contract_address VARCHAR(255) NOT NULL,
  chain VARCHAR(50) NOT NULL,
  symbol VARCHAR(50),
  name VARCHAR(255),
  price_when_viewed DECIMAL(30, 18),
  mcap_when_viewed DECIMAL(30, 2),
  current_price DECIMAL(30, 18),
  current_mcap DECIMAL(30, 2),
  viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  bought BOOLEAN DEFAULT FALSE,
  source VARCHAR(100),
  url TEXT,
  pnl_sol DECIMAL(20, 8),
  pnl_currency VARCHAR(10),
  ath_price DECIMAL(30, 18),
  ath_mcap DECIMAL(30, 2),
  ath_date TIMESTAMP,
  dev_dump_detected BOOLEAN DEFAULT FALSE,
  dev_dump_percent DECIMAL(10, 2),
  dev_dump_date TIMESTAMP,
  UNIQUE(user_id, contract_address, chain, DATE(viewed_at))
);

CREATE TABLE IF NOT EXISTS price_history (
  id SERIAL PRIMARY KEY,
  token_id INTEGER REFERENCES viewed_tokens(id),
  price DECIMAL(30, 18),
  mcap DECIMAL(30, 2),
  price_change_24h DECIMAL(10, 2),
  volume_24h DECIMAL(30, 2),
  checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS settings (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  key VARCHAR(100) NOT NULL,
  value TEXT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, key)
);

CREATE TABLE IF NOT EXISTS my_trades (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id),
  contract_address VARCHAR(255) NOT NULL,
  chain VARCHAR(50) NOT NULL,
  action VARCHAR(10) NOT NULL,
  quantity DECIMAL(30, 18),
  price_per_unit DECIMAL(30, 18),
  value_native DECIMAL(20, 8),
  native_currency VARCHAR(10),
  mcap_at_trade DECIMAL(30, 2),
  dex VARCHAR(100),
  traded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_viewed_tokens_user ON viewed_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_viewed_tokens_contract ON viewed_tokens(contract_address, chain);
CREATE INDEX IF NOT EXISTS idx_price_history_token ON price_history(token_id);
CREATE INDEX IF NOT EXISTS idx_settings_user ON settings(user_id);
`;

async function initDatabase() {
  const pool = getPool();
  try {
    await pool.query(schema);
    console.log('[PostgreSQL] Database initialized');
  } catch (error) {
    console.error('[PostgreSQL] Error initializing:', error);
    throw error;
  }
}

// Helper functions para manter compatibilidade com SQLite
async function queryAll(sql, params = [], userId = null) {
  const pool = getPool();
  // Converte ? para $1, $2, etc (PostgreSQL style)
  let pgSql = sql;
  let paramIndex = 1;
  pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

  // Adiciona user_id filter se necessário
  if (userId && sql.includes('viewed_tokens') && !sql.includes('user_id')) {
    // Não modifica automaticamente - deixa pra query específica
  }

  const result = await pool.query(pgSql, params);
  return result.rows;
}

async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

async function run(sql, params = []) {
  const pool = getPool();
  let pgSql = sql;
  let paramIndex = 1;
  pgSql = pgSql.replace(/\?/g, () => `$${paramIndex++}`);

  // Trata RETURNING para INSERT
  if (pgSql.toUpperCase().startsWith('INSERT') && !pgSql.includes('RETURNING')) {
    pgSql += ' RETURNING id';
  }

  const result = await pool.query(pgSql, params);
  return {
    lastInsertRowid: result.rows[0]?.id,
    rowCount: result.rowCount
  };
}

// Cria ou busca usuário por wallet
async function getOrCreateUser(walletAddress) {
  let user = await queryOne('SELECT * FROM users WHERE wallet_address = ?', [walletAddress]);

  if (!user) {
    const result = await run('INSERT INTO users (wallet_address) VALUES (?)', [walletAddress]);
    user = { id: result.lastInsertRowid, wallet_address: walletAddress };
  }

  return user;
}

module.exports = {
  getPool,
  initDatabase,
  queryAll,
  queryOne,
  run,
  getOrCreateUser
};
