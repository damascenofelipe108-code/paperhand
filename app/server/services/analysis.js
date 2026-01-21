// Regret Minimizer - Analysis Service
// Calcula estatísticas, padrões e score de decisão

/**
 * Calcula estatísticas gerais
 */
function getStats(db) {
  // Tokens vistos hoje
  const today = db.prepare(`
    SELECT COUNT(*) as count
    FROM viewed_tokens
    WHERE date(viewed_at) = date('now')
  `).get();

  // Total de tokens vistos
  const total = db.prepare(`
    SELECT COUNT(*) as count FROM viewed_tokens
  `).get();

  // Tokens não comprados que subiram (lucro perdido)
  const missedProfits = db.prepare(`
    SELECT
      vt.id,
      vt.price_when_viewed,
      ph.price as current_price,
      ((ph.price - vt.price_when_viewed) / vt.price_when_viewed) * 100 as change_percent
    FROM viewed_tokens vt
    LEFT JOIN (
      SELECT token_id, price,
             ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY checked_at DESC) as rn
      FROM price_history
    ) ph ON ph.token_id = vt.id AND ph.rn = 1
    WHERE vt.bought = 0
      AND vt.price_when_viewed > 0
      AND ph.price > vt.price_when_viewed
  `).all();

  // Calcula lucro perdido total (assumindo $100 por trade)
  const assumedInvestment = 100;
  let totalMissedProfit = 0;
  missedProfits.forEach(t => {
    if (t.change_percent > 0) {
      totalMissedProfit += (t.change_percent / 100) * assumedInvestment;
    }
  });

  // Tokens não comprados que caíram (perda evitada)
  const avoidedLosses = db.prepare(`
    SELECT COUNT(*) as count
    FROM viewed_tokens vt
    LEFT JOIN (
      SELECT token_id, price,
             ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY checked_at DESC) as rn
      FROM price_history
    ) ph ON ph.token_id = vt.id AND ph.rn = 1
    WHERE vt.bought = 0
      AND vt.price_when_viewed > 0
      AND (ph.price < vt.price_when_viewed * 0.5 OR ph.price IS NULL OR ph.price = 0)
  `).get();

  // Score de decisão
  const score = calculateDecisionScore(db);

  return {
    tokensViewedToday: today.count,
    totalTokensViewed: total.count,
    missedProfitUsd: totalMissedProfit,
    missedProfitTokens: missedProfits.length,
    avoidedLosses: avoidedLosses.count,
    decisionScore: score.score,
    decisionAccuracy: score.accuracy
  };
}

/**
 * Calcula score de decisão
 * +1 para cada decisão correta de não comprar (token caiu >50% ou rug)
 * -1 para cada decisão errada de não comprar (token subiu >100%)
 */
function calculateDecisionScore(db) {
  // Decisões corretas (não comprou e token caiu muito ou deu rug)
  const correctDecisions = db.prepare(`
    SELECT COUNT(*) as count
    FROM viewed_tokens vt
    LEFT JOIN (
      SELECT token_id, price,
             ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY checked_at DESC) as rn
      FROM price_history
    ) ph ON ph.token_id = vt.id AND ph.rn = 1
    WHERE vt.bought = 0
      AND vt.price_when_viewed > 0
      AND (ph.price < vt.price_when_viewed * 0.5 OR ph.price IS NULL OR ph.price = 0)
  `).get();

  // Decisões erradas (não comprou e token subiu >100%)
  const wrongDecisions = db.prepare(`
    SELECT COUNT(*) as count
    FROM viewed_tokens vt
    LEFT JOIN (
      SELECT token_id, price,
             ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY checked_at DESC) as rn
      FROM price_history
    ) ph ON ph.token_id = vt.id AND ph.rn = 1
    WHERE vt.bought = 0
      AND vt.price_when_viewed > 0
      AND ph.price > vt.price_when_viewed * 2
  `).get();

  const correct = correctDecisions.count;
  const wrong = wrongDecisions.count;
  const total = correct + wrong;

  return {
    score: correct - wrong,
    correct,
    wrong,
    total,
    accuracy: total > 0 ? ((correct / total) * 100).toFixed(1) : 0
  };
}

/**
 * Analisa padrões de comportamento
 */
function getPatterns(db) {
  const patterns = [];

  // Padrão por chain - quais chains você deixa passar mais oportunidades
  const chainPattern = db.prepare(`
    SELECT
      vt.chain,
      COUNT(*) as total_viewed,
      SUM(CASE WHEN vt.bought = 0 AND ph.price > vt.price_when_viewed * 2 THEN 1 ELSE 0 END) as missed_2x,
      SUM(CASE WHEN vt.bought = 0 AND ph.price > vt.price_when_viewed * 5 THEN 1 ELSE 0 END) as missed_5x
    FROM viewed_tokens vt
    LEFT JOIN (
      SELECT token_id, price,
             ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY checked_at DESC) as rn
      FROM price_history
    ) ph ON ph.token_id = vt.id AND ph.rn = 1
    WHERE vt.price_when_viewed > 0
    GROUP BY vt.chain
    ORDER BY missed_2x DESC
  `).all();

  if (chainPattern.length > 0) {
    const worstChain = chainPattern[0];
    if (worstChain.missed_2x > 0) {
      patterns.push({
        type: 'chain',
        message: `Você deixou passar ${worstChain.missed_2x} tokens que deram 2x+ em ${worstChain.chain.toUpperCase()}`,
        data: chainPattern
      });
    }
  }

  // Padrão por horário - em quais horários você hesita mais
  const hourPattern = db.prepare(`
    SELECT
      strftime('%H', vt.viewed_at) as hour,
      COUNT(*) as total_viewed,
      SUM(CASE WHEN vt.bought = 0 AND ph.price > vt.price_when_viewed * 2 THEN 1 ELSE 0 END) as missed_2x
    FROM viewed_tokens vt
    LEFT JOIN (
      SELECT token_id, price,
             ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY checked_at DESC) as rn
      FROM price_history
    ) ph ON ph.token_id = vt.id AND ph.rn = 1
    WHERE vt.price_when_viewed > 0
    GROUP BY strftime('%H', vt.viewed_at)
    HAVING missed_2x > 0
    ORDER BY missed_2x DESC
    LIMIT 3
  `).all();

  if (hourPattern.length > 0) {
    const worstHours = hourPattern.map(h => `${h.hour}h`).join(', ');
    patterns.push({
      type: 'hour',
      message: `Você deixa passar mais oportunidades nos horários: ${worstHours}`,
      data: hourPattern
    });
  }

  // Padrão por source - onde você vê mas não compra
  const sourcePattern = db.prepare(`
    SELECT
      vt.source,
      COUNT(*) as total_viewed,
      SUM(CASE WHEN vt.bought = 0 THEN 1 ELSE 0 END) as not_bought,
      SUM(CASE WHEN vt.bought = 0 AND ph.price > vt.price_when_viewed * 2 THEN 1 ELSE 0 END) as missed_2x
    FROM viewed_tokens vt
    LEFT JOIN (
      SELECT token_id, price,
             ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY checked_at DESC) as rn
      FROM price_history
    ) ph ON ph.token_id = vt.id AND ph.rn = 1
    WHERE vt.price_when_viewed > 0
    GROUP BY vt.source
    ORDER BY missed_2x DESC
  `).all();

  if (sourcePattern.length > 0) {
    patterns.push({
      type: 'source',
      message: 'Performance por plataforma',
      data: sourcePattern
    });
  }

  // Padrão por market cap - em qual range de MC você hesita
  const mcapPattern = db.prepare(`
    SELECT
      CASE
        WHEN vt.mcap_when_viewed < 50000 THEN 'Micro (<$50k)'
        WHEN vt.mcap_when_viewed < 500000 THEN 'Small ($50k-$500k)'
        WHEN vt.mcap_when_viewed < 5000000 THEN 'Medium ($500k-$5M)'
        ELSE 'Large (>$5M)'
      END as mcap_range,
      COUNT(*) as total_viewed,
      SUM(CASE WHEN vt.bought = 0 AND ph.price > vt.price_when_viewed * 2 THEN 1 ELSE 0 END) as missed_2x
    FROM viewed_tokens vt
    LEFT JOIN (
      SELECT token_id, price,
             ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY checked_at DESC) as rn
      FROM price_history
    ) ph ON ph.token_id = vt.id AND ph.rn = 1
    WHERE vt.price_when_viewed > 0 AND vt.mcap_when_viewed > 0
    GROUP BY mcap_range
    ORDER BY missed_2x DESC
  `).all();

  if (mcapPattern.length > 0 && mcapPattern[0].missed_2x > 0) {
    patterns.push({
      type: 'mcap',
      message: `Você hesita mais em tokens ${mcapPattern[0].mcap_range}`,
      data: mcapPattern
    });
  }

  return patterns;
}

/**
 * Lista tokens com maior lucro perdido
 */
function getMissedProfits(db) {
  const tokens = db.prepare(`
    SELECT
      vt.*,
      ph.price as current_price,
      ((ph.price - vt.price_when_viewed) / vt.price_when_viewed) * 100 as change_percent,
      (ph.price - vt.price_when_viewed) * 100 as missed_profit_usd
    FROM viewed_tokens vt
    LEFT JOIN (
      SELECT token_id, price,
             ROW_NUMBER() OVER (PARTITION BY token_id ORDER BY checked_at DESC) as rn
      FROM price_history
    ) ph ON ph.token_id = vt.id AND ph.rn = 1
    WHERE vt.bought = 0
      AND vt.price_when_viewed > 0
      AND ph.price > vt.price_when_viewed
    ORDER BY change_percent DESC
    LIMIT 20
  `).all();

  return tokens.map(t => ({
    ...t,
    change_percent: parseFloat(t.change_percent?.toFixed(2) || 0),
    missed_profit_usd: parseFloat(t.missed_profit_usd?.toFixed(2) || 0)
  }));
}

/**
 * Retorna score de decisão formatado
 */
function getDecisionScore(db) {
  return calculateDecisionScore(db);
}

module.exports = {
  getStats,
  getPatterns,
  getMissedProfits,
  getDecisionScore
};
