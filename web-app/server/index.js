import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// .env của web-app trước, rồi .env ở thư mục dự án (chứa OPENAI_API_KEY)
dotenv.config({ path: [path.join(ROOT, '.env'), path.join(ROOT, '..', '.env')] });

const { default: express } = await import('express');
const { chat, nycNow, LLM_MODEL } = await import('./orchestrator.js');
const { geocodePlace, getRouteDistances, predictTripDuration, modelApi, hasGoogleKey, TIMEOUT_BATCH } = await import('./tools.js');

const PORT = Number(process.env.PORT || 8787);
// Để ngoài server/: ghi file trong thư mục node --watch theo dõi sẽ làm server khởi động lại giữa chừng
const HISTORY_FILE = path.join(ROOT, 'data', 'history.json');

function loadHistory() {
  try {
    return JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
  } catch {
    return [];
  }
}

let history = loadHistory();

function saveHistory(entry) {
  history = [entry, ...history].slice(0, 200);
  fs.mkdirSync(path.dirname(HISTORY_FILE), { recursive: true });
  fs.writeFile(HISTORY_FILE, JSON.stringify(history, null, 1), () => {});
}

function recordPrediction(p, via) {
  saveHistory({
    at: new Date().toISOString(),
    via,
    pickup: p.route?.pickup?.label || `${p.features.pickup_lat_approx}, ${p.features.pickup_lon_approx}`,
    dropoff: p.route?.dropoff?.label || `${p.features.dropoff_lat_approx}, ${p.features.dropoff_lon_approx}`,
    seconds: p.trip_duration_sec,
    features: p.features,
  });
}

const app = express();
app.use(express.json({ limit: '1mb' }));

const wrap = (fn) => (req, res) => fn(req, res).catch((e) => res.status(500).json({ error: e.message }));

app.get('/api/health', wrap(async (_req, res) => {
  const model = await modelApi('/health').catch((e) => ({ ok: false, error: e.message }));
  res.json({ model, llm: LLM_MODEL, llm_ready: Boolean(process.env.OPENAI_API_KEY), google_key: hasGoogleKey(),
    // Key cho Maps JavaScript API trên trình duyệt (nên giới hạn theo HTTP referrer)
    google_maps_browser_key: process.env.GOOGLE_MAPS_BROWSER_KEY || process.env.GOOGLE_MAPS_API_KEY || null,
    nyc_now: nycNow() });
}));

app.get('/api/geocode', wrap(async (req, res) => res.json(await geocodePlace({ query: String(req.query.q || '') }))));

app.post('/api/route', wrap(async (req, res) => res.json(await getRouteDistances(req.body))));

app.post('/api/predict', wrap(async (req, res) => {
  const p = await predictTripDuration(req.body);
  recordPrediction(p, 'form');
  res.json(p);
}));

app.get('/api/test-sets', wrap(async (_req, res) => res.json(await modelApi('/test-sets'))));

app.get('/api/test-sets/:name/rows', wrap(async (req, res) => {
  res.json(await modelApi(`/test-sets/${encodeURIComponent(req.params.name)}/rows`));
}));

app.post('/api/test-sets/:name/predict', wrap(async (req, res) => {
  res.json(await modelApi(`/test-sets/${encodeURIComponent(req.params.name)}/predict`, {}, TIMEOUT_BATCH));
}));

app.get('/api/history', (_req, res) => res.json(history));

// Chat: trả về luồng Server-Sent Events (bước công cụ, tuyến đường, dự đoán, câu trả lời cuối)
app.post('/api/chat', async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  const emit = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  const messages = (req.body.messages || [])
    .filter((m) => ['user', 'assistant'].includes(m.role) && typeof m.content === 'string')
    .slice(-20);
  try {
    const lang = req.body.lang === 'en' ? 'en' : 'vi';
    const answer = await chat(messages, emit, (p) => recordPrediction(p, 'chat'), lang);
    emit({ type: 'message', content: answer });
  } catch (e) {
    emit({ type: 'error', message: e.message });
  }
  emit({ type: 'done' });
  res.end();
});

const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`API + orchestrator: http://localhost:${PORT}`));
