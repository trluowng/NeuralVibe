import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

// Song ngữ Việt / Anh cho toàn bộ giao diện. t('khóa', { biến }) thay {biến} trong chuỗi.
const DICT = {
  vi: {
    subtitle: 'Dự đoán thời gian chuyến taxi New York · Olympic AI 2026 – Vòng 2',
    'tab.chat': 'Chatbot', 'tab.predict': 'Dự đoán (bộ Test)', 'tab.form': 'Nhập thủ công', 'tab.history': 'Lịch sử',
    modelService: 'Model service',
    themeLight: 'Chuyển sang giao diện sáng', themeDark: 'Chuyển sang giao diện tối',
    formTitle: 'Nhập chuyến đi', historyTitle: 'Lịch sử dự đoán',
    footer: 'Mô hình chính: LightGBM (1296 cây · 383 lá · học trên log1p) — 11 đặc trưng gồm khoảng cách chim bay và quãng đường OSRM theo ô 0,01°. LLM chỉ điều phối công cụ; mọi con số thời gian đều do mô hình sinh ra.',

    welcome: 'Xin chào! Mình là **Taxi AI**. Hãy cho mình **điểm đi** và **điểm đến** ở New York (kèm giờ đón nếu có).',
    examples: ['Từ Times Square đến sân bay JFK lúc 18h thứ Sáu', 'Central Park đến Brooklyn Bridge ngay bây giờ',
      'Empire State Building tới LaGuardia Airport 8h sáng thứ Hai', 'Dự đoán trên bộ Test'],
    chatIdle: 'LLM → Google Maps → LightGBM', chatBusy: 'Đang điều phối công cụ…', tryAsk: 'Thử hỏi',
    chatPlaceholder: 'Ví dụ: từ Wall Street đến Central Park lúc 17h30 thứ Tư…', send: 'Gửi',

    pickup: 'Điểm đi', dropoff: 'Điểm đến', lat: 'Vĩ độ', lon: 'Kinh độ',
    coords: 'Tọa độ', distance: 'Khoảng cách', straight: 'Chim bay', roadOsrm: 'Đường thực tế (OSRM)',
    roadGoogle: 'Đường thực tế (Google)', detour: 'Hệ số đường vòng', result: 'Kết quả dự đoán',
    min: 'phút', sec: 'giây', monthN: 'tháng {n}', lgbm: 'Mô hình LightGBM',

    emptyResult: 'Kết quả dự đoán sẽ hiện ở đây sau khi bạn hỏi trợ lý hoặc nhập chuyến đi.',
    predicted: 'Thời gian dự đoán', waiting: 'Đang chờ mô hình dự đoán…',
    catboost: 'Đối chiếu CatBoost:', latency: 'Độ trễ mô hình:',
    outsideNyc: 'Địa điểm nằm ngoài vùng New York của dữ liệu huấn luyện.',
    showFeatures: 'Xem 11 đặc trưng đưa vào mô hình', hideFeatures: 'Ẩn 11 đặc trưng đưa vào mô hình',
    srcStraight: 'Chim bay', srcRoad: 'Quãng đường',

    mapTitle: 'Bản đồ Google Maps', openGmaps: 'Mở Google Maps', mapAttr: 'Bản đồ &copy; Google',
    roadLine: 'Đường thực tế', straightLine: 'Đường chim bay',

    modePlace: 'Nhập vị trí', modeCoords: 'Nhập tọa độ', placePh: 'Tên địa điểm / địa chỉ ở New York',
    latLabel: 'Vĩ độ (lat)', lonLabel: 'Kinh độ (lon)', badCoords: '{p}: tọa độ không hợp lệ',
    busyGeo: 'Đang xác định điểm đi, điểm đến…', busyRoute: 'Đang lấy quãng đường trên bản đồ…',
    busyModel: 'Mô hình đang dự đoán…', noOsrm: 'Không lấy được quãng đường OSRM cho mô hình',
    month: 'Tháng', monthOpt: 'Tháng {n}', weekday: 'Thứ', hour: 'Giờ đón', minute: 'Phút',
    predictBtn: 'Dự đoán thời gian', trainNote: '* Dữ liệu Train chỉ có tháng 1–6.',

    testTitle: 'Dự đoán trên bộ Test', testDesc: 'Bấm một chuyến để mô hình dự đoán và xem tuyến trên bản đồ, hoặc chạy cả bộ.',
    aiOpened: 'Taxi AI đã mở bộ Test theo yêu cầu trong chat', aiAll: ' và dự đoán toàn bộ', aiTrip: ' · chuyến {id}',
    backChat: '← Quay lại Chatbot', trips: '{n} chuyến', hasSub: 'Có file submission.csv để đối chiếu',
    noSub: 'Chưa có file nộp khớp', predictedN: 'Đã dự đoán:', medianDiff: 'Lệch trung vị {x}% · {a}/{b} chuyến < 5%',
    runInfo: '{n} chuyến trong {s}s', searchTrip: 'Tìm trip_id…', predictAll: 'Dự đoán toàn bộ', csv: 'Tải CSV',
    loadingTest: 'Đang tải bộ Test…', predictingAll: 'Mô hình đang dự đoán toàn bộ bộ Test…',
    thTime: 'Thời điểm', thStraight: 'Chim bay', thSub: 'File nộp', thApp: 'App dự đoán', thDiff: 'Lệch',
    monthShort: 'th{n}', minShort: 'ph', clickPredict: 'bấm để dự đoán', noTrips: 'Không có chuyến nào.',
    prev: '‹ Trước', next: 'Sau ›', page: 'Trang {p}/{n} · {c} chuyến', tripPickup: '{id} – điểm đón', tripDropoff: '{id} – điểm trả',

    thAt: 'Lúc', thSource: 'Nguồn', thPrediction: 'Dự đoán', viaForm: 'Form', noHistory: 'Chưa có dự đoán nào được lưu.',
  },
  en: {
    subtitle: 'New York taxi trip duration prediction · Olympic AI 2026 – Round 2',
    'tab.chat': 'Chatbot', 'tab.predict': 'Predict (Test set)', 'tab.form': 'Manual input', 'tab.history': 'History',
    modelService: 'Model service',
    themeLight: 'Switch to light mode', themeDark: 'Switch to dark mode',
    formTitle: 'Enter a trip', historyTitle: 'Prediction history',
    footer: 'Main model: LightGBM (1296 trees · 383 leaves · trained on log1p) — 11 features including straight-line distance and OSRM road distance per 0.01° cell. The LLM only orchestrates tools; every duration comes from the model.',

    welcome: 'Hi! I am **Taxi AI**. Tell me a **pickup** and a **dropoff** in New York (plus a pickup time if you like).',
    examples: ['From Times Square to JFK Airport at 6pm on Friday', 'Central Park to Brooklyn Bridge right now',
      'Empire State Building to LaGuardia Airport at 8am Monday', 'Predict on the Test set'],
    chatIdle: 'LLM → Google Maps → LightGBM', chatBusy: 'Orchestrating tools…', tryAsk: 'Try asking',
    chatPlaceholder: 'e.g. from Wall Street to Central Park at 5:30pm on Wednesday…', send: 'Send',

    pickup: 'Pickup', dropoff: 'Dropoff', lat: 'Lat', lon: 'Lon',
    coords: 'Coordinates', distance: 'Distance', straight: 'Straight line', roadOsrm: 'Road (OSRM)',
    roadGoogle: 'Road (Google)', detour: 'Detour factor', result: 'Prediction',
    min: 'min', sec: 's', monthN: 'month {n}', lgbm: 'LightGBM model',

    emptyResult: 'The prediction will appear here once you ask the assistant or enter a trip.',
    predicted: 'Predicted duration', waiting: 'Waiting for the model…',
    catboost: 'CatBoost comparison:', latency: 'Model latency:',
    outsideNyc: 'This location is outside the New York area of the training data.',
    showFeatures: 'Show the 11 model features', hideFeatures: 'Hide the 11 model features',
    srcStraight: 'Straight line', srcRoad: 'Road',

    mapTitle: 'Google Maps', openGmaps: 'Open in Google Maps', mapAttr: 'Map data &copy; Google',
    roadLine: 'Road route', straightLine: 'Straight line',

    modePlace: 'Place', modeCoords: 'Coordinates', placePh: 'Place name / address in New York',
    latLabel: 'Latitude (lat)', lonLabel: 'Longitude (lon)', badCoords: '{p}: invalid coordinates',
    busyGeo: 'Locating pickup and dropoff…', busyRoute: 'Getting the road distance…',
    busyModel: 'Model is predicting…', noOsrm: 'Could not get the OSRM road distance for the model',
    month: 'Month', monthOpt: 'Month {n}', weekday: 'Day', hour: 'Pickup hour', minute: 'Minute',
    predictBtn: 'Predict duration', trainNote: '* Training data only covers months 1–6.',

    testTitle: 'Predict on the Test set', testDesc: 'Click a trip to predict it and see the route on the map, or run the whole set.',
    aiOpened: 'Taxi AI opened the Test set from your chat request', aiAll: ' and predicted every trip', aiTrip: ' · trip {id}',
    backChat: '← Back to Chatbot', trips: '{n} trips', hasSub: 'submission.csv available for comparison',
    noSub: 'No matching submission file', predictedN: 'Predicted:', medianDiff: 'Median deviation {x}% · {a}/{b} trips < 5%',
    runInfo: '{n} trips in {s}s', searchTrip: 'Search trip_id…', predictAll: 'Predict all', csv: 'Download CSV',
    loadingTest: 'Loading the Test set…', predictingAll: 'Model is predicting the whole Test set…',
    thTime: 'Pickup time', thStraight: 'Straight', thSub: 'Submitted', thApp: 'App prediction', thDiff: 'Diff',
    monthShort: 'm{n}', minShort: 'min', clickPredict: 'click to predict', noTrips: 'No trips.',
    prev: '‹ Prev', next: 'Next ›', page: 'Page {p}/{n} · {c} trips', tripPickup: '{id} – pickup', tripDropoff: '{id} – dropoff',

    thAt: 'Time', thSource: 'Source', thPrediction: 'Prediction', viaForm: 'Form', noHistory: 'No saved predictions yet.',
  },
};

const WEEKDAYS = {
  vi: ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ nhật'],
  en: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'],
};

// Chuỗi tiếng Việt do backend / model service trả về (nguồn đặc trưng, cảnh báo) -> tiếng Anh
const SERVER_EN = [
  ['Tọa độ nằm ngoài vùng New York của dữ liệu huấn luyện - kết quả không đáng tin.',
    'Coordinates are outside the New York area of the training data – the result is unreliable.'],
  ['làm tròn 0,5 km', 'rounded to 0.5 km'],
  ['OSRM theo ô 0,01°', 'OSRM per 0.01° cell'],
  ['bảng tra Train', 'Train lookup table'],
  ['OSRM trực tiếp', 'live OSRM'],
  ['cùng ô', 'same cell'],
  ['đầu vào', 'input'],
];

const LOCALE = { vi: 'vi-VN', en: 'en-US' };

const I18n = createContext(null);

function storedLang() {
  try {
    const v = localStorage.getItem('lang');
    if (v === 'vi' || v === 'en') return v;
  } catch { /* trình duyệt chặn localStorage */ }
  return 'vi';
}

export function I18nProvider({ children }) {
  const [lang, setLangState] = useState(storedLang);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const value = useMemo(() => {
    const d = DICT[lang];
    const t = (key, vars) => {
      const s = d[key] ?? DICT.vi[key] ?? key;
      return vars && typeof s === 'string' ? s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '') : s;
    };
    return {
      lang,
      setLang: (l) => {
        setLangState(l);
        try { localStorage.setItem('lang', l); } catch { /* bỏ qua */ }
      },
      t,
      weekdays: WEEKDAYS[lang],
      locale: LOCALE[lang],
      num: (n) => Number(n).toLocaleString(LOCALE[lang]),
      tr: (s) => (lang === 'en' && typeof s === 'string' ? SERVER_EN.reduce((acc, [vi, en]) => acc.replace(vi, en), s) : s),
      fmtDuration: (sec) => {
        const m = Math.floor(sec / 60);
        const s = Math.round(sec % 60);
        if (lang === 'en') return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min ${s} s`;
        return m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút ${s} giây`;
      },
    };
  }, [lang]);

  return <I18n.Provider value={value}>{children}</I18n.Provider>;
}

export const useI18n = () => useContext(I18n);
