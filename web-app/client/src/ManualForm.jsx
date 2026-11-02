import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { useI18n } from './i18n.jsx';

const PRESETS = [
  ['Times Square, New York', 'JFK Airport, New York'],
  ['Grand Central Terminal', 'Wall Street, New York'],
  ['Central Park, New York', 'Brooklyn Bridge, New York'],
];

const newPoint = (place, lat, lon) => ({ mode: 'place', place, lat, lon });

// Một điểm (đi hoặc đến): nhập theo vị trí (tên địa điểm) hoặc theo tọa độ
function PointInput({ title, dot, value, onChange }) {
  const { t } = useI18n();
  const set = (patch) => onChange({ ...value, ...patch });
  // Dán "40.758, -73.9855" (copy từ Google Maps) vào ô vĩ độ thì tự tách
  const onLat = (text) => {
    const m = text.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,;\s]\s*(-?\d+(?:\.\d+)?)\s*$/);
    set(m ? { lat: m[1], lon: m[2] } : { lat: text });
  };
  return (
    <div className="point">
      <div className="point-head">
        <span className="point-title"><i className={dot} />{title}</span>
        <div className="seg small">
          <button type="button" className={value.mode === 'place' ? 'active' : ''} onClick={() => set({ mode: 'place' })}>{t('modePlace')}</button>
          <button type="button" className={value.mode === 'coords' ? 'active' : ''} onClick={() => set({ mode: 'coords' })}>{t('modeCoords')}</button>
        </div>
      </div>
      {value.mode === 'place' ? (
        <input value={value.place} onChange={(e) => set({ place: e.target.value })} placeholder={t('placePh')} required />
      ) : (
        <div className="row two tight">
          <label><span>{t('latLabel')}</span>
            <input value={value.lat} onChange={(e) => onLat(e.target.value)} placeholder="40.7580" inputMode="decimal" required />
          </label>
          <label><span>{t('lonLabel')}</span>
            <input value={value.lon} onChange={(e) => set({ lon: e.target.value })} placeholder="-73.9855" inputMode="decimal" required />
          </label>
        </div>
      )}
    </div>
  );
}

async function resolvePoint(p, fallbackLabel, t) {
  if (p.mode === 'place') {
    const g = await api(`/geocode?q=${encodeURIComponent(p.place)}`);
    return { lat: g.lat, lon: g.lon, label: p.place };
  }
  const lat = Number(p.lat);
  const lon = Number(p.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error(t('badCoords', { p: fallbackLabel }));
  }
  return { lat, lon, label: `${fallbackLabel} (${lat}, ${lon})` };
}

export default function ManualForm({ nycNow, onRoute, onPrediction }) {
  const { t, weekdays } = useI18n();
  const [from, setFrom] = useState(newPoint(PRESETS[0][0], '40.7580', '-73.9855'));
  const [to, setTo] = useState(newPoint(PRESETS[0][1], '40.6413', '-73.7781'));
  const [time, setTime] = useState({ pickup_month: 5, pickup_dayofweek: 4, pickup_hour: 18, pickup_minute: 0 });
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (nycNow) {
      setTime((x) => (x.touched ? x : {
        pickup_month: nycNow.month, pickup_dayofweek: nycNow.dayofweek,
        pickup_hour: nycNow.hour, pickup_minute: Math.floor(nycNow.minute / 15) * 15,
      }));
    }
  }, [nycNow]);

  const setT = (k, v) => setTime((x) => ({ ...x, [k]: Number(v), touched: true }));

  async function submit(e) {
    e.preventDefault();
    setError('');
    try {
      setBusy(t('busyGeo'));
      const [pickup, dropoff] = await Promise.all([resolvePoint(from, t('pickup'), t), resolvePoint(to, t('dropoff'), t)]);
      setBusy(t('busyRoute'));
      const route = await api('/route', { pickup, dropoff });
      onRoute(route);
      if (!route.model_inputs) throw new Error(t('noOsrm'));
      setBusy(t('busyModel'));
      const { touched, ...tm } = time;
      const { source, ...mi } = route.model_inputs;
      const p = await api('/predict', {
        pickup_lat: pickup.lat, pickup_lon: pickup.lon, dropoff_lat: dropoff.lat, dropoff_lon: dropoff.lon, ...tm, ...mi,
      });
      p.sources = { straight_line: 'haversine (làm tròn 0,5 km)', road: `OSRM theo ô 0,01° – ${source}` };
      onPrediction({ ...p, route });
    } catch (err) {
      setError(err.message);
    }
    setBusy('');
  }

  return (
    <form className="manual" onSubmit={submit}>
      <PointInput title={t('pickup')} dot="g" value={from} onChange={setFrom} />
      <PointInput title={t('dropoff')} dot="r" value={to} onChange={setTo} />

      <div className="presets">
        {PRESETS.map(([a, b]) => (
          <button type="button" key={a} onClick={() => { setFrom({ ...from, mode: 'place', place: a }); setTo({ ...to, mode: 'place', place: b }); }}>
            {a.split(',')[0]} → {b.split(',')[0]}
          </button>
        ))}
      </div>

      <div className="row four">
        <label><span>{t('month')}</span>
          <select value={time.pickup_month} onChange={(e) => setT('pickup_month', e.target.value)}>
            {Array.from({ length: 12 }, (_, i) => <option key={i} value={i + 1}>{t('monthOpt', { n: i + 1 })}{i >= 6 ? ' *' : ''}</option>)}
          </select>
        </label>
        <label><span>{t('weekday')}</span>
          <select value={time.pickup_dayofweek} onChange={(e) => setT('pickup_dayofweek', e.target.value)}>
            {weekdays.map((w, i) => <option key={w} value={i}>{w}</option>)}
          </select>
        </label>
        <label><span>{t('hour')}</span>
          <select value={time.pickup_hour} onChange={(e) => setT('pickup_hour', e.target.value)}>
            {Array.from({ length: 24 }, (_, i) => <option key={i} value={i}>{String(i).padStart(2, '0')}h</option>)}
          </select>
        </label>
        <label><span>{t('minute')}</span>
          <select value={time.pickup_minute} onChange={(e) => setT('pickup_minute', e.target.value)}>
            {[0, 15, 30, 45].map((m) => <option key={m} value={m}>{String(m).padStart(2, '0')}</option>)}
          </select>
        </label>
      </div>

      <div className="actions">
        <button className="primary" disabled={Boolean(busy)}>{busy || t('predictBtn')}</button>
        <small>{t('trainNote')}</small>
      </div>
      {error && <div className="warning">⚠️ {error}</div>}
    </form>
  );
}
