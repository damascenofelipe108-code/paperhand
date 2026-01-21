const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const config = require('./config');
const priceService = require('./services/price');
const walletService = require('./services/wallet');
const devTracker = require('./services/devtracker');
const HeliusWebSocketManager = require('./services/helius-ws');

// Auth
const { router: authRouter, setDb: setAuthDb } = require('./routes/auth');
const { optionalAuth, authMiddleware } = require('./middleware/auth');

// Database adapter (SQLite ou PostgreSQL)
let db;
if (config.USE_POSTGRES) {
  db = require('./db/postgres');
  console.log('[Database] Usando PostgreSQL');
} else {
  db = require('./db/sqlite');
  console.log('[Database] Usando SQLite local');
}

// Cache de estado de holders para detectar dev dumps
const holdersStateCache = new Map();

// Valores booleanos compatíveis com o banco de dados
const DB_TRUE = config.USE_POSTGRES ? 'true' : '1';
const DB_FALSE = config.USE_POSTGRES ? 'false' : '0';

// WebSocket manager para detecção de transações em tempo real
let heliusWsManager = null;

const app = express();
const PORT = config.PORT;

// Middleware - CORS permissivo (app próprio + extensões Chrome)
app.use(cors({
  origin: true,  // Permite todas as origens
  credentials: true
}));
app.use(express.json());
app.use(optionalAuth);

// Auth routes
app.use('/api/auth', authRouter);

// ==================== SSE (Server-Sent Events) ====================
const sseClients = new Map();

app.get('/api/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.write('event: connected\ndata: {"status":"ok"}\n\n');

  // SSE não suporta headers, então aceita token via query param
  let userId = req.user?.id || null;
  if (!userId && req.query.token) {
    const { verifyToken } = require('./middleware/auth');
    const decoded = verifyToken(req.query.token);
    if (decoded) {
      userId = decoded.userId;
    }
  }

  const clientId = Date.now();
  sseClients.set(clientId, { res, userId });
  console.log(`[SSE] Cliente conectado: ${clientId} (user: ${userId}, total: ${sseClients.size})`);

  req.on('close', () => {
    sseClients.delete(clientId);
    console.log(`[SSE] Cliente desconectado: ${clientId} (total: ${sseClients.size})`);
  });
});

// Notifica clientes SSE (apenas do mesmo usuário em produção)
function notifyClients(event, data, userId = null) {
  sseClients.forEach((client, id) => {
    try {
      // Em produção, só notifica o usuário específico
      if (config.USE_POSTGRES && userId && client.userId !== userId) {
        return;
      }
      client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch (e) {
      sseClients.delete(id);
    }
  });
}

// Helper para pegar userId (default 1 em desenvolvimento local)
function getUserId(req) {
  return req.user?.id || 1;
}

// ==================== INICIALIZAÇÃO ====================

async function initDatabase() {
  await db.initDatabase();

  // Configura auth db adapter
  setAuthDb({
    queryOne: (sql, params) => db.queryOne(sql, params),
    queryAll: (sql, params) => db.queryAll(sql, params),
    run: (sql, params) => db.run(sql, params),
    getOrCreateUser: db.getOrCreateUser
  });
}

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    database: config.USE_POSTGRES ? 'postgres' : 'sqlite',
    environment: config.NODE_ENV
  });
});

// ==================== TOKENS ====================

// Registra token visualizado
app.post('/api/tokens/viewed', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { contract_address, chain, source, url, name, symbol, mcap, pnl_sol, pnl_currency } = req.body;

    if (!contract_address || !chain) {
      return res.status(400).json({ error: 'contract_address e chain são obrigatórios' });
    }

    // Busca preço atual (apenas se não tiver mcap da extensão)
    let priceData = null;
    if (!mcap) {
      try {
        priceData = await priceService.getTokenPrice(contract_address, chain);
      } catch (e) {
        console.error('Erro ao buscar preço:', e.message);
      }
    }

    const tokenName = name || priceData?.name || null;
    const tokenSymbol = symbol || priceData?.symbol || null;
    const tokenMcap = mcap || priceData?.mcap || null;

    // Verifica se já existe hoje para este usuário
    const existingQuery = config.USE_POSTGRES
      ? `SELECT id FROM viewed_tokens WHERE user_id = ? AND contract_address = ? AND chain = ? AND viewed_at::date = CURRENT_DATE`
      : `SELECT id FROM viewed_tokens WHERE user_id = ? AND contract_address = ? AND chain = ? AND date(viewed_at) = date('now')`;
    const existing = await db.queryOne(existingQuery, [userId, contract_address, chain]);

    let tokenId;
    let isNewToken = false;

    if (existing) {
      await db.run(
        `UPDATE viewed_tokens SET viewed_at = CURRENT_TIMESTAMP,
         price_when_viewed = COALESCE(?, price_when_viewed),
         mcap_when_viewed = COALESCE(?, mcap_when_viewed),
         name = COALESCE(?, name),
         symbol = COALESCE(?, symbol),
         pnl_sol = COALESCE(?, pnl_sol),
         pnl_currency = COALESCE(?, pnl_currency)
         WHERE id = ?`,
        [priceData?.priceUsd || null, tokenMcap, tokenName, tokenSymbol, pnl_sol || null, pnl_currency || null, existing.id]
      );
      tokenId = existing.id;
    } else {
      const result = await db.run(
        `INSERT INTO viewed_tokens (user_id, contract_address, chain, symbol, name, price_when_viewed, mcap_when_viewed, source, url, pnl_sol, pnl_currency)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [userId, contract_address, chain, tokenSymbol, tokenName, priceData?.priceUsd || null, tokenMcap, source, url, pnl_sol || null, pnl_currency || null]
      );
      tokenId = result.lastInsertRowid;
      isNewToken = true;
    }

    // Verifica se comprou via API
    let bought = false;
    const settings = await db.queryOne('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'wallets']);
    if (settings) {
      try {
        const wallets = JSON.parse(settings.value);
        bought = await walletService.checkIfBought(contract_address, chain, wallets, tokenSymbol);
        if (bought) {
          await db.run(`UPDATE viewed_tokens SET bought = ${DB_TRUE} WHERE id = ?`, [tokenId]);
          console.log(`[Token] Compra confirmada para ${tokenSymbol || contract_address.slice(0,8)}`);
        }
      } catch (e) {
        console.error('Erro ao verificar compra:', e.message);
      }
    }

    if (!config.USE_POSTGRES && db.saveDb) db.saveDb();

    // Busca token atualizado
    const updatedToken = await db.queryOne(`
      SELECT vt.*,
             ph.price as current_price,
             ph.mcap as current_mcap,
             CASE
               WHEN vt.price_when_viewed > 0 AND ph.price IS NOT NULL
               THEN ((ph.price - vt.price_when_viewed) / vt.price_when_viewed) * 100
               ELSE 0
             END as price_change_percent
      FROM viewed_tokens vt
      LEFT JOIN (SELECT DISTINCT ON (token_id) token_id, price, mcap, checked_at FROM price_history ORDER BY token_id, checked_at DESC) ph ON ph.token_id = vt.id
      WHERE vt.id = ?
    `, [tokenId]);

    // Notifica via SSE
    if (isNewToken) {
      notifyClients('new-token', updatedToken, userId);
      console.log(`[SSE] Novo token notificado: ${tokenName || contract_address}`);
    } else {
      notifyClients('token-updated', updatedToken, userId);
    }

    res.json({
      success: true,
      id: tokenId,
      bought,
      token: { contract_address, chain, name: tokenName, symbol: tokenSymbol, mcap: tokenMcap }
    });
  } catch (error) {
    console.error('Erro ao registrar token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Lista tokens recentes
app.get('/api/tokens/recent', async (req, res) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit) || 20;
    const offset = parseInt(req.query.offset) || 0;

    const tokens = await db.queryAll(`
      SELECT vt.*,
             ph.price as current_price,
             ph.mcap as current_mcap,
             CASE
               WHEN vt.price_when_viewed > 0 AND ph.price IS NOT NULL
               THEN ((ph.price - vt.price_when_viewed) / vt.price_when_viewed) * 100
               ELSE 0
             END as price_change_percent
      FROM viewed_tokens vt
      LEFT JOIN (SELECT DISTINCT ON (token_id) token_id, price, mcap, checked_at FROM price_history ORDER BY token_id, checked_at DESC) ph ON ph.token_id = vt.id
      WHERE vt.user_id = ?
      ORDER BY vt.viewed_at DESC
      LIMIT ? OFFSET ?
    `, [userId, limit, offset]);

    res.json(tokens);
  } catch (error) {
    console.error('Erro ao listar tokens:', error);
    res.status(500).json({ error: error.message });
  }
});

// Detalhes de um token
app.get('/api/tokens/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const token = await db.queryOne('SELECT * FROM viewed_tokens WHERE id = ? AND user_id = ?', [req.params.id, userId]);

    if (!token) {
      return res.status(404).json({ error: 'Token não encontrado' });
    }

    const priceHistory = await db.queryAll(
      'SELECT * FROM price_history WHERE token_id = ? ORDER BY checked_at DESC LIMIT 100',
      [req.params.id]
    );

    res.json({ ...token, priceHistory });
  } catch (error) {
    console.error('Erro ao buscar token:', error);
    res.status(500).json({ error: error.message });
  }
});

// Limpa todos os tokens do usuário
app.delete('/api/tokens/clear', async (req, res) => {
  try {
    const userId = getUserId(req);

    // Deleta price_history dos tokens do usuário
    await db.run(`
      DELETE FROM price_history WHERE token_id IN (
        SELECT id FROM viewed_tokens WHERE user_id = ?
      )
    `, [userId]);

    await db.run('DELETE FROM viewed_tokens WHERE user_id = ?', [userId]);

    if (!config.USE_POSTGRES && db.saveDb) db.saveDb();
    res.json({ success: true, message: 'Todos os tokens foram removidos' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Re-verifica compras de todos os tokens
app.post('/api/tokens/recheck-purchases', async (req, res) => {
  try {
    const userId = getUserId(req);
    const settings = await db.queryOne('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'wallets']);

    if (!settings) {
      return res.status(400).json({ error: 'Wallets não configuradas' });
    }

    const wallets = JSON.parse(settings.value);
    const tokens = await db.queryAll(`SELECT id, contract_address, chain, name, symbol FROM viewed_tokens WHERE user_id = ? AND bought = ${DB_FALSE}`, [userId]);

    console.log(`[Recheck] Verificando ${tokens.length} tokens...`);

    let updated = 0;
    for (const token of tokens) {
      try {
        const bought = await walletService.checkIfBought(token.contract_address, token.chain, wallets, token.symbol || token.name);

        if (bought) {
          const pnlData = await walletService.calculateRealizedPnl(token.contract_address, token.chain, wallets, token.symbol || token.name);
          await db.run(`UPDATE viewed_tokens SET bought = ${DB_TRUE}, pnl_sol = ?, pnl_currency = ? WHERE id = ?`, [pnlData.pnl, pnlData.currency, token.id]);
          updated++;

          const updatedToken = await db.queryOne('SELECT * FROM viewed_tokens WHERE id = ?', [token.id]);
          notifyClients('token-updated', updatedToken, userId);
        }

        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.error(`[Recheck] Erro em ${token.contract_address}:`, e.message);
      }
    }

    if (!config.USE_POSTGRES && db.saveDb) db.saveDb();
    res.json({ success: true, checked: tokens.length, updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Atualiza PNL de tokens comprados
app.post('/api/tokens/refresh-pnl', async (req, res) => {
  try {
    const userId = getUserId(req);
    const settings = await db.queryOne('SELECT value FROM settings WHERE user_id = ? AND key = ?', [userId, 'wallets']);

    if (!settings) {
      return res.status(400).json({ error: 'Wallets não configuradas' });
    }

    const wallets = JSON.parse(settings.value);
    const tokens = await db.queryAll(`SELECT id, contract_address, chain, name, symbol FROM viewed_tokens WHERE user_id = ? AND bought = ${DB_TRUE}`, [userId]);

    let updated = 0;
    for (const token of tokens) {
      try {
        const pnlData = await walletService.calculateRealizedPnl(token.contract_address, token.chain, wallets, token.symbol || token.name);
        if (pnlData.pnl !== null) {
          await db.run('UPDATE viewed_tokens SET pnl_sol = ?, pnl_currency = ? WHERE id = ?', [pnlData.pnl, pnlData.currency, token.id]);
          updated++;
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      } catch (e) {
        console.error(`[PNL Refresh] Erro em ${token.contract_address}:`, e.message);
      }
    }

    if (!config.USE_POSTGRES && db.saveDb) db.saveDb();
    res.json({ success: true, checked: tokens.length, updated });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Reseta status de comprado
app.post('/api/tokens/:id/reset-bought', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    await db.run(`UPDATE viewed_tokens SET bought = ${DB_FALSE}, pnl_sol = NULL WHERE id = ? AND user_id = ?`, [id, userId]);
    if (!config.USE_POSTGRES && db.saveDb) db.saveDb();

    const token = await db.queryOne('SELECT * FROM viewed_tokens WHERE id = ? AND user_id = ?', [id, userId]);
    notifyClients('token-updated', token, userId);
    res.json({ success: true, token });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Deleta um token
app.delete('/api/tokens/:id', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { id } = req.params;

    await db.run('DELETE FROM price_history WHERE token_id = ?', [id]);
    await db.run('DELETE FROM viewed_tokens WHERE id = ? AND user_id = ?', [id, userId]);

    if (!config.USE_POSTGRES && db.saveDb) db.saveDb();
    notifyClients('token-deleted', { id }, userId);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== STATS ====================

app.get('/api/stats', async (req, res) => {
  try {
    const userId = getUserId(req);

    const todayQuery = config.USE_POSTGRES
      ? `SELECT COUNT(*) as count FROM viewed_tokens WHERE user_id = ? AND viewed_at::date = CURRENT_DATE`
      : `SELECT COUNT(*) as count FROM viewed_tokens WHERE user_id = ? AND date(viewed_at) = date('now')`;
    const today = await db.queryOne(todayQuery, [userId]);

    const total = await db.queryOne('SELECT COUNT(*) as count FROM viewed_tokens WHERE user_id = ?', [userId]);

    // Lucro perdido
    const tradesWithAth = await db.queryAll(`
      SELECT vt.id, vt.contract_address, vt.chain, vt.ath_price, vt.ath_mcap,
             mt.action, mt.quantity, mt.price_per_unit, mt.value_native, mt.native_currency
      FROM viewed_tokens vt
      INNER JOIN my_trades mt ON mt.contract_address = vt.contract_address AND mt.chain = vt.chain AND mt.user_id = vt.user_id
      WHERE vt.user_id = ? AND vt.ath_price IS NOT NULL AND vt.ath_price > 0
      ORDER BY vt.id, mt.traded_at
    `, [userId]);

    const tokenTrades = {};
    tradesWithAth.forEach(row => {
      const key = `${row.contract_address}_${row.chain}`;
      if (!tokenTrades[key]) {
        tokenTrades[key] = { ath_price: row.ath_price, buys: [], sells: [] };
      }
      if (row.action === 'buy') tokenTrades[key].buys.push(row);
      else if (row.action === 'sell') tokenTrades[key].sells.push(row);
    });

    let totalMissedProfit = { SOL: 0, ETH: 0, BNB: 0 };
    let missedProfitTokens = 0;

    Object.values(tokenTrades).forEach(token => {
      if (token.buys.length > 0 && token.sells.length > 0) {
        const totalReceived = token.sells.reduce((sum, s) => sum + (s.value_native || 0), 0);
        const avgSellPrice = token.sells.reduce((sum, s) => sum + (s.price_per_unit || 0), 0) / token.sells.length;

        if (avgSellPrice > 0 && token.ath_price > avgSellPrice) {
          const athMultiplier = token.ath_price / avgSellPrice;
          const missed = totalReceived * athMultiplier - totalReceived;
          if (missed > 0) {
            const currency = token.sells[0]?.native_currency || 'SOL';
            if (totalMissedProfit[currency] !== undefined) {
              totalMissedProfit[currency] += missed;
            }
            missedProfitTokens++;
          }
        }
      }
    });

    const devDumpsEvitados = await db.queryOne(`
      SELECT COUNT(*) as count FROM viewed_tokens WHERE user_id = ? AND dev_dump_detected = ${DB_TRUE} AND bought = ${DB_FALSE}
    `, [userId]);

    const rugsEvitados = await db.queryOne(`
      SELECT COUNT(*) as count
      FROM viewed_tokens vt
      LEFT JOIN (SELECT DISTINCT ON (token_id) token_id, price, mcap, checked_at FROM price_history ORDER BY token_id, checked_at DESC) ph ON ph.token_id = vt.id
      WHERE vt.user_id = ? AND vt.bought = ${DB_FALSE} AND vt.price_when_viewed > 0
        AND (ph.price < vt.price_when_viewed * 0.5 OR ph.price IS NULL OR ph.price = 0)
    `, [userId]);

    const tradesWon = await db.queryOne(`SELECT COUNT(*) as count FROM viewed_tokens WHERE user_id = ? AND bought = ${DB_TRUE} AND pnl_sol > 0`, [userId]);
    const tradesLost = await db.queryOne(`SELECT COUNT(*) as count FROM viewed_tokens WHERE user_id = ? AND bought = ${DB_TRUE} AND pnl_sol < 0`, [userId]);

    const totalTrades = (tradesWon?.count || 0) + (tradesLost?.count || 0);
    const winRate = totalTrades > 0 ? ((tradesWon?.count || 0) / totalTrades * 100).toFixed(1) : 0;

    res.json({
      tokensViewedToday: today?.count || 0,
      totalTokensViewed: total?.count || 0,
      missedProfit: {
        SOL: parseFloat(totalMissedProfit.SOL.toFixed(4)),
        ETH: parseFloat(totalMissedProfit.ETH.toFixed(4)),
        BNB: parseFloat(totalMissedProfit.BNB.toFixed(4))
      },
      missedProfitTokens,
      devDumpsEvitados: devDumpsEvitados?.count || 0,
      avoidedLosses: rugsEvitados?.count || 0,
      decisionScore: (tradesWon?.count || 0) - (tradesLost?.count || 0),
      decisionAccuracy: winRate,
      tradesWon: tradesWon?.count || 0,
      tradesLost: tradesLost?.count || 0
    });
  } catch (error) {
    console.error('Erro ao calcular stats:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/stats/today', async (req, res) => {
  try {
    const userId = getUserId(req);
    const todayQuery = config.USE_POSTGRES
      ? `SELECT COUNT(*) as tokensViewed FROM viewed_tokens WHERE user_id = ? AND viewed_at::date = CURRENT_DATE`
      : `SELECT COUNT(*) as tokensViewed FROM viewed_tokens WHERE user_id = ? AND date(viewed_at) = date('now')`;
    const result = await db.queryOne(todayQuery, [userId]);
    res.json(result || { tokensViewed: 0 });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== ANÁLISES ====================

app.get('/api/analysis/patterns', async (req, res) => {
  try {
    const userId = getUserId(req);
    const patterns = [];

    const chainPattern = await db.queryAll(`
      SELECT vt.chain, COUNT(*) as total_viewed,
        SUM(CASE WHEN vt.bought = ${DB_FALSE} AND ph.price > vt.price_when_viewed * 2 THEN 1 ELSE 0 END) as missed_2x
      FROM viewed_tokens vt
      LEFT JOIN (SELECT DISTINCT ON (token_id) token_id, price, mcap, checked_at FROM price_history ORDER BY token_id, checked_at DESC) ph ON ph.token_id = vt.id
      WHERE vt.user_id = ? AND vt.price_when_viewed > 0
      GROUP BY vt.chain
      ORDER BY missed_2x DESC
    `, [userId]);

    if (chainPattern.length > 0 && chainPattern[0].missed_2x > 0) {
      patterns.push({
        type: 'chain',
        message: `Você deixou passar ${chainPattern[0].missed_2x} tokens que deram 2x+ em ${(chainPattern[0].chain || '').toUpperCase()}`,
        data: chainPattern
      });
    }

    const hourQuery = config.USE_POSTGRES
      ? `SELECT EXTRACT(HOUR FROM vt.viewed_at)::text as hour, COUNT(*) as total_viewed,
          SUM(CASE WHEN vt.bought = false AND ph.price > vt.price_when_viewed * 2 THEN 1 ELSE 0 END) as missed_2x
        FROM viewed_tokens vt
        LEFT JOIN (SELECT DISTINCT ON (token_id) token_id, price, mcap, checked_at FROM price_history ORDER BY token_id, checked_at DESC) ph ON ph.token_id = vt.id
        WHERE vt.user_id = ? AND vt.price_when_viewed > 0
        GROUP BY EXTRACT(HOUR FROM vt.viewed_at)
        HAVING SUM(CASE WHEN vt.bought = false AND ph.price > vt.price_when_viewed * 2 THEN 1 ELSE 0 END) > 0
        ORDER BY missed_2x DESC
        LIMIT 3`
      : `SELECT strftime('%H', vt.viewed_at) as hour, COUNT(*) as total_viewed,
          SUM(CASE WHEN vt.bought = 0 AND ph.price > vt.price_when_viewed * 2 THEN 1 ELSE 0 END) as missed_2x
        FROM viewed_tokens vt
        LEFT JOIN (SELECT DISTINCT ON (token_id) token_id, price, mcap, checked_at FROM price_history ORDER BY token_id, checked_at DESC) ph ON ph.token_id = vt.id
        WHERE vt.user_id = ? AND vt.price_when_viewed > 0
        GROUP BY strftime('%H', vt.viewed_at)
        HAVING missed_2x > 0
        ORDER BY missed_2x DESC
        LIMIT 3`;
    const hourPattern = await db.queryAll(hourQuery, [userId]);

    if (hourPattern.length > 0) {
      const worstHours = hourPattern.map(h => `${h.hour}h`).join(', ');
      patterns.push({
        type: 'hour',
        message: `Você deixa passar mais oportunidades nos horários: ${worstHours}`,
        data: hourPattern
      });
    }

    res.json(patterns);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analysis/score', async (req, res) => {
  try {
    const userId = getUserId(req);

    const correct = await db.queryOne(`
      SELECT COUNT(*) as count FROM viewed_tokens vt
      LEFT JOIN (SELECT DISTINCT ON (token_id) token_id, price, mcap, checked_at FROM price_history ORDER BY token_id, checked_at DESC) ph ON ph.token_id = vt.id
      WHERE vt.user_id = ? AND vt.bought = ${DB_FALSE} AND vt.price_when_viewed > 0
        AND (ph.price < vt.price_when_viewed * 0.5 OR ph.price IS NULL)
    `, [userId]);

    const wrong = await db.queryOne(`
      SELECT COUNT(*) as count FROM viewed_tokens vt
      LEFT JOIN (SELECT DISTINCT ON (token_id) token_id, price, mcap, checked_at FROM price_history ORDER BY token_id, checked_at DESC) ph ON ph.token_id = vt.id
      WHERE vt.user_id = ? AND vt.bought = ${DB_FALSE} AND vt.price_when_viewed > 0 AND ph.price > vt.price_when_viewed * 2
    `, [userId]);

    const c = correct?.count || 0;
    const w = wrong?.count || 0;
    const total = c + w;

    res.json({
      score: c - w,
      correct: c,
      wrong: w,
      total,
      accuracy: total > 0 ? ((c / total) * 100).toFixed(1) : 0
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/analysis/missed-profits', async (req, res) => {
  try {
    const userId = getUserId(req);

    const tokens = await db.queryAll(`
      SELECT vt.*, ph.price as current_price,
        ((ph.price - vt.price_when_viewed) / vt.price_when_viewed) * 100 as change_percent
      FROM viewed_tokens vt
      LEFT JOIN (SELECT DISTINCT ON (token_id) token_id, price, mcap, checked_at FROM price_history ORDER BY token_id, checked_at DESC) ph ON ph.token_id = vt.id
      WHERE vt.user_id = ? AND vt.bought = ${DB_FALSE} AND vt.price_when_viewed > 0 AND ph.price > vt.price_when_viewed
      ORDER BY change_percent DESC
      LIMIT 20
    `, [userId]);

    res.json(tokens);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SETTINGS ====================

app.get('/api/settings', async (req, res) => {
  try {
    const userId = getUserId(req);
    const settings = await db.queryAll('SELECT key, value FROM settings WHERE user_id = ?', [userId]);

    const result = {};
    settings.forEach(s => {
      try {
        result[s.key] = JSON.parse(s.value);
      } catch {
        result[s.key] = s.value;
      }
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const userId = getUserId(req);
    const { key, value } = req.body;
    const valueStr = typeof value === 'object' ? JSON.stringify(value) : value;

    const existing = await db.queryOne('SELECT key FROM settings WHERE user_id = ? AND key = ?', [userId, key]);

    if (existing) {
      await db.run('UPDATE settings SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ? AND key = ?', [valueStr, userId, key]);
    } else {
      await db.run('INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?)', [userId, key, valueStr]);
    }

    if (!config.USE_POSTGRES && db.saveDb) db.saveDb();

    // Reconecta WebSocket Helius se atualizou wallets
    if (key === 'wallets' && typeof value === 'object') {
      const newSolanaWallet = value.solana;
      if (heliusWsManager) {
        heliusWsManager.updateWallet(newSolanaWallet);
      } else if (newSolanaWallet && config.HELIUS_API_KEY) {
        heliusWsManager = new HeliusWebSocketManager(onHeliusTransaction);
        heliusWsManager.connect(newSolanaWallet);
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== PRICE UPDATE JOB ====================

async function updatePrices() {
  console.log('[Price Update] Iniciando atualização de preços...');

  try {
    // Busca todos os tokens dos últimos 7 dias (de todos os usuários em produção)
    const recentQuery = config.USE_POSTGRES
      ? `SELECT id, contract_address, chain, ath_price, ath_mcap, user_id FROM viewed_tokens WHERE viewed_at > NOW() - INTERVAL '7 days'`
      : `SELECT id, contract_address, chain, ath_price, ath_mcap, user_id FROM viewed_tokens WHERE viewed_at > datetime('now', '-7 days')`;
    const tokens = await db.queryAll(recentQuery, []);

    let athUpdates = 0;
    let devDumps = 0;

    for (const token of tokens) {
      try {
        const priceData = await priceService.getTokenPrice(token.contract_address, token.chain);

        if (priceData) {
          await db.run(
            `INSERT INTO price_history (token_id, price, mcap, price_change_24h, volume_24h) VALUES (?, ?, ?, ?, ?)`,
            [token.id, priceData.priceUsd, priceData.mcap, priceData.priceChange24h, priceData.volume24h]
          );

          const currentPrice = priceData.priceUsd || 0;
          const currentMcap = priceData.mcap || 0;
          const previousAth = token.ath_price || 0;

          if (currentPrice > previousAth) {
            await db.run(
              `UPDATE viewed_tokens SET ath_price = ?, ath_mcap = ?, ath_date = CURRENT_TIMESTAMP WHERE id = ?`,
              [currentPrice, currentMcap, token.id]
            );
            athUpdates++;
          }

          // Dev dump detection (Solana only)
          if (token.chain === 'solana') {
            const previousState = holdersStateCache.get(token.contract_address);
            const dumpResult = await devTracker.detectDevDump(token.contract_address, token.chain, previousState);

            if (dumpResult.currentState) {
              holdersStateCache.set(token.contract_address, dumpResult.currentState);
            }

            if (dumpResult.detected) {
              await db.run(
                `UPDATE viewed_tokens SET dev_dump_detected = 1, dev_dump_percent = ?, dev_dump_date = CURRENT_TIMESTAMP WHERE id = ?`,
                [dumpResult.percent, token.id]
              );
              devDumps++;
            }
          }
        }

        await new Promise(resolve => setTimeout(resolve, 200));
      } catch (error) {
        console.error(`Erro ao atualizar ${token.contract_address}:`, error.message);
      }
    }

    if (!config.USE_POSTGRES && db.saveDb) db.saveDb();
    console.log(`[Price Update] ${tokens.length} tokens, ${athUpdates} ATH, ${devDumps} dev dumps`);
  } catch (error) {
    console.error('[Price Update] Erro:', error);
  }
}

// Atualiza preços a cada 15 minutos
setInterval(updatePrices, 15 * 60 * 1000);

// ==================== HELIUS WEBSOCKET ====================

function onHeliusTransaction(txData) {
  console.log(`[Helius WS] Processando transação ${txData.signature.slice(0, 16)}...`);

  txData.tokenChanges.forEach(async (change) => {
    if (change.direction === 'BUY') {
      // Busca token não comprado que corresponde
      const tokens = await db.queryAll(
        `SELECT id, name, symbol, contract_address, user_id FROM viewed_tokens WHERE contract_address = ? AND chain = ? AND bought = ${DB_FALSE}`,
        [change.mint, 'solana']
      );

      for (const token of tokens) {
        await db.run(`UPDATE viewed_tokens SET bought = ${DB_TRUE} WHERE id = ?`, [token.id]);
        if (!config.USE_POSTGRES && db.saveDb) db.saveDb();

        console.log(`[Helius WS] COMPRA DETECTADA: ${token.name || token.symbol || change.mint.slice(0, 8)}`);

        const updatedToken = await db.queryOne(`
          SELECT vt.*, ph.price as current_price, ph.mcap as current_mcap
          FROM viewed_tokens vt
          LEFT JOIN (SELECT DISTINCT ON (token_id) token_id, price, mcap, checked_at FROM price_history ORDER BY token_id, checked_at DESC) ph ON ph.token_id = vt.id
          WHERE vt.id = ?
        `, [token.id]);

        notifyClients('token-updated', updatedToken, token.user_id);
        notifyClients('purchase-detected', { token: updatedToken, transaction: txData.signature, amount: change.uiAmount }, token.user_id);
      }
    }
  });
}

async function initHeliusWebSocket() {
  if (!config.HELIUS_API_KEY) {
    console.log('[Helius WS] API key não configurada');
    return;
  }

  // Em produção, não inicia WebSocket global (cada usuário teria que ter o próprio)
  if (config.USE_POSTGRES) {
    console.log('[Helius WS] Modo produção - WebSocket desabilitado (requer implementação por usuário)');
    return;
  }

  const settings = await db.queryOne('SELECT value FROM settings WHERE user_id = ? AND key = ?', [1, 'wallets']);

  if (settings) {
    try {
      const wallets = JSON.parse(settings.value);
      if (wallets.solana) {
        heliusWsManager = new HeliusWebSocketManager(onHeliusTransaction);
        heliusWsManager.connect(wallets.solana);
      }
    } catch (e) {
      console.error('[Helius WS] Erro:', e.message);
    }
  }
}

// Serve frontend estático
const frontendPath = path.join(__dirname, '..', 'frontend', 'dist');
if (fs.existsSync(frontendPath)) {
  console.log('[Frontend] Servindo arquivos estáticos de:', frontendPath);
  app.use(express.static(frontendPath, {
    maxAge: '1d',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript');
      } else if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css');
      }
    }
  }));

  // Catch-all para SPA - apenas para rotas que não são arquivos
  app.get('*', (req, res, next) => {
    // Se for uma requisição de API ou arquivo com extensão, pula
    if (req.path.startsWith('/api') || req.path.includes('.')) {
      return next();
    }
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
} else {
  console.log('[Frontend] Pasta dist não encontrada:', frontendPath);
}

// ==================== START ====================

async function start() {
  await initDatabase();

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Paper Hands] Servidor rodando na porta ${PORT}`);
    console.log(`[Paper Hands] Ambiente: ${config.NODE_ENV}, DB: ${config.USE_POSTGRES ? 'PostgreSQL' : 'SQLite'}`);

    setTimeout(updatePrices, 5000);
    setTimeout(initHeliusWebSocket, 2000);
  });
}

start().catch(err => {
  console.error('Erro ao iniciar:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Encerrando...');
  if (!config.USE_POSTGRES && db.saveDb) db.saveDb();
  process.exit();
});

process.on('SIGTERM', () => {
  if (!config.USE_POSTGRES && db.saveDb) db.saveDb();
  process.exit();
});
