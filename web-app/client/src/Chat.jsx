import React, { useEffect, useRef, useState } from 'react';
import { streamChat } from './api.js';
import { renderMarkdown } from './markdown.js';
import TripCard from './TripCard.jsx';
import Logo from './Logo.jsx';
import Icon from './Icon.jsx';
import { useI18n } from './i18n.jsx';

// Câu ví dụ cuối là yêu cầu chạy trên bộ Test, các câu còn lại là chuyến đi
const exampleIcon = (i, n) => (i === n - 1 ? 'table' : 'route');

// Số liệu của thẻ chuyến đi được gửi kèm lịch sử để LLM trả lời đúng các câu hỏi tiếp theo
function tripNote(trips) {
  if (!trips?.length) return '';
  return trips.map((t) => {
    const r = t.route || {};
    return `\n[Chuyến đã dự đoán: đi ${r.pickup?.label || ''} (${r.pickup?.lat}, ${r.pickup?.lon}) → đến ${r.dropoff?.label || ''} `
      + `(${r.dropoff?.lat}, ${r.dropoff?.lon}); chim bay ${r.straight_line_km} km; đường thực tế ${t.features.road_km_osrm} km; `
      + `dự đoán ${Math.round(t.trip_duration_sec)} giây; đặc trưng ${JSON.stringify(t.features)}]`;
  }).join('');
}

export default function Chat({ onRoute, onPrediction, onNavigate }) {
  const { t, lang } = useI18n();
  const examples = t('examples');
  // Lời chào hiển thị theo ngôn ngữ đang chọn, không nằm trong hội thoại gửi cho LLM
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scroller = useRef(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const patchLast = (fn) => setMessages((ms) => [...ms.slice(0, -1), fn(ms[ms.length - 1])]);

  async function send(text) {
    const q = text.trim();
    if (!q || busy) return;
    setInput('');
    setBusy(true);
    const convo = [...messages.filter((m) => m.content), { role: 'user', content: q }];
    setMessages((ms) => [...ms, { role: 'user', content: q }, { role: 'assistant', content: '', steps: [] }]);
    try {
      await streamChat(convo.map(({ role, content, trips }) => ({ role, content: content + tripNote(trips) })), (ev) => {
        if (ev.type === 'step') {
          patchLast((m) => {
            const steps = [...m.steps];
            const i = steps.findIndex((s) => s.id === ev.id);
            if (i >= 0) steps[i] = { ...steps[i], ...ev };
            else steps.push(ev);
            return { ...m, steps };
          });
        } else if (ev.type === 'route') onRoute(ev.data);
        else if (ev.type === 'prediction') {
          onPrediction(ev.data);
          patchLast((m) => ({ ...m, trips: [...(m.trips || []), ev.data] }));
        }
        else if (ev.type === 'navigate') onNavigate?.(ev);
        else if (ev.type === 'message') patchLast((m) => ({ ...m, content: ev.content }));
        else if (ev.type === 'error') patchLast((m) => ({ ...m, content: `⚠️ ${ev.message}`, error: true }));
      }, lang);
    } catch (e) {
      patchLast((m) => ({ ...m, content: `⚠️ ${e.message}`, error: true }));
    }
    setBusy(false);
  }

  return (
    <div className="chat">
      <div className="chat-head">
        <Logo size={36} />
        <div>
          <h2>Taxi AI</h2>
          <span><i className={busy ? 'busy' : ''} />{busy ? t('chatBusy') : t('chatIdle')}</span>
        </div>
      </div>
      <div className="messages" ref={scroller}>
        {[{ role: 'assistant', content: t('welcome') }, ...messages].map((m, i, all) => (
          <div key={i} className={`msg ${m.role} ${m.error ? 'error' : ''}`}>
            {m.role === 'assistant' && <Logo size={30} className="avatar" />}
            <div className="msg-body">
              {m.steps?.length > 0 && (
                <ol className="steps">
                  {m.steps.map((s) => (
                    <li key={s.id} className={s.status}>
                      <span className="dot" />
                      <div>
                        <b>{s.label}</b>
                        {s.detail && <small>{s.detail}</small>}
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              {m.trips?.map((t, j) => <TripCard key={j} trip={t} />)}
              {m.content
                ? <div className="bubble" dangerouslySetInnerHTML={{ __html: renderMarkdown(m.content) }} />
                : m.role === 'assistant' && busy && i === all.length - 1 && <div className="typing"><i /><i /><i /></div>}
            </div>
          </div>
        ))}
        {messages.length === 0 && (
          <div className="examples">
            <small>{t('tryAsk')}</small>
            {examples.map((e, i) => (
              <button key={e} onClick={() => send(e)}>
                <Icon name={exampleIcon(i, examples.length)} size={16} />
                <span>{e}</span>
                <Icon name="arrow" size={15} />
              </button>
            ))}
          </div>
        )}
      </div>
      <form className="composer" onSubmit={(e) => { e.preventDefault(); send(input); }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('chatPlaceholder')}
          disabled={busy}
        />
        <button type="submit" disabled={busy || !input.trim()} aria-label={t('send')}><Icon name="send" size={18} /></button>
      </form>
    </div>
  );
}
