// SQLite adapter para desenvolvimento local
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

let db = null;
const dbPath = path.join(__dirname, '..', '..', 'database', 'regret.db');
const dbDir = path.dirname(dbPath);

async function initDatabase() {
  const SQL = await initSqlJs();

  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Schema SQLite
  const schema = `
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      wallet_solana TEXT,
      wallet_evm TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS viewed_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      contract_address TEXT NOT NULL,
      chain TEXT NOT NULL,
      symbol TEXT,
      name TEXT,
      price_when_viewed REAL,
      mcap_when_viewed REAL,
      current_price REAL,
      current_mcap REAL,
      viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      bought INTEGER DEFAULT 0,
      source TEXT,
      url TEXT,
      pnl_sol REAL,
      pnl_currency TEXT,
      ath_price REAL,
      ath_mcap REAL,
      ath_date DATETIME,
      dev_dump_detected INTEGER DEFAULT 0,
      dev_dump_percent REAL,
      dev_dump_date DATETIME,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_id INTEGER,
      price REAL,
      mcap REAL,
      price_change_24h REAL,
      volume_24h REAL,
      checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (token_id) REFERENCES viewed_tokens(id)
    );

    CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      key TEXT NOT NULL,
      value TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS my_trades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER,
      contract_address TEXT NOT NULL,
      chain TEXT NOT NULL,
      action TEXT NOT NULL,
      quantity REAL,
      price_per_unit REAL,
      value_native REAL,
      native_currency TEXT,
      mcap_at_trade REAL,
      dex TEXT,
      traded_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `;

  db.run(schema);
  saveDb();
  console.log('[SQLite] Database initialized');
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Auto-save a cada 30 segundos
setInterval(() => {
  if (db) saveDb();
}, 30000);

// Helper functions
function queryAll(sql, params = []) {
  const stmt = db.prepare(sql);
  if (params.length > 0) stmt.bind(params);

  const results = [];
  while (stmt.step()) {
    const row = stmt.getAsObject();
    results.push(row);
  }
  stmt.free();
  return results;
}

function queryOne(sql, params = []) {
  const results = queryAll(sql, params);
  return results.length > 0 ? results[0] : null;
}

function run(sql, params = []) {
  const cleanParams = params.map(p => p === undefined ? null : p);
  db.run(sql, cleanParams);
  return { lastInsertRowid: db.exec("SELECT last_insert_rowid()")[0]?.values[0]?.[0] };
}

// Cria ou busca usuário por username
async function getOrCreateUser(username) {
  let user = queryOne('SELECT * FROM users WHERE username = ?', [username]);

  if (!user) {
    const result = run('INSERT INTO users (username, password_hash) VALUES (?, ?)', [username, 'master']);
    user = { id: result.lastInsertRowid, username };
    saveDb();
  }

  return user;
}

function getDb() {
  return db;
}

module.exports = {
  initDatabase,
  queryAll,
  queryOne,
  run,
  saveDb,
  getOrCreateUser,
  getDb
};
