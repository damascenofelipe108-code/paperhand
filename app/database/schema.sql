-- Regret Minimizer - Database Schema

-- Tokens visualizados
CREATE TABLE IF NOT EXISTS viewed_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_address TEXT NOT NULL,
    chain TEXT NOT NULL,
    symbol TEXT,
    name TEXT,
    price_when_viewed REAL,
    mcap_when_viewed REAL,
    viewed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    source TEXT,
    url TEXT,
    bought INTEGER DEFAULT 0,
    pnl_sol REAL,
    -- ATH tracking (desde que viu o token)
    ath_price REAL,
    ath_mcap REAL,
    ath_date DATETIME,
    -- Dev dump detection
    dev_dump_detected INTEGER DEFAULT 0,
    dev_dump_percent REAL,
    dev_dump_date DATETIME
);

-- Histórico de preços
CREATE TABLE IF NOT EXISTS price_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    token_id INTEGER NOT NULL,
    price REAL,
    mcap REAL,
    price_change_24h REAL,
    volume_24h REAL,
    checked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (token_id) REFERENCES viewed_tokens(id)
);

-- Trades do usuário (para comparar com ATH)
CREATE TABLE IF NOT EXISTS my_trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    contract_address TEXT NOT NULL,
    chain TEXT NOT NULL,
    action TEXT NOT NULL,              -- 'buy' ou 'sell'
    quantity REAL,                     -- Quantidade do token
    price_per_unit REAL,               -- Preço unitário USD
    value_usd REAL,                    -- Valor total USD
    value_native REAL,                 -- Valor em SOL/ETH/BNB
    native_currency TEXT,              -- 'SOL', 'ETH', 'BNB'
    mcap_at_trade REAL,                -- Market cap no momento do trade
    tx_hash TEXT UNIQUE,
    dex TEXT,                          -- DEX usado (Raydium, Uniswap, etc)
    traded_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Configurações
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Análises calculadas
CREATE TABLE IF NOT EXISTS analysis_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    calculated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Índices para performance
CREATE INDEX IF NOT EXISTS idx_viewed_tokens_contract ON viewed_tokens(contract_address, chain);
CREATE INDEX IF NOT EXISTS idx_viewed_tokens_date ON viewed_tokens(viewed_at);
CREATE INDEX IF NOT EXISTS idx_price_history_token ON price_history(token_id);
CREATE INDEX IF NOT EXISTS idx_my_trades_contract ON my_trades(contract_address, chain);
