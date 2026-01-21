// Regret Minimizer - Dev Tracker Service
// Detecta dev dumps usando Helius API (Solana) e outras APIs

const fetch = require('node-fetch');

// Helius API (hardcoded)
const HELIUS_API_KEY = '0e541cd9-6780-402d-a36c-e449c1eaa8f5';
const HELIUS_RPC_URL = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// Cache de holders para evitar chamadas repetidas
const holdersCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutos

/**
 * Busca os top holders de um token Solana via Helius
 * @param {string} mintAddress - Endereço do token
 * @param {string} apiKey - API key do Helius (opcional, usa hardcoded se não fornecida)
 * @returns {Array} Lista de holders com percentuais
 */
async function getSolanaHolders(mintAddress, apiKey = null) {
  const heliusKey = apiKey || HELIUS_API_KEY;

  // Verifica cache
  const cacheKey = `sol_${mintAddress}`;
  const cached = holdersCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    const url = `https://mainnet.helius-rpc.com/?api-key=${heliusKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 'regret-minimizer',
        method: 'getTokenAccounts',
        params: {
          mint: mintAddress,
          limit: 20,
          options: {
            showZeroBalance: false
          }
        }
      })
    });

    if (!response.ok) {
      console.log(`[DevTracker] Helius API erro: ${response.status}`);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.log(`[DevTracker] Helius API erro: ${data.error.message}`);
      return null;
    }

    const accounts = data.result?.token_accounts || [];

    // Calcula total supply baseado nos holders
    const totalAmount = accounts.reduce((sum, acc) => sum + (acc.amount || 0), 0);

    // Formata holders com percentuais
    const holders = accounts.map(acc => ({
      address: acc.owner,
      amount: acc.amount,
      percentage: totalAmount > 0 ? (acc.amount / totalAmount) * 100 : 0
    })).sort((a, b) => b.percentage - a.percentage);

    // Atualiza cache
    holdersCache.set(cacheKey, { data: holders, timestamp: Date.now() });

    return holders;
  } catch (error) {
    console.error('[DevTracker] Erro ao buscar holders Solana:', error.message);
    return null;
  }
}

/**
 * Detecta se houve dev dump comparando holders atuais com anteriores
 * @param {string} tokenAddress - Endereço do token
 * @param {string} chain - Chain do token
 * @param {Object} previousState - Estado anterior dos holders
 * @param {string} apiKey - API key do Helius (opcional)
 * @returns {Object} Resultado da detecção
 */
async function detectDevDump(tokenAddress, chain, previousState, apiKey = null) {
  const result = {
    detected: false,
    percent: 0,
    details: null
  };

  if (chain !== 'solana') {
    // Por enquanto só suporta Solana
    // TODO: Adicionar suporte para EVM via Bitquery
    return result;
  }

  const currentHolders = await getSolanaHolders(tokenAddress, apiKey);

  if (!currentHolders || currentHolders.length === 0) {
    return result;
  }

  // Se não tem estado anterior, salva o atual e retorna
  if (!previousState || !previousState.holders) {
    return {
      ...result,
      currentState: {
        holders: currentHolders,
        timestamp: Date.now()
      }
    };
  }

  // Compara top holders
  const topHolder = currentHolders[0];
  const previousTopHolder = previousState.holders.find(h => h.address === topHolder.address);

  if (previousTopHolder) {
    const percentDrop = previousTopHolder.percentage - topHolder.percentage;

    // Se o top holder (provavelmente dev) vendeu mais de 10%
    if (percentDrop >= 10) {
      result.detected = true;
      result.percent = percentDrop;
      result.details = {
        address: topHolder.address,
        previous_percentage: previousTopHolder.percentage,
        current_percentage: topHolder.percentage,
        sold_percentage: percentDrop
      };
      console.log(`[DevTracker] DEV DUMP DETECTADO: ${topHolder.address.slice(0,8)} vendeu ${percentDrop.toFixed(1)}%`);
    }
  }

  // Verifica também se algum holder grande sumiu completamente
  for (const prevHolder of previousState.holders.slice(0, 5)) {
    if (prevHolder.percentage >= 15) {
      const currentHolder = currentHolders.find(h => h.address === prevHolder.address);
      if (!currentHolder || currentHolder.percentage < 1) {
        result.detected = true;
        result.percent = Math.max(result.percent, prevHolder.percentage);
        result.details = {
          address: prevHolder.address,
          previous_percentage: prevHolder.percentage,
          current_percentage: currentHolder?.percentage || 0,
          sold_percentage: prevHolder.percentage - (currentHolder?.percentage || 0)
        };
        console.log(`[DevTracker] HOLDER GRANDE VENDEU: ${prevHolder.address.slice(0,8)} tinha ${prevHolder.percentage.toFixed(1)}%`);
      }
    }
  }

  result.currentState = {
    holders: currentHolders,
    timestamp: Date.now()
  };

  return result;
}

/**
 * Analisa risco de dev dump baseado na concentração atual
 * @param {string} tokenAddress - Endereço do token
 * @param {string} chain - Chain
 * @param {string} apiKey - API key (opcional)
 * @returns {Object} Análise de risco
 */
async function analyzeDevRisk(tokenAddress, chain, apiKey = null) {
  if (chain !== 'solana') {
    return { risk: 'unknown', reason: 'Chain não suportada para análise de dev' };
  }

  const holders = await getSolanaHolders(tokenAddress, apiKey);

  if (!holders || holders.length === 0) {
    return { risk: 'unknown', reason: 'Não foi possível obter holders' };
  }

  // Calcula concentração
  const top1 = holders[0]?.percentage || 0;
  const top5 = holders.slice(0, 5).reduce((sum, h) => sum + h.percentage, 0);
  const top10 = holders.slice(0, 10).reduce((sum, h) => sum + h.percentage, 0);

  let risk = 'low';
  let reason = '';

  if (top1 >= 30) {
    risk = 'critical';
    reason = `Top holder tem ${top1.toFixed(1)}% do supply`;
  } else if (top1 >= 20) {
    risk = 'high';
    reason = `Top holder tem ${top1.toFixed(1)}% do supply`;
  } else if (top5 >= 50) {
    risk = 'high';
    reason = `Top 5 holders têm ${top5.toFixed(1)}% do supply`;
  } else if (top10 >= 60) {
    risk = 'medium';
    reason = `Top 10 holders têm ${top10.toFixed(1)}% do supply`;
  } else {
    reason = 'Distribuição saudável';
  }

  return {
    risk,
    reason,
    top_holder_percent: top1,
    top_5_percent: top5,
    top_10_percent: top10,
    holders_count: holders.length,
    top_holders: holders.slice(0, 5).map(h => ({
      address: h.address.slice(0, 8) + '...',
      percentage: h.percentage.toFixed(2)
    }))
  };
}

/**
 * Limpa o cache de holders
 */
function clearCache() {
  holdersCache.clear();
}

module.exports = {
  getSolanaHolders,
  detectDevDump,
  analyzeDevRisk,
  clearCache
};
