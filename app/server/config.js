// Configuração baseada em variáveis de ambiente
require('dotenv').config();

module.exports = {
  // Ambiente
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: parseInt(process.env.PORT) || 3777,

  // URLs
  FRONTEND_URL: process.env.FRONTEND_URL || 'http://localhost:3778',
  API_URL: process.env.API_URL || 'http://localhost:3777',

  // Database
  DATABASE_URL: process.env.DATABASE_URL || null, // PostgreSQL connection string
  USE_POSTGRES: !!process.env.DATABASE_URL,

  // APIs externas
  HELIUS_API_KEY: process.env.HELIUS_API_KEY || '',
  DEXSCREENER_API: 'https://api.dexscreener.com',

  // CORS
  CORS_ORIGINS: process.env.CORS_ORIGINS
    ? process.env.CORS_ORIGINS.split(',')
    : ['http://localhost:3778', 'http://localhost:3777', 'https://paperhand-production.up.railway.app', 'chrome-extension://'],

  // Auth
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',
};
