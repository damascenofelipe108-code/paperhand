// Regret Minimizer - Wallet Service
// Verifica transações do usuário usando Cielo Finance API

const fetch = require('node-fetch');

// Cielo Finance API
const CIELO_API_KEY = 'fd18624f-271e-41ab-ad0b-a5f6dba4e126';
const CIELO_BASE_URL = 'https://feed-api.cielo.finance/api/v1/feed';

// Helius API para Solana (alternativa)
const HELIUS_API_KEY = '0e541cd9-6780-402d-a36c-e449c1eaa8f5';
const HELIUS_BASE_URL = 'https://api-mainnet.helius-rpc.com/v0';

// Mapeamento de chains para o formato da Cielo
const CHAIN_MAP = {
  'solana': 'solana',
  'base': 'base',
  'bsc': 'bsc',
  'eth': 'ethereum'
};

/**
 * Verifica se o usuário comprou um determinado token usando Cielo Finance API
 * @param {string} tokenAddress - Endereço do token
 * @param {string} chain - Chain do token
 * @param {Object} wallets - Objeto com wallets do usuário { solana: 'xxx', evm: 'xxx' }
 * @param {string} tokenSymbol - Símbolo do token (opcional, para comparação por nome)
 * @returns {boolean} true se comprou
 */
// Cache de transações recentes para evitar múltiplas chamadas
let recentTxCache = {
  solana: { data: null, timestamp: 0 },
  base: { data: null, timestamp: 0 },
  bsc: { data: null, timestamp: 0 },
  eth: { data: null, timestamp: 0 }
};
const CACHE_TTL = 60000; // 1 minuto

async function checkIfBought(tokenAddress, chain, wallets, tokenSymbol = null) {
  try {
    // Seleciona a wallet correta baseado na chain
    const wallet = chain === 'solana' ? wallets.solana : wallets.evm;

    if (!wallet) {
      console.log(`[Wallet Service] Wallet não configurada para ${chain}`);
      return false;
    }

    const cieloChain = CHAIN_MAP[chain];
    if (!cieloChain) {
      console.log(`[Wallet Service] Chain não suportada: ${chain}`);
      return false;
    }

    // Verifica cache
    const now = Date.now();
    const cacheKey = `${chain}_${wallet}`;
    let transactions;

    if (recentTxCache[chain].data && (now - recentTxCache[chain].timestamp) < CACHE_TTL) {
      transactions = recentTxCache[chain].data;
      console.log(`[Wallet Service] Usando cache para ${chain}`);
    } else {
      // Busca todas as transações recentes SEM filtro de token
      const params = new URLSearchParams({
        wallet: wallet,
        chains: cieloChain,
        txTypes: 'swap',
        limit: '100'
      });

      const url = `${CIELO_BASE_URL}?${params.toString()}`;
      console.log(`[Wallet Service] Buscando transações ${chain} para wallet ${wallet.slice(0,8)}...`);

      const response = await fetch(url, {
        headers: {
          'X-API-KEY': CIELO_API_KEY,
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.log(`[Wallet Service] Cielo API erro: ${response.status} - ${errorText}`);
        return false;
      }

      const data = await response.json();
      transactions = data.data?.items || [];

      // Atualiza cache
      recentTxCache[chain] = { data: transactions, timestamp: now };
      console.log(`[Wallet Service] Cache atualizado para ${chain}: ${transactions.length} transações`);
    }

    // Verifica se alguma transação envolve o token (por endereço OU por símbolo)
    const tokenLower = tokenAddress.toLowerCase();

    // Extrai todos os tokens das transações para log
    const tradedTokens = new Set();
    transactions.forEach(tx => {
      if (tx.token0_symbol) tradedTokens.add(tx.token0_symbol.toUpperCase());
      if (tx.token1_symbol) tradedTokens.add(tx.token1_symbol.toUpperCase());
    });

    // Remove tokens comuns (SOL, USDC, etc)
    ['SOL', 'WSOL', 'USDC', 'USDT', 'USD1'].forEach(t => tradedTokens.delete(t));

    console.log(`[Wallet Service] Tokens tradados em ${chain}:`, Array.from(tradedTokens).slice(0, 10).join(', '));

    // Primeiro tenta por endereço
    let found = transactions.some(tx => {
      const t0 = (tx.token0_address || '').toLowerCase();
      const t1 = (tx.token1_address || '').toLowerCase();
      return t0 === tokenLower || t1 === tokenLower;
    });

    // Se não encontrou por endereço e tem símbolo, tenta por símbolo EXATO apenas
    if (!found && tokenSymbol && tokenSymbol.length >= 3) {
      const symbolUpper = tokenSymbol.toUpperCase();
      found = transactions.some(tx => {
        const s0 = (tx.token0_symbol || '').toUpperCase();
        const s1 = (tx.token1_symbol || '').toUpperCase();
        // Compara apenas se o símbolo é EXATAMENTE igual (evita falsos positivos)
        return s0 === symbolUpper || s1 === symbolUpper;
      });

      if (found) {
        console.log(`[Wallet Service] COMPRA DETECTADA por símbolo exato '${tokenSymbol}' em ${chain}`);
      }
    }

    if (found && !tokenSymbol) {
      console.log(`[Wallet Service] COMPRA DETECTADA: ${tokenAddress.slice(0,8)} em ${chain}`);
    }

    return found;
  } catch (error) {
    console.error(`[Wallet Service] Erro ao verificar compra via Cielo:`, error.message);
    return false;
  }
}

/**
 * Busca todas as transações de um token para uma wallet via Cielo
 * Retorna dados completos com preços, quantidades e tipo (buy/sell)
 * @param {string} tokenAddress
 * @param {string} chain
 * @param {Object} wallets
 * @returns {Array} Transações formatadas
 */
async function getTokenTransactions(tokenAddress, chain, wallets) {
  try {
    const wallet = chain === 'solana' ? wallets.solana : wallets.evm;

    if (!wallet) return [];

    const cieloChain = CHAIN_MAP[chain];
    if (!cieloChain) return [];

    const params = new URLSearchParams({
      wallet: wallet,
      chains: cieloChain,
      tokens: tokenAddress,
      txTypes: 'swap',
      limit: '100'
    });

    const url = `${CIELO_BASE_URL}?${params.toString()}`;

    const response = await fetch(url, {
      headers: {
        'X-API-KEY': CIELO_API_KEY,
        'Accept': 'application/json'
      }
    });

    if (!response.ok) return [];

    const data = await response.json();
    const rawTxs = data.data?.items || [];

    // Formata transações com dados corretos
    return rawTxs.map(tx => formatTransaction(tx, tokenAddress, chain));
  } catch (error) {
    console.error(`[Wallet Service] Erro ao buscar transações:`, error.message);
    return [];
  }
}

/**
 * Formata uma transação da Cielo API para nosso formato
 * @param {Object} tx - Transação raw da API
 * @param {string} tokenAddress - Endereço do token alvo
 * @param {string} chain - Chain
 * @returns {Object} Transação formatada
 */
function formatTransaction(tx, tokenAddress, chain, tokenSymbol = null) {
  // Usa o campo is_sell da API para determinar ação
  // is_sell = true significa que estamos vendendo token0 para receber token1
  const isSell = tx.is_sell === true;

  // Determina qual token é o nosso alvo (por endereço OU símbolo)
  const token0Lower = (tx.token0_address || '').toLowerCase();
  const token1Lower = (tx.token1_address || '').toLowerCase();
  const targetLower = tokenAddress.toLowerCase();
  const symbolUpper = tokenSymbol?.toUpperCase();
  const t0Symbol = (tx.token0_symbol || '').toUpperCase();
  const t1Symbol = (tx.token1_symbol || '').toUpperCase();

  // Verifica match por endereço ou símbolo
  const isToken0 = token0Lower === targetLower || (symbolUpper && t0Symbol === symbolUpper);
  const isToken1 = token1Lower === targetLower || (symbolUpper && t1Symbol === symbolUpper);

  // Se token0 é o alvo e estamos vendendo, é uma venda do nosso token
  // Se token1 é o alvo e NÃO estamos vendendo, é uma compra do nosso token
  let action, quantity, pricePerUnit, valueUsd, valueNative, nativeCurrency;

  if (isToken0) {
    // Token alvo está em token0
    if (isSell) {
      // Vendemos token0 (nosso token) para receber token1
      action = 'sell';
      quantity = tx.token0_amount || 0;
      pricePerUnit = tx.token0_price_usd || 0;
      valueUsd = tx.token0_amount_usd || 0;
      // Recebemos token1 (moeda nativa ou stable)
      valueNative = tx.token1_amount || 0;
      nativeCurrency = tx.token1_symbol || 'USD';
    } else {
      // Compramos token0 (nosso token) com token1
      action = 'buy';
      quantity = tx.token0_amount || 0;
      pricePerUnit = tx.token0_price_usd || 0;
      valueUsd = tx.token0_amount_usd || 0;
      valueNative = tx.token1_amount || 0;
      nativeCurrency = tx.token1_symbol || 'USD';
    }
  } else if (isToken1) {
    // Token alvo está em token1
    if (isSell) {
      // Vendemos token0 para receber token1 (nosso token) = compramos nosso token
      action = 'buy';
      quantity = tx.token1_amount || 0;
      pricePerUnit = tx.token1_price_usd || 0;
      valueUsd = tx.token1_amount_usd || 0;
      valueNative = tx.token0_amount || 0;
      nativeCurrency = tx.token0_symbol || 'USD';
    } else {
      // Compramos token0 com token1 (nosso token) = vendemos nosso token
      action = 'sell';
      quantity = tx.token1_amount || 0;
      pricePerUnit = tx.token1_price_usd || 0;
      valueUsd = tx.token1_amount_usd || 0;
      valueNative = tx.token0_amount || 0;
      nativeCurrency = tx.token0_symbol || 'USD';
    }
  } else {
    // Token não encontrado na transação
    action = 'unknown';
    quantity = 0;
    pricePerUnit = 0;
    valueUsd = 0;
    valueNative = 0;
    nativeCurrency = 'USD';
  }

  // Normaliza moeda nativa
  if (['SOL', 'WSOL'].includes(nativeCurrency)) nativeCurrency = 'SOL';
  if (['ETH', 'WETH'].includes(nativeCurrency)) nativeCurrency = 'ETH';
  if (['BNB', 'WBNB'].includes(nativeCurrency)) nativeCurrency = 'BNB';

  return {
    tx_hash: tx.tx_hash,
    action,
    quantity,
    price_per_unit: pricePerUnit,
    value_usd: valueUsd,
    value_native: valueNative,
    native_currency: nativeCurrency,
    dex: tx.dex || null,
    timestamp: tx.timestamp ? new Date(tx.timestamp * 1000).toISOString() : new Date().toISOString(),
    first_interaction: tx.first_interaction || false
  };
}

/**
 * Sincroniza trades do usuário com a base de dados
 * Usa os dados formatados corretamente da Cielo API
 * @param {Function} run - Função para executar SQL
 * @param {Function} queryOne - Função para buscar um registro
 * @param {Object} wallets - Wallets do usuário
 * @param {Array} tokens - Lista de tokens para verificar
 * @returns {Object} Resumo da sincronização
 */
async function syncTrades(run, queryOne, wallets, tokens) {
  let synced = 0;
  let errors = 0;

  for (const token of tokens) {
    try {
      const transactions = await getTokenTransactions(
        token.contract_address,
        token.chain,
        wallets
      );

      for (const tx of transactions) {
        // Verifica se já existe
        const existing = queryOne(
          'SELECT id FROM my_trades WHERE tx_hash = ?',
          [tx.tx_hash]
        );

        if (!existing && tx.tx_hash && tx.action !== 'unknown') {
          run(`
            INSERT INTO my_trades (
              contract_address, chain, action, quantity, price_per_unit,
              value_usd, value_native, native_currency, dex, tx_hash, traded_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            token.contract_address,
            token.chain,
            tx.action,
            tx.quantity,
            tx.price_per_unit,
            tx.value_usd,
            tx.value_native,
            tx.native_currency,
            tx.dex,
            tx.tx_hash,
            tx.timestamp
          ]);
          synced++;
          console.log(`[Wallet Service] Trade sincronizado: ${tx.action} ${tx.quantity} ${token.symbol || token.contract_address.slice(0,8)} por ${tx.value_native} ${tx.native_currency}`);
        }
      }

      // Rate limit
      await new Promise(resolve => setTimeout(resolve, 300));
    } catch (error) {
      errors++;
      console.error(`[Wallet Service] Erro ao sincronizar ${token.contract_address}:`, error.message);
    }
  }

  return { synced, errors };
}

/**
 * Calcula lucro perdido para um token (diferença entre venda real e ATH)
 * @param {Array} trades - Trades do token
 * @param {number} athPrice - Preço ATH do token
 * @returns {Object} Lucro perdido em moeda nativa
 */
function calculateMissedProfit(trades, athPrice) {
  if (!trades || trades.length === 0 || !athPrice) {
    return { missed: 0, currency: 'USD' };
  }

  // Separa compras e vendas
  const buys = trades.filter(t => t.action === 'buy');
  const sells = trades.filter(t => t.action === 'sell');

  if (buys.length === 0 || sells.length === 0) {
    return { missed: 0, currency: 'USD' };
  }

  // Calcula quantidade total comprada e vendida
  const totalBought = buys.reduce((sum, t) => sum + (t.quantity || 0), 0);
  const totalSold = sells.reduce((sum, t) => sum + (t.quantity || 0), 0);

  // Preço médio de compra
  const totalSpent = buys.reduce((sum, t) => sum + (t.value_native || 0), 0);
  const avgBuyPrice = totalSpent / totalBought;

  // Valor recebido nas vendas
  const totalReceived = sells.reduce((sum, t) => sum + (t.value_native || 0), 0);

  // Valor que teria recebido se vendesse no ATH
  // Assumindo que venderia a mesma quantidade no ATH
  const avgSellPricePerUnit = sells.reduce((sum, t) => sum + (t.price_per_unit || 0), 0) / sells.length;
  const athMultiplier = athPrice / avgSellPricePerUnit;
  const potentialReceived = totalReceived * athMultiplier;

  // Lucro perdido = potencial - real
  const missed = potentialReceived - totalReceived;

  // Moeda nativa (assume a primeira venda)
  const currency = sells[0]?.native_currency || 'USD';

  return {
    missed: Math.max(0, missed),
    currency,
    real_profit: totalReceived - totalSpent,
    potential_profit: potentialReceived - totalSpent
  };
}

/**
 * Calcula o PNL realizado de um token usando o cache de transações
 * @param {string} tokenAddress
 * @param {string} chain
 * @param {Object} wallets
 * @param {string} tokenSymbol - Símbolo do token para busca alternativa
 * @returns {Object} { pnl, currency, buys, sells }
 */
async function calculateRealizedPnl(tokenAddress, chain, wallets, tokenSymbol = null) {
  try {
    // Primeiro garante que o cache está atualizado
    await checkIfBought(tokenAddress, chain, wallets, tokenSymbol);

    // Usa o cache para filtrar transações deste token
    const cachedTxs = recentTxCache[chain]?.data || [];

    if (cachedTxs.length === 0) {
      return { pnl: null, currency: 'SOL', buys: 0, sells: 0 };
    }

    const tokenLower = tokenAddress.toLowerCase();
    const symbolUpper = tokenSymbol?.toUpperCase();

    // Filtra transações que envolvem este token (por endereço ou símbolo)
    const tokenTxs = cachedTxs.filter(tx => {
      const t0Addr = (tx.token0_address || '').toLowerCase();
      const t1Addr = (tx.token1_address || '').toLowerCase();
      const t0Symbol = (tx.token0_symbol || '').toUpperCase();
      const t1Symbol = (tx.token1_symbol || '').toUpperCase();

      // Match por endereço
      if (t0Addr === tokenLower || t1Addr === tokenLower) return true;

      // Match por símbolo exato
      if (symbolUpper && (t0Symbol === symbolUpper || t1Symbol === symbolUpper)) return true;

      return false;
    });

    if (tokenTxs.length === 0) {
      return { pnl: null, currency: 'SOL', buys: 0, sells: 0 };
    }

    // Formata e calcula PNL (passa símbolo para match alternativo)
    const transactions = tokenTxs.map(tx => formatTransaction(tx, tokenAddress, chain, tokenSymbol));

    const buys = transactions.filter(t => t.action === 'buy');
    const sells = transactions.filter(t => t.action === 'sell');

    // Total gasto em compras (em moeda nativa)
    const totalSpent = buys.reduce((sum, t) => sum + (t.value_native || 0), 0);

    // Total recebido em vendas (em moeda nativa)
    const totalReceived = sells.reduce((sum, t) => sum + (t.value_native || 0), 0);

    // PNL = recebido - gasto
    const pnl = totalReceived - totalSpent;

    // Moeda nativa
    const currency = transactions[0]?.native_currency || 'SOL';

    console.log(`[Wallet Service] PNL calculado para ${tokenSymbol || tokenAddress.slice(0,8)}: ${pnl.toFixed(4)} ${currency} (${buys.length} buys, ${sells.length} sells)`);

    return {
      pnl: parseFloat(pnl.toFixed(6)),
      currency,
      buys: buys.length,
      sells: sells.length,
      totalSpent,
      totalReceived
    };
  } catch (error) {
    console.error(`[Wallet Service] Erro ao calcular PNL:`, error.message);
    return { pnl: null, currency: 'SOL', buys: 0, sells: 0 };
  }
}

module.exports = {
  checkIfBought,
  getTokenTransactions,
  syncTrades,
  calculateMissedProfit,
  calculateRealizedPnl,
  formatTransaction
};
