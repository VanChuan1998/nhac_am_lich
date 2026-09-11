import { today, toISO, formatSolar, formatLunar, solarToLunar, nextOccurrences, daysUntil } from './lunar.js';
import {
  isConnected, syncAll, pullFromCalendar, commitEventMap,
  connect, disconnect, isAuthLost
} from './gcal.js';

const ALARM = 'am-lich-daily-check';

// Cài xong là danh sách trống. Sự kiện âm lịch là chuyện riêng của từng nhà,
// không có cái nào hợp lý để đặt sẵn cho người lạ.

// Dữ liệu nằm trong storage.local: của riêng máy này, không rời khỏi máy.
// Tên ngày giỗ là chuyện riêng của mỗi nhà, không có lý do gì để nó đi qua
// máy chủ đồng bộ của trình duyệt.
async function getEvents() {
  const { events } = await chrome.storage.local.get('events');
  return Array.isArray(events) ? events : [];
}

async function setEvents(events) {
  await chrome.storage.local.set({ events });
}

/**
 * Bản cũ lưu ở storage.sync. Kéo dữ liệu đó về local một lần (để người đã cài
 * bản cũ không mất sự kiện), rồi XOÁ SẠCH vùng sync của extension này.
 *
 * clear() chỉ động tới dữ liệu của chính extension này — mỗi extension có vùng
 * lưu trữ riêng, không với tới dữ liệu của trình duyệt hay extension khác.
 *
 * Việc dọn chạy ở mọi lần khởi động, không chỉ một lần: như vậy vùng sync luôn
 * trống, kể cả khi có bản cũ nào đó ghi lại vào đó.
 */
async function clearSyncStorage() {
  try {
    const { migratedToLocal } = await chrome.storage.local.get('migratedToLocal');
    if (!migratedToLocal) {
      const { events: old } = await chrome.storage.sync.get('events');
      if (Array.isArray(old) && old.length) {
        const here = await getEvents();
        if (here.length === 0) await setEvents(old);
      }
      await chrome.storage.local.set({ migratedToLocal: true });
    }
    await chrome.storage.sync.clear();
  } catch { /* không có gì để dọn thì thôi */ }
}

// ---- Khởi tạo ----

chrome.runtime.onInstalled.addListener(async () => {
  await clearSyncStorage();
  await scheduleAlarm();
  await runCheck();
});

// Chạy mỗi lần mở Edge.
chrome.runtime.onStartup.addListener(async () => {
  await clearSyncStorage();
  await scheduleAlarm();
  await runCheck();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARM) await runCheck();
});

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area === 'local' && changes.events) await runCheck();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'recheck') {
    runCheck().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg?.type === 'sync-status') {
    getSyncStatus().then(sendResponse);
    return true;
  }
  if (msg?.type === 'sync-now') {
    pushToCalendar({ force: true }).then(sendResponse);
    return true;
  }
  // Đăng nhập/đăng xuất BẮT BUỘC chạy ở đây, không chạy trong trang Cài đặt.
  // Trình duyệt chỉ cho một luồng web auth chạy tại một thời điểm, mà trang Cài đặt
  // và service worker là hai ngữ cảnh JS tách biệt — mỗi bên nạp gcal.js một bản
  // riêng, nên khoá chống trùng trong module chỉ có tác dụng trong nội bộ một bên.
  // Người dùng bấm "Đăng nhập" đúng lúc nền đang tự gia hạn token là hai luồng
  // chồng nhau, và Google ném "Only one web auth flow is allowed at a time".
  // Dồn hết về service worker thì chỉ còn đúng một nơi mở luồng.
  if (msg?.type === 'connect') {
    connect()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, reason: e.message }));
    return true;
  }
  if (msg?.type === 'disconnect') {
    disconnect()
      .then(() => sendResponse({ ok: true }))
      .catch(e => sendResponse({ ok: false, reason: e.message }));
    return true;
  }
});

chrome.notifications.onClicked.addListener((id) => {
  chrome.notifications.clear(id);
});

async function scheduleAlarm() {
  // Kiểm tra lúc 8:00 sáng mỗi ngày, và lặp lại mỗi 6 tiếng phòng khi máy ngủ qua mốc đó.
  const now = new Date();
  const next = new Date(now);
  next.setHours(8, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  await chrome.alarms.create(ALARM, {
    when: next.getTime(),
    periodInMinutes: 360
  });
}

// ---- Kiểm tra và thông báo ----

async function runCheck() {
  const events = (await getEvents()).filter(e => e.enabled !== false);
  const from = today();
  const { notified = {} } = await chrome.storage.local.get('notified');
  let changed = false;
  let soonest = null;

  for (const ev of events) {
    const occs = nextOccurrences(ev, from, ev.month == null ? 400 : 800, 3);
    for (const occ of occs) {
      const left = daysUntil(occ, from);
      if (soonest === null || left < soonest.left) soonest = { left, ev, occ };

      for (const offset of (ev.remindDaysBefore || [0])) {
        if (left !== offset) continue;
        const key = `${ev.id}|${toISO(occ)}|${offset}`;
        if (notified[key]) continue;
        fireNotification(ev, occ, offset);
        notified[key] = Date.now();
        changed = true;
      }
    }
  }

  // Dọn các mốc đã báo quá 120 ngày. Chạy mỗi lượt, không chỉ khi vừa có thông báo
  // mới — người dùng có toàn ngày còn xa thì `changed` chẳng bao giờ đúng, và cái
  // bảng này cứ phình mãi.
  const cutoff = Date.now() - 120 * 864e5;
  for (const k of Object.keys(notified)) {
    if (notified[k] < cutoff) { delete notified[k]; changed = true; }
  }
  if (changed) await chrome.storage.local.set({ notified });

  await updateBadge(soonest);

  // Đẩy lên Google Calendar. Phải AWAIT: service worker của MV3 có thể ngủ ngay
  // sau khi phần đồng bộ của hàm chạy xong, và một promise thả trôi sẽ bị giết
  // giữa chừng — đó là lý do thêm/xoá trước đây không lên lịch cho tới khi bấm
  // nút hoặc chờ mốc kiểm tra sau.
  await pushToCalendar();
}

function fireNotification(ev, occ, offset) {
  const when = offset === 0 ? 'HÔM NAY'
    : offset === 1 ? 'NGÀY MAI'
    : `còn ${offset} ngày`;
  chrome.notifications.create(`${ev.id}-${toISO(occ)}-${offset}`, {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: `${ev.title} — ${when}`,
    message: `${formatSolar(occ)}\n${formatLunar(occ.lunar)}`,
    priority: 2,
    requireInteraction: offset === 0
  });
}

// ---- Google Calendar ----

// Cả lượt kéo-về-rồi-đẩy-lên phải xếp hàng, không chỉ riêng phần đẩy lên.
// syncAll tự xếp hàng cho doSync, nhưng pullFromCalendar thì nằm ngoài. Chuông báo
// 6 tiếng kêu đúng lúc người dùng bấm "Đồng bộ ngay" là hai lượt chạy chồng nhau:
// hai lượt cùng đọc một eventMap cũ, cùng thấy một sự kiện lạ trên lịch, cùng nhận
// nó về — danh sách có hai mục trùng id, hai thông báo "Đã nhận ngày mới", và lần
// ghi bản đồ sau đè mất lần trước.
let pushChain = Promise.resolve();

function pushToCalendar(opts = {}) {
  const run = pushChain.catch(() => {}).then(() => doPush(opts));
  pushChain = run.catch(() => {});
  return run;
}

async function doPush({ force = false } = {}) {
  if (!(await isConnected())) return { ok: false, reason: 'not-connected' };

  // Kéo về trước, đẩy lên sau. Hai bước nằm ở hai khối try riêng: trước đây
  // chung một khối, nên chỉ cần bước kéo về lỗi là bước đẩy lên không bao giờ
  // chạy — thêm hay xoá đều không lên tới lịch.
  let imported = [];
  let pullError = null;
  try {
    const { fresh, map } = await pullFromCalendar(await getEvents());
    imported = fresh;
    if (imported.length) await setEvents([...(await getEvents()), ...imported]);
    // Bản đồ ghi SAU danh sách sự kiện — thứ tự này là cố ý, xem ghi chú ở
    // pullFromCalendar. Ghi ngược lại thì một lần service worker bị ngắt giữa
    // chừng là lượt đồng bộ sau xoá thật sự kiện trên lịch của người dùng.
    await commitEventMap(map);
    if (imported.length) notifyImported(imported);
  } catch (e) {
    // Lỗi kéo về không còn bị nuốt trọn. Trước đây một cú 403 rate-limit hay 500
    // ở bước này biến mất không dấu vết, giao diện vẫn báo "Đã tạo/sửa…" như thể
    // đồng bộ hai chiều chạy trơn, còn phần nhận về thì âm thầm không bao giờ xảy ra.
    pullError = e.message;
    if (isAuthLost(e)) await warnAuthLost();
  }

  try {
    // Truyền hàm chứ không truyền mảng: lượt đồng bộ có thể phải xếp hàng chờ,
    // và khi tới lượt nó cần danh sách mới nhất, không phải bản chụp lúc gọi.
    const report = await syncAll(getEvents, { force });
    if (pullError) report.errors = [...report.errors, 'Kéo về: ' + pullError];
    return { ok: true, report, imported: imported.length };
  } catch (e) {
    if (isAuthLost(e)) await warnAuthLost();
    return { ok: false, reason: e.message, imported: imported.length };
  }
}

// Báo khi có ngày mới nhận về từ điện thoại, để việc này không diễn ra âm thầm.
function notifyImported(list) {
  const names = list.map(e => e.title).slice(0, 3).join(', ');
  chrome.notifications.create('am-lich-imported-' + Date.now(), {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: list.length === 1 ? 'Đã nhận 1 ngày mới' : `Đã nhận ${list.length} ngày mới`,
    message: `${names}${list.length > 3 ? '…' : ''}\nThêm từ Google Calendar.`,
    priority: 1
  });
}

// Báo một lần khi Google thu hồi quyền, để đồng bộ không chết âm thầm.
async function warnAuthLost() {
  const { authWarnedAt = 0 } = await chrome.storage.local.get('authWarnedAt');
  if (Date.now() - authWarnedAt < 7 * 864e5) return;
  await chrome.storage.local.set({ authWarnedAt: Date.now() });
  chrome.notifications.create('am-lich-auth', {
    type: 'basic',
    iconUrl: 'icons/icon128.png',
    title: 'Nhắc Âm Lịch — mất kết nối Google Calendar',
    message: 'Thông báo trên Edge vẫn chạy bình thường, nhưng lịch không còn được cập nhật. Mở Cài đặt của extension để kết nối lại.',
    priority: 2
  });
}

async function getSyncStatus() {
  const { gcal = {} } = await chrome.storage.local.get('gcal');
  return {
    connected: await isConnected(),
    configured: Boolean(gcal.clientId),
    lastSync: gcal.lastSync || null,
    lastSyncError: gcal.lastSyncError || null
  };
}

async function updateBadge(soonest) {
  if (!soonest) {
    await chrome.action.setBadgeText({ text: '' });
    return;
  }
  const { left, ev } = soonest;
  await chrome.action.setBadgeBackgroundColor({ color: left <= 1 ? '#c2410c' : '#3f6212' });
  await chrome.action.setBadgeText({ text: left === 0 ? '!' : String(Math.min(left, 99)) });
  await chrome.action.setTitle({
    title: left === 0 ? `${ev.title} — hôm nay` : `${ev.title} — còn ${left} ngày`
  });
}
