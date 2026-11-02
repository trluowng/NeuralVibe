// LLM orchestrator: hiểu câu hỏi, tự gọi geocode -> lấy quãng đường (Google Maps/OSRM) -> mô hình LightGBM,
// rồi giải thích kết quả. Mỗi bước được đẩy về trình duyệt qua callback emit() để hiện tiến trình và bản đồ.
import OpenAI from 'openai';
import { geocodePlace, getRouteDistances, predictTripDuration, modelApi, hasGoogleKey } from './tools.js';

const MODEL = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
const MAX_STEPS = 8;
let client;

const THU = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'];

export function nycNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric',
    hour: 'numeric', minute: 'numeric', weekday: 'short', hour12: false,
  }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(parts.weekday);
  return {
    text: `${parts.day}/${parts.month}/${parts.year} ${parts.hour % 24}:${parts.minute.padStart(2, '0')} (${THU[dow]})`,
    day: Number(parts.day), year: Number(parts.year),
    month: Number(parts.month), dayofweek: dow, hour: Number(parts.hour) % 24, minute: Number(parts.minute),
  };
}

const point = {
  type: 'object',
  properties: { lat: { type: 'number' }, lon: { type: 'number' }, label: { type: 'string' } },
  required: ['lat', 'lon'],
};

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'geocode_place',
      description: 'Tìm tọa độ (lat, lon) của một địa điểm/địa chỉ ở New York. Gọi riêng cho điểm đi và điểm đến.',
      parameters: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Tên chính thức đầy đủ bằng tiếng Anh (vd "John F. Kennedy International Airport" thay vì "JFK"), kèm "New York" nếu mơ hồ',
          },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_route_distances',
      description: 'Mở bản đồ (Google Maps) cho tuyến đường và lấy khoảng cách chim bay + quãng đường thực tế theo '
        + 'đường phố. Kết quả có model_inputs là các giá trị phải truyền cho predict_trip_duration.',
      parameters: { type: 'object', properties: { pickup: point, dropoff: point }, required: ['pickup', 'dropoff'] },
    },
  },
  {
    type: 'function',
    function: {
      name: 'predict_trip_duration',
      description: 'Dự đoán thời gian chuyến taxi (giây) bằng mô hình LightGBM đã huấn luyện. Luôn gọi sau '
        + 'get_route_distances và truyền đúng model_inputs.',
      parameters: {
        type: 'object',
        properties: {
          pickup_lat: { type: 'number' }, pickup_lon: { type: 'number' },
          dropoff_lat: { type: 'number' }, dropoff_lon: { type: 'number' },
          pickup_month: { type: 'integer', description: '1-12' },
          pickup_dayofweek: { type: 'integer', description: '0 = Thứ Hai, 1 = Thứ Ba, ..., 5 = Thứ Bảy, 6 = Chủ nhật' },
          pickup_hour: { type: 'integer', description: '0-23' },
          pickup_minute: { type: 'integer', description: '0-59' },
          straight_line_km_approx: { type: 'number', description: 'model_inputs.straight_line_km_approx' },
          road_km_osrm: { type: 'number', description: 'model_inputs.road_km_osrm' },
          road_min_osrm: { type: 'number', description: 'model_inputs.road_min_osrm' },
        },
        required: ['pickup_lat', 'pickup_lon', 'dropoff_lat', 'dropoff_lon', 'pickup_month', 'pickup_dayofweek',
          'pickup_hour', 'pickup_minute', 'straight_line_km_approx', 'road_km_osrm', 'road_min_osrm'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_test_set',
      description: 'Chuyển giao diện sang tab "Dự đoán (bộ Test)" của đội và chạy mô hình trên bộ Test. '
        + 'browse = chỉ mở bộ Test; predict_all = dự đoán toàn bộ chuyến và so với file submission.csv đã nộp; '
        + 'predict_trip = dự đoán một chuyến (theo trip_id, bỏ trống thì chọn ngẫu nhiên) và vẽ lên bản đồ.',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['browse', 'predict_all', 'predict_trip'] },
          trip_id: { type: 'string', description: 'trip_id trong bộ Test, vd "Tab8a8b546e1eda6dc8"' },
        },
        required: ['action'],
      },
    },
  },
];

function systemPrompt(lang) {
  const now = nycNow();
  const testTab = lang === 'en' ? 'Predict (Test set)' : 'Dự đoán (bộ Test)';
  return `Bạn là "Taxi AI" - trợ lý dự đoán thời gian chuyến taxi ở New York của đội thi UNETI Olympic AI 2026.
Bây giờ ở New York là ${now.text}: month=${now.month}, dayofweek=${now.dayofweek}, hour=${now.hour}, minute=${now.minute}.

Quy trình khi người dùng cho điểm đi và điểm đến:
1. geocode_place cho từng điểm (nếu người dùng đã đưa tọa độ thì dùng luôn).
2. get_route_distances để mở Google Maps và lấy khoảng cách chim bay, quãng đường thực tế.
3. predict_trip_duration với đúng model_inputs vừa nhận và thời điểm đón (mặc định là bây giờ ở New York nếu
   người dùng không nói; "sáng mai 8h", "thứ Sáu 18h"... thì tự quy đổi; dayofweek: 0 = Thứ Hai ... 6 = Chủ nhật).
   Khi gọi get_route_distances, đặt label cho pickup/dropoff là tên ngắn gọn của địa điểm (vd "Times Square").
4. Giao diện TỰ hiển thị thẻ trả lời ngay trên câu trả lời của bạn, theo thứ tự: (1) tọa độ vĩ độ/kinh độ điểm đi
   và điểm đến, (2) khoảng cách chim bay và đường thực tế, (3) kết quả dự đoán. Vì vậy phần chữ của bạn KHÔNG lặp lại
   tọa độ hay bảng số liệu; chỉ viết 2-3 câu: thời gian dự đoán (phút), giờ đón đã dùng, và nhận xét ngắn
   (giờ cao điểm, cuối tuần, hệ số đường vòng = đường thực tế / chim bay...).

Khi người dùng muốn dự đoán / xem / chạy trên bộ Test (bộ Test của đội, file nộp, trip_id...): gọi open_test_set
để chuyển sang tab bộ Test. "Dự đoán trên bộ Test", "chạy cả bộ" -> predict_all; nêu một trip_id hoặc "thử một chuyến"
-> predict_trip; chỉ muốn xem -> browse. Sau đó trả lời 2-3 câu bằng số liệu công cụ trả về (số chuyến, thời gian chạy,
mức lệch so với file đã nộp, hoặc thời gian dự đoán của chuyến) và nói rằng kết quả đang hiện ở tab "${testTab}".

Quy tắc:
- ${lang === 'en'
    ? 'Ngôn ngữ giao diện là tiếng Anh: LUÔN trả lời bằng tiếng Anh (English), kể cả khi người dùng viết tiếng Việt.'
    : 'Ngôn ngữ giao diện là tiếng Việt: trả lời bằng tiếng Việt.'}
- Không bao giờ tự bịa thời gian dự đoán; con số phải lấy từ predict_trip_duration hoặc open_test_set.
- Mô hình dùng quãng đường OSRM theo ô 0,01° (giống dữ liệu Train); quãng đường Google Maps chỉ để đối chiếu.
- ${hasGoogleKey() ? 'Có Google Maps API: có thể so sánh thêm thời gian Google ước tính.' : 'Chưa có Google Maps API key: quãng đường thực tế lấy từ OSRM (OpenStreetMap), bản đồ Google Maps vẫn hiển thị để đối chiếu.'}
- KHÔNG thêm câu "Lưu ý" về dữ liệu huấn luyện (chỉ có NYC, chỉ có tháng 1-6...) vào câu trả lời; giao diện tự hiện
  cảnh báo khi địa điểm nằm ngoài New York.
- Nếu thiếu điểm đi hoặc điểm đến thì hỏi lại. Câu hỏi khác (về dữ liệu, mô hình, cuộc thi) thì trả lời bình thường:
  mô hình chính LightGBM (1296 cây, 383 lá, học trên log1p(trip_duration)), RMSLE kiểm định 0,3385;
  CatBoost 0,3419; blend 50/50 0,3390. 11 đặc trưng: chim bay, tọa độ đón/trả, giờ, mốc phút, thứ, tháng,
  road_km_osrm, road_min_osrm.`;
}

// Chữ hiển thị trên giao diện cho từng bước công cụ, theo ngôn ngữ đang chọn
const LABELS = {
  vi: {
    geocode_place: (a) => `Tìm tọa độ "${a.query}"`,
    get_route_distances: () => 'Mở Google Maps, lấy khoảng cách chim bay & đường thực tế',
    predict_trip_duration: () => 'Gửi đặc trưng cho mô hình LightGBM dự đoán',
    open_test_set: (a) => ({
      predict_all: 'Mở bộ Test, mô hình dự đoán toàn bộ chuyến',
      predict_trip: `Mở bộ Test, dự đoán chuyến ${a.trip_id || 'ngẫu nhiên'}`,
    }[a.action] || 'Mở tab bộ Test'),
  },
  en: {
    geocode_place: (a) => `Geocode "${a.query}"`,
    get_route_distances: () => 'Open Google Maps, get straight-line & road distance',
    predict_trip_duration: () => 'Send features to the LightGBM model',
    open_test_set: (a) => ({
      predict_all: 'Open the Test set, predict every trip',
      predict_trip: `Open the Test set, predict trip ${a.trip_id || '(random)'}`,
    }[a.action] || 'Open the Test set tab'),
  },
};

// Bộ Test mặc định giống tab Dự đoán: bộ đầu tiên có file submission khớp
let testCache;
async function testSet() {
  if (!testCache) {
    const sets = await modelApi('/test-sets');
    const s = sets.find((x) => x.submissions.length) || sets[0];
    if (!s) throw new Error('Chưa có bộ Test nào trong model_service/data');
    testCache = { ...s, rows: await modelApi(`/test-sets/${encodeURIComponent(s.name)}/rows`) };
  }
  return testCache;
}

function emitPrediction(result, input, ctx) {
  ctx.emit({ type: 'prediction', data: { ...result, input, route: ctx.lastRoute || null } });
  ctx.onPrediction?.({ ...result, input, route: ctx.lastRoute });
}

async function openTestSet({ action, trip_id }, ctx) {
  const ts = await testSet();
  const info = { test_set: ts.name, trips: ts.rows.length, submission_file: ts.submissions[0] || null };

  if (action === 'predict_all') {
    const r = await modelApi(`/test-sets/${encodeURIComponent(ts.name)}/predict`, {});
    ctx.emit({ type: 'navigate', tab: 'predict', set: ts.name, predictions: r.predictions, seconds: r.seconds });
    const nop = Object.fromEntries(ts.rows.map((x) => [x.trip_id, x.submitted_sec]));
    const lech = r.predictions.filter((p) => nop[p.trip_id])
      .map((p) => Math.abs(p.app_sec - nop[p.trip_id]) / nop[p.trip_id]).sort((a, b) => a - b);
    const tb = r.predictions.reduce((s, p) => s + p.app_sec, 0) / r.predictions.length;
    return {
      ...info, action, predicted: r.predictions.length, run_seconds: r.seconds, mean_minutes: +(tb / 60).toFixed(2),
      vs_submission: lech.length ? {
        compared: lech.length,
        median_diff_pct: +(lech[Math.floor(lech.length / 2)] * 100).toFixed(2),
        under_5pct: lech.filter((d) => d < 0.05).length,
      } : null,
    };
  }

  if (action === 'predict_trip') {
    const row = trip_id
      ? ts.rows.find((x) => x.trip_id.toLowerCase() === trip_id.trim().toLowerCase())
      : ts.rows[Math.floor(Math.random() * ts.rows.length)];
    if (!row) throw new Error(`Không có chuyến ${trip_id} trong bộ ${ts.name}`);
    const en = ctx.lang === 'en';
    const pickup = { lat: row.pickup_lat_approx, lon: row.pickup_lon_approx, label: `${row.trip_id} – ${en ? 'pickup' : 'điểm đón'}` };
    const dropoff = { lat: row.dropoff_lat_approx, lon: row.dropoff_lon_approx, label: `${row.trip_id} – ${en ? 'dropoff' : 'điểm trả'}` };
    ctx.lastRoute = await getRouteDistances({ pickup, dropoff });
    ctx.emit({ type: 'route', data: ctx.lastRoute });
    const input = {
      pickup_lat: pickup.lat, pickup_lon: pickup.lon, dropoff_lat: dropoff.lat, dropoff_lon: dropoff.lon,
      pickup_month: row.pickup_month, pickup_dayofweek: row.pickup_dayofweek,
      pickup_hour: row.pickup_hour, pickup_minute: row.pickup_minute_bucket,
      straight_line_km_approx: row.straight_line_km_approx,
    };
    const result = await predictTripDuration(input);
    emitPrediction(result, input, ctx);
    ctx.emit({ type: 'navigate', tab: 'predict', set: ts.name, trip_id: row.trip_id, app_sec: result.trip_duration_sec });
    return {
      ...info, action, trip_id: row.trip_id, features: result.features, weekday: result.weekday_name,
      trip_duration_sec: result.trip_duration_sec, submitted_sec: row.submitted_sec,
    };
  }

  ctx.emit({ type: 'navigate', tab: 'predict', set: ts.name });
  return { ...info, action: 'browse' };
}

async function runTool(name, args, ctx) {
  if (name === 'open_test_set') return openTestSet(args, ctx);
  if (name === 'geocode_place') return geocodePlace(args);
  if (name === 'get_route_distances') {
    const route = await getRouteDistances(args);
    ctx.lastRoute = route;
    ctx.emit({ type: 'route', data: route });
    const { geometry, ...forLlm } = route; // đường đi dài, không cần gửi cho LLM
    return forLlm;
  }
  if (name === 'predict_trip_duration') {
    // Phòng LLM chép thiếu: lấy lại đặc trưng quãng đường từ bước get_route_distances gần nhất
    const mi = ctx.lastRoute?.model_inputs;
    if (mi) for (const k of ['straight_line_km_approx', 'road_km_osrm', 'road_min_osrm']) args[k] ??= mi[k];
    const result = await predictTripDuration(args);
    if (mi) result.sources = { straight_line: 'Google Maps/haversine (làm tròn 0,5 km)', road: `OSRM theo ô 0,01° – ${mi.source}` };
    emitPrediction(result, args, ctx);
    return result;
  }
  throw new Error(`Không có công cụ ${name}`);
}

export async function chat(history, emit, onPrediction, lang = 'vi') {
  if (!process.env.OPENAI_API_KEY) throw new Error('Thiếu OPENAI_API_KEY trong file .env');
  client ??= new OpenAI();
  const messages = [{ role: 'system', content: systemPrompt(lang) }, ...history];
  const ctx = { emit, onPrediction, lastRoute: null, lang };
  const labels = LABELS[lang] || LABELS.vi;

  for (let step = 0; step < MAX_STEPS; step++) {
    const res = await client.chat.completions.create({ model: MODEL, messages, tools: TOOLS });
    const msg = res.choices[0].message;
    messages.push(msg);
    if (!msg.tool_calls?.length) return msg.content || '';

    for (const call of msg.tool_calls) {
      const name = call.function.name;
      let args = {};
      try {
        args = JSON.parse(call.function.arguments || '{}');
      } catch { /* để công cụ báo lỗi tham số */ }
      const id = `${call.id}`;
      emit({ type: 'step', id, status: 'running', label: (labels[name] || (() => name))(args) });
      let output;
      try {
        output = await runTool(name, args, ctx);
        emit({ type: 'step', id, status: 'done', detail: summarize(name, output, lang) });
      } catch (e) {
        output = { error: e.message };
        emit({ type: 'step', id, status: 'error', detail: e.message });
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(output) });
    }
  }
  return lang === 'en'
    ? 'Sorry, I could not finish this request after several steps. Please try rephrasing.'
    : 'Xin lỗi, mình chưa hoàn thành được yêu cầu sau nhiều bước. Bạn thử diễn đạt lại nhé.';
}

function summarize(name, o, lang) {
  const en = lang === 'en';
  const min = en ? 'min' : 'phút';
  const toTab = en ? 'switched to the Test set tab' : 'chuyển sang tab bộ Test';
  if (name === 'geocode_place') return `${o.lat.toFixed(4)}, ${o.lon.toFixed(4)} · ${o.source}`;
  if (name === 'get_route_distances') {
    const road = (o.road_google?.km ?? o.road_osrm?.km)?.toFixed?.(2) ?? '?';
    return en ? `Straight line ${o.straight_line_km} km · road ${road} km` : `Chim bay ${o.straight_line_km} km · đường thực tế ${road} km`;
  }
  if (name === 'predict_trip_duration') return `${(o.trip_duration_sec / 60).toFixed(1)} ${min}`;
  if (name === 'open_test_set') {
    if (o.action === 'predict_all') return `${o.predicted} ${en ? 'trips in' : 'chuyến trong'} ${o.run_seconds}s · ${toTab}`;
    if (o.action === 'predict_trip') return `${o.trip_id}: ${(o.trip_duration_sec / 60).toFixed(1)} ${min} · ${toTab}`;
    return `${o.test_set} · ${o.trips} ${en ? 'trips' : 'chuyến'}`;
  }
  return '';
}

export { MODEL as LLM_MODEL };
