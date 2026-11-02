import React, { useEffect, useState } from 'react';
import { api } from './api.js';
import { useI18n } from './i18n.jsx';

export default function History({ tick }) {
  const { t, locale } = useI18n();
  const [items, setItems] = useState([]);
  useEffect(() => {
    api('/history').then(setItems).catch(() => setItems([]));
  }, [tick]);

  if (!items.length) return <p className="muted">{t('noHistory')}</p>;
  return (
    <div className="table-wrap">
      <table className="grid-table">
        <thead>
          <tr>
            <th>{t('thAt')}</th><th>{t('thSource')}</th><th>{t('pickup')}</th><th>{t('dropoff')}</th>
            <th>{t('straight')}</th><th>OSRM</th><th>{t('thPrediction')}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((h) => (
            <tr key={h.at}>
              <td>{new Date(h.at).toLocaleString(locale)}</td>
              <td><span className={`badge ${h.via === 'chat' ? 'ok' : ''}`}>{h.via === 'chat' ? 'Chatbot' : t('viaForm')}</span></td>
              <td>{h.pickup}</td>
              <td>{h.dropoff}</td>
              <td>{h.features.straight_line_km_approx} km</td>
              <td>{h.features.road_km_osrm} km</td>
              <td><b>{(h.seconds / 60).toFixed(1)} {t('min')}</b></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
