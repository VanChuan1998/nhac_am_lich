import { today, formatSolar, formatLunar, solarToLunar, nextOccurrences, daysUntil } from './lunar.js';

const $ = (id) => document.getElementById(id);
const listEl = $('list');
const emptyEl = $('empty');
const formEl = $('form');

let events = [];
let expanded = new Set();

// ---- Hôm nay ----
function renderToday() {
  const t = today();
  $('t-solar').textContent = formatSolar({ d: t.d, m: t.m, y: t.y });
  $('t-lunar').textContent = formatLunar(solarToLunar(t.d, t.m, t.y));
}

// ---- Danh sách ----
function ruleText(ev) {
  const base = ev.onceDate
    ? `Ngày ${ev.day}/${ev.month} âm lịch · chỉ một lần`
    : ev.month == null
      ? `Ngày ${ev.day} âm lịch hàng tháng`
      : `Ngày ${ev.day}/${ev.month} âm lịch hàng năm`;
  const rem = (ev.remindDaysBefore || []).slice().sort((a, b) => b - a)
    .map(n => n === 0 ? 'đúng ngày' : `trước ${n} ngày`).join(', ');
  return rem ? `${base} · nhắc ${rem}` : base;
}

function render() {
  listEl.textContent = '';
  emptyEl.hidden = events.length > 0;
  const from = today();

  for (const ev of events) {
    const occs = nextOccurrences(ev, from, ev.month == null ? 400 : 2000, 4);
    const next = occs[0];
    const left = next ? daysUntil(next, from) : null;

    const card = document.createElement('div');
    card.className = 'card';

    const top = document.createElement('div');
    top.className = 'card-top';
    const title = document.createElement('div');
    title.className = 'card-title' + (ev.enabled === false ? ' off' : '');
    title.textContent = ev.title;
    top.append(title);

    if (next && ev.enabled !== false) {
      const badge = document.createElement('span');
      badge.className = 'count' + (left <= 1 ? ' hot' : '');
      badge.textContent = left === 0 ? 'Hôm nay' : left === 1 ? 'Ngày mai' : `${left} ngày`;
      top.append(badge);
    }
    card.append(top);

    const sub = document.createElement('div');
    sub.className = 'card-sub';
    if (next) {
      sub.textContent = `${formatSolar(next)} · ${next.lunar.day}/${next.lunar.month} âm`;
    } else if (ev.onceDate) {
      // Sự kiện một lần đã diễn ra — nói rõ thay vì báo như một lỗi.
      sub.textContent = `Đã qua — ${formatSolar(ev.onceDate)}`;
    } else {
      sub.textContent = 'Không tìm thấy ngày phù hợp';
    }
    card.append(sub);

    const rule = document.createElement('div');
    rule.className = 'card-rule';
    rule.textContent = ruleText(ev);
    card.append(rule);

    if (expanded.has(ev.id) && occs.length > 1) {
      const more = document.createElement('div');
      more.className = 'card-more';
      for (const o of occs.slice(1)) {
        const row = document.createElement('div');
        row.textContent = `${formatSolar(o)} — ${o.lunar.day}/${o.lunar.month} âm`;
        more.append(row);
      }
      card.append(more);
    }

    const actions = document.createElement('div');
    actions.className = 'card-actions';

    if (occs.length > 1) {
      const b = document.createElement('button');
      b.className = 'link';
      b.textContent = expanded.has(ev.id) ? 'Thu gọn' : 'Xem các lần sau';
      b.onclick = () => { expanded.has(ev.id) ? expanded.delete(ev.id) : expanded.add(ev.id); render(); };
      actions.append(b);
    }

    const t = document.createElement('button');
    t.className = 'link';
    t.textContent = ev.enabled === false ? 'Bật lại' : 'Tạm tắt';
    t.onclick = async () => { ev.enabled = ev.enabled === false; await save(); };
    actions.append(t);

    const del = document.createElement('button');
    del.className = 'link danger';
    del.textContent = 'Xoá';
    del.onclick = async () => {
      events = events.filter(e => e.id !== ev.id);
      await save();
    };
    actions.append(del);

    card.append(actions);
    listEl.append(card);
  }
}

async function save() {
  // storage.local: dữ liệu ở lại máy này, không đồng bộ đi đâu.
  // Việc ghi tự kích hoạt runCheck bên service worker qua storage.onChanged.
  await chrome.storage.local.set({ events });
  render();
}

// ---- Form ----
function fillSelects() {
  const dayEl = $('f-day');
  for (let i = 1; i <= 30; i++) {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = String(i);
    dayEl.append(o);
  }
  const monthEl = $('f-month');
  for (let i = 1; i <= 12; i++) {
    const o = document.createElement('option');
    o.value = String(i);
    o.textContent = i === 1 ? 'Tháng Giêng' : i === 12 ? 'Tháng Chạp' : `Tháng ${i}`;
    monthEl.append(o);
  }
}

function syncFormVisibility() {
  // "Hàng năm" và "Một lần" đều cần biết tháng âm; chỉ "Hàng tháng" thì không.
  $('wrap-month').hidden = $('f-repeat').value === 'monthly';
  $('wrap-fallback').hidden = $('f-day').value !== '30';
}

$('f-repeat').addEventListener('change', syncFormVisibility);
$('f-day').addEventListener('change', syncFormVisibility);

$('toggle-add').addEventListener('click', () => {
  formEl.hidden = !formEl.hidden;
  if (!formEl.hidden) $('f-title').focus();
});
$('cancel').addEventListener('click', () => { formEl.hidden = true; formEl.reset(); syncFormVisibility(); });

formEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const remind = ['r7', 'r1', 'r0'].filter(id => $(id).checked).map(id => Number($(id).value));
  const repeat = $('f-repeat').value;

  const ev = {
    id: 'ev-' + Date.now().toString(36),
    title: $('f-title').value.trim() || 'Nhắc âm lịch',
    day: Number($('f-day').value),
    month: repeat === 'monthly' ? null : Number($('f-month').value),
    skipLeap: $('f-skipleap').checked,
    shortMonthFallback: $('f-fallback').checked,
    remindDaysBefore: remind.length ? remind : [0],
    enabled: true
  };

  // Với sự kiện một lần, chốt luôn ngày dương của lần tới và lưu lại.
  // Nếu chỉ lưu ngày âm, sang năm nó sẽ tự nhắc lại — không đúng ý "một lần".
  if (repeat === 'once') {
    const hit = nextOccurrences({ ...ev, onceDate: null }, today(), 2000, 1)[0];
    if (!hit) {
      alert('Không tìm được ngày dương cho ngày âm này. Thử ngày khác.');
      return;
    }
    ev.onceDate = { d: hit.d, m: hit.m, y: hit.y };
  }

  events.push(ev);
  await save();
  formEl.hidden = true;
  formEl.reset();
  syncFormVisibility();
});

// ---- Trạng thái đồng bộ Google Calendar ----
function ago(ts) {
  if (!ts) return 'chưa đồng bộ';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'vừa xong';
  if (m < 60) return `${m} phút trước`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} giờ trước` : `${Math.round(h / 24)} ngày trước`;
}

async function renderSync() {
  let s;
  try {
    s = await chrome.runtime.sendMessage({ type: 'sync-status' });
  } catch { s = null; }
  if (!s) return;

  const dot = $('sync-dot');
  const text = $('sync-text');
  const btn = $('sync-btn');

  if (s.connected) {
    dot.className = 'sync-dot ' + (s.lastSyncError ? 'off' : 'on');
    text.textContent = s.lastSyncError
      ? 'Google Calendar: lỗi đồng bộ'
      : 'Google Calendar · ' + ago(s.lastSync);
    text.title = s.lastSyncError || '';
    btn.hidden = false;
  } else {
    dot.className = 'sync-dot';
    text.textContent = s.configured ? 'Google Calendar: chưa kết nối' : 'Chưa bật đồng bộ lịch';
    btn.hidden = true;
  }
}

$('sync-setup').addEventListener('click', () => chrome.runtime.openOptionsPage());

$('sync-btn').addEventListener('click', async () => {
  const text = $('sync-text');
  text.textContent = 'Đang đồng bộ…';

  let res;
  try {
    res = await chrome.runtime.sendMessage({ type: 'sync-now' });
  } catch (e) {
    // Service worker chết hoặc không phản hồi — trước đây lỗi này biến mất
    // hoàn toàn, khiến việc đồng bộ trông như "không có gì xảy ra".
    text.textContent = 'Không gọi được nền: ' + e.message;
    text.title = e.message;
    return;
  }

  // Đồng bộ có thể nhận ngày mới từ Google Calendar về. Đọc lại danh sách
  // rồi vẽ lại, nếu không popup vẫn hiện dữ liệu cũ cho tới khi mở lại.
  await reload();

  if (!res) { text.textContent = 'Nền không trả lời'; return; }

  if (!res.ok) {
    const why = res.reason === 'not-connected'
      ? 'Chưa kết nối Google — mở Cài đặt để đăng nhập'
      : 'Lỗi: ' + (res.reason || 'không rõ');
    text.textContent = why;
    text.title = why;
    return;
  }

  const r = res.report || {};
  const bits = [];
  if (res.imported) bits.push(`nhận ${res.imported}`);
  if (r.created) bits.push(`tạo ${r.created}`);
  if (r.updated) bits.push(`sửa ${r.updated}`);
  if (r.deleted) bits.push(`xoá ${r.deleted}`);
  if (r.errors?.length) {
    text.textContent = 'Lỗi: ' + r.errors[0];
    text.title = r.errors.join(' · ');
    return;
  }
  text.textContent = bits.length ? 'Đã ' + bits.join(', ') : 'Không có gì thay đổi';
  text.title = '';
  setTimeout(renderSync, 2500);
});

// ---- Khởi động ----
async function reload() {
  const { events: stored } = await chrome.storage.local.get('events');
  events = Array.isArray(stored) ? stored : [];
  render();
}

// Service worker có thể thêm sự kiện (nhận từ Google Calendar) hoặc đổi dữ liệu
// trong lúc popup đang mở. Không lắng nghe thì danh sách đứng im.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.events) return;
  const next = changes.events.newValue;
  events = Array.isArray(next) ? next : [];
  render();
});

(async () => {
  fillSelects();
  syncFormVisibility();
  renderToday();
  await reload();
  renderSync();
})();
