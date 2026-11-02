import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api.js';
import Logo from './Logo.jsx';
import { useI18n } from './i18n.jsx';

const PAGE = 15;

// Tab Dự đoán: toàn bộ chuyến của bộ Test, dự đoán từng chuyến (hiện lên bản đồ) hoặc cả bộ, đối chiếu file CSV đã nộp
export default function PredictTab({ onRoute, onPrediction, command, onBack }) {
  const { t, weekdays, num } = useI18n();
  const [sets, setSets] = useState([]);
  const [name, setName] = useState('');
  const [rows, setRows] = useState([]);
  const [app, setApp] = useState({});
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(''); // khóa chuỗi i18n của việc đang chạy
  const [runInfo, setRunInfo] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/test-sets').then((s) => {
      setSets(s);
      setName((s.find((x) => x.submissions.length) || s[0])?.name || '');
    }).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!name) return;
    setRows([]);
    setApp({});
    setRunInfo(null);
    setBusy('loadingTest');
    api(`/test-sets/${name}/rows`).then(setRows).catch((e) => setError(e.message)).finally(() => setBusy(''));
  }, [name]);

  // Áp lệnh của chatbot sau khi bộ Test tương ứng đã tải xong
  const applied = useRef(null);
  useEffect(() => {
    if (!command || applied.current === command.nonce) return;
    if (command.set && command.set !== name) {
      if (sets.some((s) => s.name === command.set)) setName(command.set);
      return;
    }
    if (!rows.length) return;
    applied.current = command.nonce;
    if (command.predictions) {
      setApp(Object.fromEntries(command.predictions.map((p) => [p.trip_id, p.app_sec])));
      setRunInfo({ seconds: command.seconds, count: command.predictions.length });
    }
    if (command.trip_id) {
      const i = rows.findIndex((r) => r.trip_id === command.trip_id);
      setSelected(command.trip_id);
      setApp((a) => ({ ...a, [command.trip_id]: command.app_sec }));
      setQuery('');
      if (i >= 0) setPage(Math.floor(i / PAGE));
    }
  }, [command, rows, name, sets]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.trip_id.toLowerCase().includes(q)) : rows;
  }, [rows, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const shown = filtered.slice(page * PAGE, page * PAGE + PAGE);

  const stats = useMemo(() => {
    const diffs = rows.filter((r) => app[r.trip_id] && r.submitted_sec)
      .map((r) => Math.abs(app[r.trip_id] - r.submitted_sec) / r.submitted_sec)
      .sort((a, b) => a - b);
    if (!diffs.length) return null;
    return { n: diffs.length, median: diffs[Math.floor(diffs.length / 2)], under5: diffs.filter((d) => d < 0.05).length };
  }, [rows, app]);

  async function predictAll() {
    setError('');
    setBusy('predictingAll');
    try {
      const r = await api(`/test-sets/${name}/predict`, {});
      setApp(Object.fromEntries(r.predictions.map((p) => [p.trip_id, p.app_sec])));
      setRunInfo({ seconds: r.seconds, count: r.predictions.length });
    } catch (e) {
      setError(e.message);
    }
    setBusy('');
  }

  async function predictRow(r) {
    setSelected(r.trip_id);
    setError('');
    const pickup = { lat: r.pickup_lat_approx, lon: r.pickup_lon_approx, label: t('tripPickup', { id: r.trip_id }) };
    const dropoff = { lat: r.dropoff_lat_approx, lon: r.dropoff_lon_approx, label: t('tripDropoff', { id: r.trip_id }) };
    try {
      const route = await api('/route', { pickup, dropoff });
      onRoute(route);
      const p = await api('/predict', {
        pickup_lat: pickup.lat, pickup_lon: pickup.lon, dropoff_lat: dropoff.lat, dropoff_lon: dropoff.lon,
        pickup_month: r.pickup_month, pickup_dayofweek: r.pickup_dayofweek,
        pickup_hour: r.pickup_hour, pickup_minute: r.pickup_minute_bucket,
        straight_line_km_approx: r.straight_line_km_approx,
      });
      setApp((a) => ({ ...a, [r.trip_id]: p.trip_duration_sec }));
      onPrediction({ ...p, route });
    } catch (e) {
      setError(e.message);
    }
  }

  function downloadCsv() {
    const lines = ['trip_id,trip_duration', ...rows.map((r) => `${r.trip_id},${app[r.trip_id]}`)];
    const url = URL.createObjectURL(new Blob([lines.join('\n') + '\n'], { type: 'text/csv' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: `${name}_du_doan_app.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  const current = sets.find((s) => s.name === name);
  const allDone = rows.length > 0 && rows.every((r) => app[r.trip_id]);

  return (
    <div className="predict">
      <div className="predict-head">
        <div>
          <h2>{t('testTitle')}</h2>
          <p>{t('testDesc')}</p>
        </div>
        {sets.length > 1 && (
          <select value={name} onChange={(e) => { setName(e.target.value); setPage(0); }}>
            {sets.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        )}
      </div>

      {command && (
        <div className="ai-note">
          <span><Logo size={22} />{t('aiOpened')}{command.predictions ? t('aiAll') : command.trip_id ? t('aiTrip', { id: command.trip_id }) : ''}.</span>
          <button className="mini" onClick={onBack}>{t('backChat')}</button>
        </div>
      )}

      <div className="chips">
        <span className="chip"><b>{name || '–'}</b> · {t('trips', { n: num(rows.length) })}</span>
        <span className="chip">{current?.submissions.length ? t('hasSub') : t('noSub')}</span>
        <span className="chip">{t('predictedN')} <b>{num(Object.keys(app).length)}</b></span>
        {stats && <span className="chip ok">{t('medianDiff', { x: (stats.median * 100).toFixed(2), a: stats.under5, b: stats.n })}</span>}
        {runInfo && <span className="chip">{t('runInfo', { n: runInfo.count, s: runInfo.seconds })}</span>}
      </div>

      <div className="predict-bar">
        <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder={t('searchTrip')} />
        <button className="primary" onClick={predictAll} disabled={!rows.length || Boolean(busy)}>
          {busy ? t(busy) : t('predictAll')}
        </button>
        <button className="ghost" onClick={downloadCsv} disabled={!allDone}>{t('csv')}</button>
      </div>
      {error && <div className="warning">⚠️ {error}</div>}

      <div className="table-wrap">
        <table className="grid-table clickable">
          <thead>
            <tr><th>trip_id</th><th>{t('thTime')}</th><th>{t('thStraight')}</th><th>{t('thSub')}</th><th>{t('thApp')}</th><th>{t('thDiff')}</th></tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const v = app[r.trip_id];
              const diff = v && r.submitted_sec ? Math.abs(v - r.submitted_sec) / r.submitted_sec : null;
              return (
                <tr key={r.trip_id} className={selected === r.trip_id ? 'selected' : ''} onClick={() => predictRow(r)}>
                  <td className="mono">{r.trip_id}</td>
                  <td>{weekdays[r.pickup_dayofweek]} {String(r.pickup_hour).padStart(2, '0')}:{String(r.pickup_minute_bucket).padStart(2, '0')} · {t('monthShort', { n: r.pickup_month })}</td>
                  <td>{r.straight_line_km_approx} km</td>
                  <td>{r.submitted_sec ? `${(r.submitted_sec / 60).toFixed(1)} ${t('minShort')}` : '–'}</td>
                  <td><b>{v ? `${(v / 60).toFixed(1)} ${t('minShort')}` : <span className="muted">{t('clickPredict')}</span>}</b></td>
                  <td>{diff !== null && <span className={`badge ${diff < 0.05 ? 'ok' : 'bad'}`}>{(diff * 100).toFixed(2)}%</span>}</td>
                </tr>
              );
            })}
            {!shown.length && <tr><td colSpan={6} className="muted">{busy ? t(busy) : t('noTrips')}</td></tr>}
          </tbody>
        </table>
      </div>

      <div className="pager">
        <button className="mini" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('prev')}</button>
        <span>{t('page', { p: page + 1, n: pages, c: num(filtered.length) })}</span>
        <button className="mini" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>{t('next')}</button>
      </div>
    </div>
  );
}
