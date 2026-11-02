import React, { useState } from 'react';
import Icon from './Icon.jsx';
import { useI18n } from './i18n.jsx';

export default function ResultCard({ prediction: p, route }) {
  const { t, tr, weekdays, fmtDuration } = useI18n();
  const [open, setOpen] = useState(false);
  const r = p?.route || route;

  if (!p && !r) {
    return (
      <div className="card result empty">
        <div className="big-icon"><Icon name="clock" size={26} /></div>
        <p>{t('emptyResult')}</p>
      </div>
    );
  }

  const straight = r?.straight_line_km;
  const road = r?.road_google?.km ?? r?.road_osrm?.km;
  const detour = straight && road ? road / straight : null;
  const f = p?.features;

  return (
    <div className="card result">
      {p ? (
        <div className="hero">
          <div>
            <span className="label">{t('predicted')}</span>
            <div className="minutes">{(p.trip_duration_sec / 60).toFixed(1)}<small> {t('min')}</small></div>
            <span className="sub">{fmtDuration(p.trip_duration_sec)} · {Math.round(p.trip_duration_sec)} {t('sec')}</span>
          </div>
          <div className="when">
            <span>{weekdays[f.pickup_dayofweek]}</span>
            <b>{String(f.pickup_hour).padStart(2, '0')}:{String(f.pickup_minute_bucket).padStart(2, '0')}</b>
            <span>{t('monthN', { n: f.pickup_month })}</span>
          </div>
        </div>
      ) : (
        <div className="hero pending"><span className="label">{t('waiting')}</span></div>
      )}

      {r && (
        <div className="coords">
          {[['g', t('pickup'), r.pickup], ['r', t('dropoff'), r.dropoff]].map(([c, name, pt]) => (
            <div key={c} className="coord-row">
              <i className={c} />
              <div>
                <b>{pt.label || name}</b>
                <small>{t('lat')} {Number(pt.lat).toFixed(5)} · {t('lon')} {Number(pt.lon).toFixed(5)}</small>
              </div>
            </div>
          ))}
        </div>
      )}

      {r && (
        <div className="stats">
          <Stat label={t('straight')} value={straight?.toFixed(2)} unit="km" />
          <Stat label={r.road_google?.km ? t('roadGoogle') : t('roadOsrm')} value={road?.toFixed(2)} unit="km" />
          <Stat label={t('detour')} value={detour?.toFixed(2)} unit="×" />
        </div>
      )}

      {p?.catboost_sec && (
        <div className="compare">
          <span>{t('catboost')} <b>{(p.catboost_sec / 60).toFixed(1)} {t('min')}</b></span>
          <span>{t('latency')} {p.latency_ms} ms</span>
        </div>
      )}

      {p?.warnings?.map((w) => <div key={w} className="warning">⚠️ {tr(w)}</div>)}
      {r && !r.in_nyc && !p && <div className="warning">⚠️ {t('outsideNyc')}</div>}

      {f && (
        <>
          <button className="link" onClick={() => setOpen(!open)}>{open ? t('hideFeatures') : t('showFeatures')}</button>
          {open && (
            <table className="features">
              <tbody>
                {Object.entries(f).map(([k, v]) => (
                  <tr key={k}><td>{k}</td><td>{v}</td></tr>
                ))}
                <tr><td colSpan={2} className="src">{t('srcStraight')}: {tr(p.sources.straight_line)} · {t('srcRoad')}: {tr(p.sources.road)}</td></tr>
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, unit }) {
  return (
    <div className="stat">
      <span>{label}</span>
      <b>{value ?? '–'}<small> {unit}</small></b>
    </div>
  );
}
