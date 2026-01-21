// Regret Minimizer - Price Service
// Busca preços via DexScreener API (grátis e multi-chain)

const fetch = require('node-fetch');

const DEXSCREENER_API = 'https://api.dexscreener.com/latest/dex';

// Cache de preços (5 minutos)
const priceCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

/**
 * Busca preço de um token via DexScreener
 * @param {string} contractAddress - Endereço do contrato
 * @param {string} chain - Chain (solana, base, bsc, eth)
 * @returns {Object} Dados do token
 */
async function getTokenPrice(contractAddress, chain) {
  const cacheKey = `${chain}:${contractAddress}`;

  // Verifica cache
  const cached = priceCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    // DexScreener usa nomes de chain diferentes
    const chainMap = {
      'solana': 'solana',
      'base': 'base',
      'bsc': 'bsc',
      'eth': 'ethereum',
      'ethereum': 'ethereum'
    };

    const dexChain = chainMap[chain.toLowerCase()] || chain;
    const url = `${DEXSCREENER_API}/tokens/${contractAddress}`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`DexScreener API error: ${response.status}`);
    }

    const data = await response.json();

    if (!data.pairs || data.pairs.length === 0) {
      return null;
    }

    // Pega o par com maior liquidez na chain correta
    const pair = data.pairs
      .filter(p => p.chainId === dexChain)
      .sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0]
      || data.pairs[0];

    const tokenData = {
      symbol: pair.baseToken?.symbol || null,
      name: pair.baseToken?.name || null,
      priceUsd: parseFloat(pair.priceUsd) || null,
      mcap: pair.marketCap || pair.fdv || null,
      priceChange24h: pair.priceChange?.h24 || 0,
      volume24h: pair.volume?.h24 || 0,
      liquidity: pair.liquidity?.usd || 0,
      pairAddress: pair.pairAddress,
      dexId: pair.dexId
    };

    // Salva no cache
    priceCache.set(cacheKey, {
      data: tokenData,
      timestamp: Date.now()
    });

    return tokenData;
  } catch (error) {
    console.error(`[Price Service] Erro ao buscar ${contractAddress}:`, error.message);
    return null;
  }
}

/**
 * Busca preços de múltiplos tokens
 * @param {Array} tokens - Array de { contractAddress, chain }
 * @returns {Object} Map de contract -> priceData
 */
async function getMultipleTokenPrices(tokens) {
  const results = {};

  // Processa em batches para não sobrecarregar a API
  const batchSize = 5;
  for (let i = 0; i < tokens.length; i += batchSize) {
    const batch = tokens.slice(i, i + batchSize);

    const promises = batch.map(async ({ contractAddress, chain }) => {
      const data = await getTokenPrice(contractAddress, chain);
      return { contractAddress, data };
    });

    const batchResults = await Promise.all(promises);
    batchResults.forEach(({ contractAddress, data }) => {
      results[contractAddress] = data;
    });

    // Rate limit entre batches
    if (i + batchSize < tokens.length) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Busca informações completas do token
 * @param {string} contractAddress
 * @param {string} chain
 * @returns {Object}
 */
async function getTokenInfo(contractAddress, chain) {
  const priceData = await getTokenPrice(contractAddress, chain);

  if (!priceData) return null;

  return {
    ...priceData,
    contractAddress,
    chain
  };
}

// Limpa cache antigo periodicamente
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of priceCache.entries()) {
    if (now - value.timestamp > CACHE_TTL * 2) {
      priceCache.delete(key);
    }
  }
}, CACHE_TTL);

module.exports = {
  getTokenPrice,
  getMultipleTokenPrices,
  getTokenInfo
};
