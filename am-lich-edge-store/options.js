// Cố tình KHÔNG nhập connect/disconnect: luồng đăng nhập chỉ được mở ở service
// worker (xem ghi chú trong background.js). Ở đây chỉ gửi tin nhắn nhờ nó làm.
import { getConfig, getCustomKeys, setCustomKeys, redirectUri, isConnected } from './gcal.js';

async function ask(type) {
  const res = await chrome.runtime.sendMessage({ type });
  if (!res?.ok) throw new Error(res?.reason || 'Không thực hiện được.');
  return res;
}

const $ = (id) => document.getElementById(id);

function say(msg, kind = '') {
  const el = $('result');
  el.textContent = msg;
  el.className = 'note ' + kind;
}

function timeAgo(ts) {
  if (!ts) return 'chưa đồng bộ lần nào';
  const mins = Math.round((Date.now() - ts) / 60000);
  if (mins < 1) return 'vừa xong';
  if (mins < 60) return `${mins} phút trước`;
  const h = Math.round(mins / 60);
  if (h < 24) return `${h} giờ trước`;
  return `${Math.round(h / 24)} ngày trước`;
}

async function refreshStatus() {
  const cfg = await getConfig();
  const on = await isConnected();
  $('dot').className = 'dot ' + (on ? 'on' : '');

  if (on) {
    $('status-text').textContent = 'Đã kết nối Google Calendar';
    $('status-sub').textContent = cfg.lastSyncError
      ? 'Lần đồng bộ gần nhất có lỗi: ' + cfg.lastSyncError
      : 'Đồng bộ lần cuối ' + timeAgo(cfg.lastSync);
    $('connect').textContent = 'Đăng nhập lại';
    $('connect').className = '';
  } else {
    $('status-text').textContent = 'Chưa kết nối';
    $('status-sub').textContent = 'Bấm nút bên dưới và chọn tài khoản Google của bạn.';
    $('connect').textContent = 'Đăng nhập bằng Google';
    $('connect').className = 'primary';
  }

  $('syncnow').disabled = !on;
  $('disconnect').disabled = !on;
}

// Đồng bộ luôn chạy trong service worker, không chạy song song ở đây —
// hai lượt chồng nhau có thể nhân đôi sự kiện trên lịch.
async function pushAll() {
  const res = await chrome.runtime.sendMessage({ type: 'sync-now' });
  if (!res?.ok) throw new Error(res?.reason || 'Không đồng bộ được.');
  return res.report;
}

$('connect').addEventListener('click', async () => {
  say('Đang mở cửa sổ đăng nhập Google…');
  try {
    await ask('connect');
    say('Kết nối xong. Đang đẩy sự kiện lên lịch…', 'good');
    const r = await pushAll();
    say(report(r), r.errors.length ? 'bad' : 'good');
  } catch (e) {
    say('Không kết nối được: ' + e.message, 'bad');
  }
  refreshStatus();
});

$('syncnow').addEventListener('click', async () => {
  say('Đang đồng bộ…');
  try {
    const r = await pushAll();
    say(report(r), r.errors.length ? 'bad' : 'good');
  } catch (e) {
    say('Lỗi: ' + e.message, 'bad');
  }
  refreshStatus();
});

$('disconnect').addEventListener('click', async () => {
  try {
    await ask('disconnect');
  } catch (e) {
    say('Không ngắt được: ' + e.message, 'bad');
    refreshStatus();
    return;
  }
  say('Đã ngắt kết nối. Các sự kiện đã tạo vẫn còn trên Google Calendar.');
  refreshStatus();
});

$('cfg').addEventListener('submit', async (e) => {
  e.preventDefault();
  await setCustomKeys({
    clientId: $('clientId').value.trim(),
    clientSecret: $('clientSecret').value.trim()
  });
  say('Đã lưu khoá riêng. Bấm "Đăng nhập lại" để dùng khoá mới.', 'good');
  refreshStatus();
});

$('clearkeys').addEventListener('click', async () => {
  await setCustomKeys({ clientId: '', clientSecret: '' });
  $('clientId').value = '';
  $('clientSecret').value = '';
  say('Đã quay về dùng khoá sẵn có.', 'good');
  refreshStatus();
});

function report(r) {
  const bits = [];
  if (r.created) bits.push(`tạo mới ${r.created}`);
  if (r.updated) bits.push(`cập nhật ${r.updated}`);
  if (r.deleted) bits.push(`xoá ${r.deleted}`);
  if (r.skipped) bits.push(`bỏ qua ${r.skipped} (không đổi)`);
  const head = bits.length ? 'Đồng bộ xong — ' + bits.join(', ') + '.' : 'Đồng bộ xong, không có gì thay đổi.';
  return r.errors.length ? head + ' Lỗi: ' + r.errors.join(' · ') : head;
}

document.querySelectorAll('[data-copy]').forEach(btn => {
  btn.addEventListener('click', async () => {
    await navigator.clipboard.writeText($(btn.dataset.copy).textContent);
    const old = btn.textContent;
    btn.textContent = 'Đã chép';
    setTimeout(() => { btn.textContent = old; }, 1400);
  });
});

(async () => {
  $('redirect').textContent = redirectUri();
  const keys = await getCustomKeys();
  $('clientId').value = keys.clientId;
  $('clientSecret').value = keys.clientSecret;
  refreshStatus();
})();
