const express = require('express');
const axios = require('axios');
const axiosRetry = require('axios-retry').default;
const CircuitBreaker = require('opossum');
const pino = require('pino');
const pinoHttp = require('pino-http');
const client = require('prom-client');

const app = express();
const PORT = process.env.PORT || 3000;

// --- Logs estruturados ---
const logger = pino();
app.use(pinoHttp({ logger }));

// --- Métricas ---
const register = new client.Registry();
client.collectDefaultMetrics({ register }); // métricas padrão (CPU, memória, etc)

const requestCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total de requisições recebidas',
  labelNames: ['method', 'route', 'status'],
});
const errorCounter = new client.Counter({
  name: 'http_errors_total',
  help: 'Total de respostas de erro',
});
const durationHistogram = new client.Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duração das requisições em segundos',
  labelNames: ['route'],
});

register.registerMetric(requestCounter);
register.registerMetric(errorCounter);
register.registerMetric(durationHistogram);

// Middleware que mede toda requisição automaticamente
app.use((req, res, next) => {
  const end = durationHistogram.startTimer({ route: req.path });
  res.on('finish', () => {
    requestCounter.inc({ method: req.method, route: req.path, status: res.statusCode });
    if (res.statusCode >= 400) errorCounter.inc();
    end();
  });
  next();
});

// --- Confiabilidade (igual ao Dia 2) ---
const apiClient = axios.create({ timeout: 3000 });
axiosRetry(apiClient, { retries: 3, retryDelay: axiosRetry.exponentialDelay });

const cache = new Map();
const CACHE_TTL_MS = 60 * 1000;

async function fetchPokemonFromApi(name) {
  const response = await apiClient.get(
    `https://pokeapi.co/api/v2/pokemon/${name.toLowerCase()}`
  );
  return response.data;
}

const breaker = new CircuitBreaker(fetchPokemonFromApi, {
  timeout: 3000,
  errorThresholdPercentage: 50,
  resetTimeout: 10000,
});

async function getPokemon(name) {
  const cacheKey = name.toLowerCase();
  const cached = cache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.data;
  }

  const data = await breaker.fire(name);
  cache.set(cacheKey, { data, timestamp: Date.now() });
  return data;
}

// --- Rotas ---
app.get('/battle', async (req, res) => {
  const { pokemonA, pokemonB } = req.query;

  if (!pokemonA || !pokemonB) {
    return res.status(400).json({
      error: 'Informe os parâmetros pokemonA e pokemonB na URL',
    });
  }

  req.log.info({ pokemonA, pokemonB }, 'Recebida requisição de batalha');

  try {
    const [a, b] = await Promise.all([
      getPokemon(pokemonA),
      getPokemon(pokemonB),
    ]);

    const statsA = a.stats.reduce((sum, s) => sum + s.base_stat, 0);
    const statsB = b.stats.reduce((sum, s) => sum + s.base_stat, 0);

    const winner = statsA >= statsB ? a.name : b.name;

    res.json({
      pokemonA: { name: a.name, totalStats: statsA },
      pokemonB: { name: b.name, totalStats: statsB },
      winner,
    });
  } catch (err) {
    req.log.error({ err: err.message }, 'Falha ao buscar pokémons');
    res.status(503).json({
      error: 'Serviço temporariamente indisponível, tente novamente em instantes',
    });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/metrics', async (req, res) => {
  res.set('Content-Type', register.contentType);
  res.end(await register.metrics());
});

app.listen(PORT, () => {
  logger.info(`Servidor rodando em http://localhost:${PORT}`);
});