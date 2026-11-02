import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import Chat from './Chat.jsx';
import MapPanel from './MapPanel.jsx';
import ResultCard from './ResultCard.jsx';
import ManualForm from './ManualForm.jsx';
import PredictTab from './PredictTab.jsx';
import History from './History.jsx';
import Logo from './Logo.jsx';
import Icon from './Icon.jsx';
import { useI18n } from './i18n.jsx';

const TABS = [
  { id: 'chat', icon: 'chat' },
  { id: 'predict', icon: 'table' },
  { id: 'form', icon: 'edit' },
  { id: 'history', icon: 'history' },
];

const darkQuery = window.matchMedia('(prefers-color-scheme: dark)');

function storedTheme() {
  try {
    const v = localStorage.getItem('theme');
    if (v === 'light' || v === 'dark') return v;
  } catch { /* trình duyệt chặn localStorage */ }
  return null;
}

// Giao diện sáng / tối: mặc định theo hệ điều hành, người dùng chọn thì nhớ lại
function useTheme() {
  const [chosen, setChosen] = useState(storedTheme);
  const [system, setSystem] = useState(darkQuery.matches ? 'dark' : 'light');
  useEffect(() => {
    const on = (e) => setSystem(e.matches ? 'dark' : 'light');
    darkQuery.addEventListener('change', on);
    return () => darkQuery.removeEventListener('change', on);
  }, []);
  const theme = chosen || system;
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setChosen(next);
    try { localStorage.setItem('theme', next); } catch { /* bỏ qua */ }
  };
  return [theme, toggle];
}

function clockText(n, lang, weekdays) {
  const hm = `${n.hour}:${String(n.minute).padStart(2, '0')}`;
  return lang === 'en'
    ? `${weekdays[n.dayofweek]}, ${n.month}/${n.day}/${n.year} ${hm}`
    : `${n.day}/${n.month}/${n.year} ${hm} (${weekdays[n.dayofweek]})`;
}

export default function App() {
  const { t, lang, setLang, weekdays } = useI18n();
  const [theme, toggleTheme] = useTheme();
  const [health, setHealth] = useState(null);
  const [route, setRoute] = useState(null);
  const [prediction, setPrediction] = useState(null);
  // Tab mở theo #hash trên URL (vd. /#predict), mặc định Chatbot
  const [tab, setTabState] = useState(() => TABS.find((x) => `#${x.id}` === window.location.hash)?.id || 'chat');
  const setTab = (id) => {
    setTabState(id);
    window.history.replaceState(null, '', `#${id}`);
  };
  const [historyTick, setHistoryTick] = useState(0);
  // Lệnh từ LLM orchestrator (công cụ open_test_set): chuyển sang tab bộ Test và áp kết quả
  const [testCommand, setTestCommand] = useState(null);
  const navigate = (ev) => {
    if (ev.tab === 'predict') setTestCommand({ ...ev, nonce: Date.now() });
    setTab(ev.tab);
  };

  useEffect(() => {
    const load = () => api('/health').then(setHealth).catch(() => setHealth({ model: { ok: false } }));
    load();
    const id = setInterval(load, 15000);
    return () => clearInterval(id);
  }, []);

  // Tuyến đường mới (từ chatbot, bộ Test hoặc form) -> vẽ lên Google Maps
  const showRoute = (r) => {
    setRoute(r);
    setPrediction(null);
  };
  const showPrediction = (p) => {
    setPrediction(p);
    setHistoryTick((x) => x + 1);
  };

  const m = health?.model;
  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <Logo size={50} className="logo" />
          <div>
            <h1>UNETI <span>Taxi AI</span></h1>
            <p>{t('subtitle')}</p>
          </div>
        </div>
        <div className="status">
          <Pill ok={m?.ok} label={m?.ok ? `LightGBM · RMSLE ${m.validation_rmsle?.toFixed(4)}` : t('modelService')} />
          <Pill ok={health?.llm_ready} label={`LLM ${health?.llm || ''}`} />
          <Pill ok={health?.google_key} warn={!health?.google_key} label={health?.google_key ? 'Google Maps API + OSRM' : 'Google Maps + OSRM'} />
          {health?.nyc_now && <span className="clock"><Icon name="clock" size={14} />NYC {clockText(health.nyc_now, lang, weekdays)}</span>}
          <div className="prefs">
            <div className="seg small lang" role="group" aria-label="Language">
              {['vi', 'en'].map((l) => (
                <button key={l} type="button" className={lang === l ? 'active' : ''} onClick={() => setLang(l)}>{l.toUpperCase()}</button>
              ))}
            </div>
            <button type="button" className="icon-btn" onClick={toggleTheme}
              title={theme === 'dark' ? t('themeLight') : t('themeDark')} aria-label={theme === 'dark' ? t('themeLight') : t('themeDark')}>
              <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} />
            </button>
          </div>
        </div>
      </header>

      <nav className="main-tabs">
        {TABS.map((x) => (
          <button key={x.id} className={tab === x.id ? 'active' : ''} onClick={() => setTab(x.id)}>
            <Icon name={x.icon} size={17} />{t(`tab.${x.id}`)}
          </button>
        ))}
      </nav>

      {/* Các tab được giữ nguyên trạng thái khi chuyển qua lại (chỉ ẩn đi) */}
      <main className={`grid tab-${tab}`} hidden={tab === 'history'}>
        <section className="card chat-card" hidden={tab !== 'chat'}>
          <Chat onRoute={showRoute} onPrediction={showPrediction} onNavigate={navigate} />
        </section>
        <section className="card pane" hidden={tab !== 'predict'}>
          <PredictTab onRoute={showRoute} onPrediction={showPrediction} command={testCommand} onBack={() => setTab('chat')} />
        </section>
        <section className="card pane" hidden={tab !== 'form'}>
          <h2 className="pane-title">{t('formTitle')}</h2>
          <ManualForm nycNow={health?.nyc_now} onRoute={showRoute} onPrediction={showPrediction} />
        </section>
        <section className="right">
          <MapPanel route={route} apiKey={health?.google_maps_browser_key} />
          <ResultCard prediction={prediction} route={route} />
        </section>
      </main>

      {tab === 'history' && (
        <section className="card pane">
          <h2 className="pane-title">{t('historyTitle')}</h2>
          <History tick={historyTick} />
        </section>
      )}

      <footer className="foot">{t('footer')}</footer>
    </div>
  );
}

function Pill({ ok, warn, label }) {
  return <span className={`pill ${ok ? 'ok' : warn ? 'warn' : 'bad'}`}><i />{label}</span>;
}
