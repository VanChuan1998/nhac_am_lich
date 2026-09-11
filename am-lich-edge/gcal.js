// Đồng bộ Google Calendar — OAuth 2.0 Authorization Code + PKCE.
// Chỉ xin quyền quản lý sự kiện (calendar.events), không đọc gì khác.

import { nextOccurrences, today } from './lunar.js';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events';
const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';

// Client ID nhúng sẵn — đăng ký cho chính extension này. Client ID KHÔNG phải bí mật:
// nó lộ ra trong mọi luồng OAuth theo thiết kế, và tự nó không mở được dữ liệu của ai.
// Cố tình KHÔNG nhúng client secret: gói cài là công khai, ai cũng giải nén được, nên
// mọi bí mật đặt ở đây đều không còn là bí mật.
//
// VÌ SAO LÀ IMPLICIT, VÀ VÌ SAO KHÔNG PHẢI PKCE.
// Đã thử đi đường Authorization Code + PKCE với client loại "Chrome Extension"
// (client public, không cần secret). Không chạy: loại client đó dành cho
// chrome.identity.getAuthToken — API chỉ có trên Chrome, đòi profile Chrome đã
// đăng nhập và đòi extension nằm trên Chrome Web Store. Nó KHÔNG nhận redirect
// kiểu https://<id>.chromiumapp.org, nên launchWebAuthFlow luôn nhận
// redirect_uri_mismatch.
//
// launchWebAuthFlow chỉ chạy với client loại "Web application" khai chromiumapp.org
// vào Authorized redirect URIs — mà loại đó lại BẮT BUỘC có client_secret khi đổi
// mã lấy token, kể cả có PKCE. Gói cài là công khai nên không thể giấu secret.
//
// Vậy nên: không tồn tại cách bỏ implicit mà vẫn chạy hoàn toàn trong máy. Muốn
// dùng luồng code thì phải có một nơi giữ secret để đổi mã hộ (Cloudflare Worker
// chẳng hạn). Chừng nào chưa có nơi đó, implicit là lựa chọn đúng — và nó vẫn an
// toàn ở những điểm quan trọng: có state chống CSRF, có kiểm redirect, token chỉ
// nằm trong máy này.
const CLIENT_IDS = {
  // Cùng một client "Web application" cho cả hai bản cài. Khác với loại Chrome
  // Extension (gắn cứng một Item ID), loại này khai được nhiều redirect URI —
  // nên chỉ cần một client, thêm cả hai địa chỉ chromiumapp.org vào là xong.
  cemmlajomccdedhdfcnokebdojdbkgip: '207231627982-fmou9244ot2n0p6i10upo20oln0rso7o.apps.googleusercontent.com',
  klcbbckmfblinnkfdjfmfaldkapjahpd: '207231627982-fmou9244ot2n0p6i10upo20oln0rso7o.apps.googleusercontent.com'
};

function builtinClientId() {
  // Bản cài lạ (ID khác hai bản trên) vẫn dùng chung client; nếu redirect của nó
  // chưa được khai bên Google thì lỗi báo ra sẽ nói rõ địa chỉ cần thêm.
  return CLIENT_IDS[chrome.runtime.id]
    || '207231627982-fmou9244ot2n0p6i10upo20oln0rso7o.apps.googleusercontent.com';
}

const BUILTIN_CLIENT_SECRET = '';

/**
 * Mất phiên đăng nhập — cần người dùng cấp quyền lại.
 *
 * Dùng lớp lỗi riêng thay vì để bên gọi dò chữ trong thông báo. Bản trước dò
 * `/thu hồi|invalid_grant|Chưa kết nối/` nhưng không câu thông báo nào chứa những
 * chữ đó, nên cảnh báo "mất kết nối Google Calendar" chẳng bao giờ hiện: đồng bộ
 * chết âm thầm, người dùng chỉ thấy một dòng chữ xám trong popup.
 */
export class AuthLostError extends Error {
  constructor(message) { super(message); this.name = 'AuthLostError'; }
}

export function isAuthLost(e) {
  return e instanceof AuthLostError || e?.name === 'AuthLostError';
}

export function redirectUri() {
  return chrome.identity.getRedirectURL();
}

// Hai khoá storage tách biệt, và đây là chuyện đúng đắn chứ không phải rườm rà.
//   'gcal'     — token, hạn token, eventMap. CHỈ service worker ghi.
//   'gcalKeys' — Client ID/secret người dùng tự nhập. CHỈ trang Cài đặt ghi.
// Trước đây cả hai nằm chung một khoá, mà ghi vào storage là đọc-sửa-ghi cả cụm.
// Người dùng bấm "Lưu khoá riêng" đúng lúc nền vừa đồng bộ xong thì bản chụp cũ
// của trang Cài đặt ghi đè lên, cuốn theo cả eventMap vừa lưu lẫn access token
// vừa gia hạn. Tách khoá ra thì hai bên không còn giẫm lên nhau nữa.
export async function getConfig() {
  const { gcal = {}, gcalKeys = {} } = await chrome.storage.local.get(['gcal', 'gcalKeys']);
  // Khoá tự nhập (nếu có) được ưu tiên; không thì dùng khoá nhúng sẵn.
  return {
    ...gcal,
    clientId: gcalKeys.clientId || builtinClientId(),
    // Secret chỉ có khi người dùng tự nhập khoá riêng (client loại Web application).
    // Khoá nhúng sẵn không đi kèm secret — xem ghi chú ở đầu file.
    clientSecret: gcalKeys.clientId ? (gcalKeys.clientSecret || '') : BUILTIN_CLIENT_SECRET,
    usingBuiltinKeys: !gcalKeys.clientId
  };
}

/** Khoá do người dùng tự nhập, không tính khoá nhúng sẵn. */
export async function getCustomKeys() {
  const { gcalKeys = {}, gcal = {} } = await chrome.storage.local.get(['gcalKeys', 'gcal']);
  // Bản cũ để khoá riêng chung cụm 'gcal' — vẫn đọc được để không mất của ai.
  return {
    clientId: gcalKeys.clientId ?? gcal.clientId ?? '',
    clientSecret: gcalKeys.clientSecret ?? gcal.clientSecret ?? ''
  };
}

/** Lưu khoá riêng. Chỉ trang Cài đặt gọi. */
export async function setCustomKeys({ clientId, clientSecret }) {
  await chrome.storage.local.set({
    gcalKeys: { clientId: clientId || '', clientSecret: clientSecret || '' }
  });
}

export async function setConfig(patch) {
  // Ghi vào storage thô, không kéo theo khoá nhúng sẵn.
  const { gcal = {} } = await chrome.storage.local.get('gcal');
  const next = { ...gcal, ...patch };
  await chrome.storage.local.set({ gcal: next });
  return next;
}

export async function isConnected() {
  const c = await getConfig();
  return Boolean(c.refreshToken || (c.everConnected && c.accessToken));
}

// ---- PKCE ----

function randomVerifier() {
  const bytes = crypto.getRandomValues(new Uint8Array(48));
  return b64url(bytes);
}

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function challengeFor(verifier) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

// ---- Đăng nhập ----

export async function connect() {
  return runAuthFlow({ interactive: true });
}

/**
 * Chạy luồng OAuth.
 *  interactive = true  → mở cửa sổ đăng nhập, xin consent (lấy được refresh token).
 *  interactive = false → thử lại lặng lẽ (prompt=none). Nếu phiên Google trong
 *                        trình duyệt còn sống và người dùng đã từng cấp quyền,
 *                        Google trả token ngay mà không hiện gì cả.
 * Nhờ nhánh lặng lẽ này, việc refresh token hết hạn sau 7 ngày (do app ở trạng
 * thái Testing) hầu như không bao giờ làm phiền người dùng.
 */
// Trình duyệt chỉ cho MỘT luồng web auth chạy tại một thời điểm; mở luồng thứ hai
// là ném "Only one web auth flow is allowed at a time".
//
// Chuyện này xảy ra rất dễ: accessToken() được gọi ở đầu MỌI lệnh gọi API, nên khi
// token hết hạn mà có vài lệnh chạy song song (đẩy nhiều sự kiện, hoặc vừa kéo về
// vừa đẩy lên), mỗi lệnh lại tự mở một luồng đăng nhập ngầm. Người dùng bấm "Kết nối"
// đúng lúc nền đang gia hạn cũng ra lỗi y hệt.
//
// Vì vậy: XẾP HÀNG, không phải "kiểm tra rồi mới chạy".
//
// Bản trước dùng kiểu "nếu đang có luồng thì đợi, đợi xong kiểm token, chưa có thì
// tự mở". Kiểu đó vẫn hở: khi luồng đang chạy thất bại, MỌI kẻ đang đợi cùng thức
// dậy, cùng thấy không có token, và giữa lúc kiểm token với lúc ghi cờ lại có một
// điểm chờ nữa (đọc storage) — nên hai kẻ cùng lọt qua và cùng mở luồng. Đúng cái
// lỗi này. Nối đuôi tuyệt đối thì không còn khe nào để lọt.
let authChain = Promise.resolve();

function runAuthFlow(opts = {}) {
  const run = authChain.catch(() => {}).then(async () => {
    // Luồng ngay trước có thể vừa lấy được token — khỏi mở thêm cửa sổ nữa.
    // Riêng lần người dùng tự bấm đăng nhập thì vẫn chạy, vì họ đang muốn
    // cấp lại quyền chứ không phải chỉ cần một token còn hạn.
    if (!opts.interactive) {
      const c = await getConfig();
      if (c.accessToken && c.expiresAt > Date.now()) return true;
    }
    return doAuthFlow(opts);
  });
  authChain = run.catch(() => {});
  return run;
}

/**
 * Gọi launchWebAuthFlow, có chờ lại nếu trình duyệt bảo đang bận.
 *
 * Xếp hàng ở trên chỉ quản được những luồng do chính bản đang chạy mở ra. Một luồng
 * cũ còn treo — cửa sổ đăng nhập lần trước chưa đóng hẳn, hoặc service worker vừa
 * bị thay mà trình duyệt chưa gỡ đăng ký — thì nằm ngoài tầm với. Trường hợp đó chờ
 * một nhịp rồi thử lại, thay vì ném thẳng lỗi khó hiểu vào mặt người dùng.
 */
async function launchOnce(opts, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      return await chrome.identity.launchWebAuthFlow(opts);
    } catch (e) {
      const busy = /only one web auth flow/i.test(e?.message || '');
      if (!busy || i >= tries - 1) throw e;
      await new Promise(r => setTimeout(r, 700 * (i + 1)));
    }
  }
}

async function doAuthFlow({ interactive }) {
  const { clientId, clientSecret } = await getConfig();
  if (!clientId) {
    throw new Error(
      `Bản cài này (ID ${chrome.runtime.id}) chưa có Client ID kèm sẵn. ` +
      'Mở phần Cài đặt để dán Client ID của riêng bạn vào.');
  }

  // Không có client secret thì đi implicit — xem ghi chú dài ở đầu file về việc
  // vì sao PKCE không thay thế được ở đây. Có secret (người dùng tự khai khoá
  // riêng loại Web application) thì đi Authorization Code + PKCE, tốt hơn hẳn.
  const implicit = !clientSecret;

  const verifier = randomVerifier();
  const state = randomVerifier();

  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri());
  url.searchParams.set('scope', SCOPE);
  url.searchParams.set('prompt', interactive ? 'consent' : 'none');
  url.searchParams.set('state', state);
  if (implicit) {
    url.searchParams.set('response_type', 'token');
  } else {
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('code_challenge', await challengeFor(verifier));
    url.searchParams.set('code_challenge_method', 'S256');
  }

  const redirect = await launchOnce({ url: url.toString(), interactive });
  if (!redirect) throw new Error(interactive ? 'Đăng nhập bị huỷ.' : 'Không đăng nhập lại ngầm được.');

  // Chỉ chấp nhận đúng redirect URI của extension này.
  const back = new URL(redirect);
  const expected = new URL(redirectUri());
  if (back.origin !== expected.origin || back.pathname !== expected.pathname) {
    throw new Error('Redirect không hợp lệ.');
  }

  // Implicit trả kết quả trong fragment (#...), code flow trả trong query (?...).
  const params = implicit
    ? new URLSearchParams(back.hash.replace(/^#/, ''))
    : back.searchParams;

  const err = params.get('error');
  if (err) throw new Error('Google trả về lỗi: ' + err);
  // State vẫn kiểm ở cả hai luồng — đây là phần chống CSRF, không dính gì tới
  // việc chọn implicit hay code.
  if (params.get('state') !== state) throw new Error('State không khớp — huỷ để an toàn.');

  if (implicit) {
    const token = params.get('access_token');
    if (!token) throw new AuthLostError('Không nhận được access token.');
    await setConfig({
      accessToken: token,
      expiresAt: Date.now() + lifetime(params.get('expires_in')),
      everConnected: true
    });
    return true;
  }

  const code = params.get('code');
  if (!code) throw new Error('Không nhận được mã uỷ quyền.');

  const body = new URLSearchParams({
    code,
    client_id: clientId,
    redirect_uri: redirectUri(),
    grant_type: 'authorization_code',
    code_verifier: verifier
  });
  // Client public không có secret — gửi client_secret rỗng là Google từ chối.
  if (clientSecret) body.set('client_secret', clientSecret);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const data = await res.json();
  if (!res.ok) throw new Error(describe(data));

  await setConfig({
    accessToken: data.access_token,
    expiresAt: Date.now() + lifetime(data.expires_in),
    refreshToken: data.refresh_token || (await getConfig()).refreshToken || null,
    everConnected: true
  });
  return true;
}

export async function disconnect() {
  // Thu hồi thật ở phía Google, không chỉ xoá token trong máy.
  const c = await getConfig();
  const token = c.refreshToken || c.accessToken;
  if (token) {
    try {
      await fetch('https://oauth2.googleapis.com/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ token })
      });
    } catch { /* mất mạng thì vẫn xoá phía máy */ }
  }
  await setConfig({ accessToken: null, refreshToken: null, expiresAt: 0, everConnected: false });
}

async function accessToken() {
  const c = await getConfig();
  if (c.accessToken && c.expiresAt > Date.now()) return c.accessToken;

  // Còn refresh token thì dùng trước.
  if (c.refreshToken) {
    const body = new URLSearchParams({
      client_id: c.clientId,
      refresh_token: c.refreshToken,
      grant_type: 'refresh_token'
    });
    if (c.clientSecret) body.set('client_secret', c.clientSecret);

    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body
    });
    const data = await res.json();
    if (res.ok) {
      await setConfig({
        accessToken: data.access_token,
        expiresAt: Date.now() + lifetime(data.expires_in)
      });
      return data.access_token;
    }
    // invalid_grant = refresh token hết hạn (app ở trạng thái Testing, 7 ngày).
    // Không bỏ cuộc ngay — thử đăng nhập lại ngầm ở dưới.
    if (data.error !== 'invalid_grant') throw new Error(describe(data));
    await setConfig({ refreshToken: null });
  } else if (!c.everConnected) {
    throw new AuthLostError('Chưa kết nối Google Calendar.');
  }

  // Thử lấy lại quyền mà không làm phiền người dùng.
  try {
    await runAuthFlow({ interactive: false });
  } catch (e) {
    const msg = e?.message || '';

    // Mặc định là LỖI TẠM THỜI. Chỉ đúng vài lỗi dưới đây mới là mất phiên thật.
    //
    // Bản trước làm ngược lại — liệt kê vài lỗi tạm thời, còn lại coi là mất phiên.
    // Danh sách đó không bao giờ đủ: Google trả 502 kèm trang HTML thì res.json()
    // ném SyntaxError, trả 500 thì error là 'internal_failure' — chẳng cái nào khớp,
    // và một trục trặc thoáng qua bên Google lại bắt người dùng đăng nhập lại từ đầu.
    // Đoán sai theo chiều "tạm thời" chỉ tốn một lần thử lại; đoán sai theo chiều
    // "mất phiên" thì phá mất phiên đang tốt. Nên mặc định phải là chiều rẻ hơn.
    const lost = /invalid_grant|access_denied|interaction_required|login_required|consent_required|invalid_client|unauthorized_client|bị huỷ/i
      .test(msg);

    if (!lost) {
      throw new Error('Chưa lấy lại được quyền truy cập (' + msg + '). Sẽ thử lại lượt sau.');
    }

    // Hết phiên thật: xoá token phía máy để giao diện biết mà mời đăng nhập lại,
    // nhưng KHÔNG revoke — quyền bên Google có thể vẫn còn nguyên.
    await setConfig({ accessToken: null, refreshToken: null, expiresAt: 0, everConnected: false });
    throw new AuthLostError('Phiên đăng nhập Google đã hết. Cần kết nối lại.');
  }
  const fresh = await getConfig();
  if (!fresh.accessToken) throw new Error('Không lấy được quyền truy cập.');
  return fresh.accessToken;
}

/** Tuổi thọ access token, trừ hao 60s. Không tin mù giá trị Google trả về. */
function lifetime(expiresIn) {
  const s = Number(expiresIn);
  return (Number.isFinite(s) && s > 60 ? s - 60 : 300) * 1000;
}

function describe(data) {
  if (!data) return 'Lỗi không rõ.';
  const e = data.error?.message || data.error_description || data.error;
  return typeof e === 'string' ? e : JSON.stringify(data).slice(0, 200);
}

async function api(path, opts = {}) {
  const token = await accessToken();
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
      ...(opts.headers || {})
    }
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(describe(data));
  return data;
}

// ---- Dựng payload sự kiện ----

const pad = (n) => String(n).padStart(2, '0');
const iso = (o) => `${o.y}-${pad(o.m)}-${pad(o.d)}`;
const compact = (o) => `${o.y}${pad(o.m)}${pad(o.d)}`;

function nextDay(o) {
  const dt = new Date(o.y, o.m - 1, o.d + 1);
  return { d: dt.getDate(), m: dt.getMonth() + 1, y: dt.getFullYear() };
}

/** Số mốc tương lai cần đẩy lên lịch: hàng tháng 24 lần, hàng năm 6 lần. */
function horizonFor(ev) {
  return ev.month == null
    ? { days: 760, limit: 26 }
    : { days: 2300, limit: 6 };
}

/** Đổi "nhắc trước N ngày" sang số phút trước 00:00 ngày sự kiện, mốc 9:00 sáng. */
function reminderMinutes(remindDaysBefore) {
  const set = new Set();
  for (const n of remindDaysBefore || [0]) {
    // Google chỉ nhắc TRƯỚC giờ bắt đầu; sự kiện cả ngày bắt đầu 00:00.
    // n=0 (đúng ngày) và n=1 đều quy về 9:00 sáng hôm trước.
    const days = Math.max(Number(n), 1);
    set.add(days * 1440 - 540);
  }
  return [...set].sort((a, b) => a - b).slice(0, 5)
    .map(minutes => ({ method: 'popup', minutes }));
}

export function buildPayload(ev) {
  const { days, limit } = horizonFor(ev);
  const occs = nextOccurrences(ev, today(), days, limit);
  if (occs.length === 0) return null;

  const first = occs[0];
  const rest = occs.slice(1).map(compact);
  const repeat = ev.onceDate ? 'once' : (ev.month == null ? 'monthly' : 'yearly');
  const rule = ev.month == null
    ? `ngày ${ev.day} âm lịch hàng tháng`
    : `ngày ${ev.day}/${ev.month} âm lịch hàng năm`;

  return {
    signature: [ev.title, ...occs.map(compact), JSON.stringify(ev.remindDaysBefore)].join('|'),
    body: {
      summary: ev.title,
      description:
        `${ev.title} — ${rule}.\n` +
        `Ngày dương tính theo lịch âm Việt Nam (múi giờ +7)` +
        `${ev.skipLeap ? ', bỏ qua tháng nhuận' : ''}.\n` +
        `Tạo và tự gia hạn bởi extension Nhắc Âm Lịch.`,
      start: { date: iso(first) },
      end: { date: iso(nextDay(first)) },
      recurrence: rest.length ? [`RDATE;VALUE=DATE:${rest.join(',')}`] : [],
      transparency: 'transparent',
      reminders: { useDefault: false, overrides: reminderMinutes(ev.remindDaysBefore) },
      // amLich=1 là nhãn chung cho MỌI sự kiện của ứng dụng, dù do extension hay
      // do bản web tạo. Nhờ nó, một bản cài mới (máy khác, hoặc cài lại) nhận ra
      // được sự kiện cũ trên lịch thay vì tạo thêm một chuỗi trùng.
      // Dữ liệu có cấu trúc đi kèm để bên nhận dựng lại sự kiện mà không phải
      // đoán chữ trong phần mô tả.
      extendedProperties: {
        private: {
          amLich: '1',
          amLichId: ev.id,
          amLichDay: String(ev.day),
          amLichMonth: ev.month == null ? '' : String(ev.month),
          amLichRepeat: repeat,
          amLichSkipLeap: ev.skipLeap ? '1' : '0',
          amLichRemind: (ev.remindDaysBefore?.length ? ev.remindDaysBefore : [0]).join(','),
          amLichOnce: ev.onceDate
            ? `${ev.onceDate.y}-${pad(ev.onceDate.m)}-${pad(ev.onceDate.d)}` : ''
        }
      }
    }
  };
}

// ---- Kéo về từ Google Calendar ----

/**
 * Tìm những sự kiện do bản web (điện thoại) tạo và đưa chúng vào extension.
 *
 * Bản web ghi kèm dữ liệu có cấu trúc trong extendedProperties, nên ở đây chỉ
 * việc đọc lại — không parse từ phần mô tả, vì chữ nghĩa đổi là hỏng.
 *
 * Sau khi nhận, extension "tiếp quản" luôn sự kiện đó: ghi vào eventMap với
 * chữ ký rỗng, nên lượt đẩy kế tiếp sẽ PUT đè lên chính sự kiện cũ — thay vì
 * tạo thêm một chuỗi trùng. Lần PUT đó cũng thay nhãn amLichWeb bằng amLichId,
 * nên nó không bị nhận lại lần nữa.
 *
 * Trả về mảng sự kiện mới cần thêm vào danh sách của extension.
 */
// Đi hết các trang. Bản trước lấy đúng 50 mục đầu rồi thôi, nên ai có nhiều hơn
// 50 sự kiện thì phần dư không bao giờ được nhận về — im lặng, không báo gì.
async function listTagged(tag) {
  const items = [];
  let pageToken = '';
  for (let page = 0; page < 20; page++) {
    const q = new URLSearchParams({
      privateExtendedProperty: tag,
      showDeleted: 'false',
      singleEvents: 'false',
      maxResults: '250'
    });
    if (pageToken) q.set('pageToken', pageToken);
    const data = await api(`/calendars/primary/events?${q}`);
    items.push(...(data?.items || []));
    pageToken = data?.nextPageToken || '';
    if (!pageToken) break;
  }
  return items;
}

export async function pullFromCalendar(existing) {
  // Hai nhãn, vì hai nguồn sinh ra sự kiện:
  //   amLich=1    — nhãn chung, mọi sự kiện phiên bản này tạo ra (web lẫn extension).
  //                 Nhờ nó, cài lại extension hoặc cài trên máy thứ hai vẫn nhận
  //                 lại được sự kiện cũ thay vì tạo thêm một chuỗi trùng.
  //   amLichWeb=1 — nhãn cũ, chỉ bản web đời đầu ghi. Giữ để không bỏ rơi
  //                 những sự kiện đã tạo trước khi có nhãn chung.
  const seen = new Set();
  const items = [];
  for (const tag of ['amLich=1', 'amLichWeb=1']) {
    for (const it of await listTagged(tag)) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      items.push(it);
    }
  }
  if (!items.length) return [];

  const cfg = await getConfig();
  const map = { ...(cfg.eventMap || {}) };
  const known = new Set(Object.values(map).map(v => v.gcalId));
  const fresh = [];

  for (const item of items) {
    if (known.has(item.id)) continue;
    const p = item.extendedProperties?.private || {};
    const day = Number(p.amLichDay);
    if (!Number.isInteger(day) || day < 1 || day > 30) continue;   // dữ liệu hỏng thì bỏ qua

    const repeat = p.amLichRepeat === 'monthly' || p.amLichRepeat === 'once'
      ? p.amLichRepeat : 'yearly';
    const month = repeat === 'monthly' ? null : Number(p.amLichMonth);
    if (repeat !== 'monthly' && (!Number.isInteger(month) || month < 1 || month > 12)) continue;

    const remind = String(p.amLichRemind || '0').split(',')
      .map(Number).filter(n => Number.isFinite(n) && n >= 0 && n <= 30);

    const ev = {
      // Sự kiện do một bản cài extension khác tạo đã mang sẵn id nội bộ — giữ
      // nguyên id đó để hai máy cùng trỏ về một sự kiện, không sinh bản sao.
      id: p.amLichId || ('imp-' + item.id.slice(0, 24)),
      title: item.summary || 'Nhắc âm lịch',
      day,
      month,
      skipLeap: p.amLichSkipLeap !== '0',
      shortMonthFallback: day === 30,
      remindDaysBefore: remind.length ? remind : [0],
      enabled: true
    };

    if (repeat === 'once') {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.amLichOnce || '');
      if (!m) continue;
      ev.onceDate = { y: +m[1], m: +m[2], d: +m[3] };
    }

    // Đã có trong danh sách nhưng chưa có trong bản đồ (vd. vừa cài lại): chỉ
    // nối lại mối nối, không thêm bản sao vào danh sách.
    if (existing.some(e => e.id === ev.id) || fresh.some(e => e.id === ev.id)) {
      if (!map[ev.id]) map[ev.id] = { gcalId: item.id, signature: '' };
      continue;
    }
    fresh.push(ev);
    map[ev.id] = { gcalId: item.id, signature: '' };   // chữ ký rỗng ⇒ lượt sau sẽ PUT đè
  }

  // KHÔNG tự ghi eventMap ở đây. Bên gọi phải ghi danh sách sự kiện TRƯỚC, rồi mới
  // ghi bản đồ — xem commitEventMap. Hai lần ghi này không nguyên tử, mà service
  // worker của MV3 có thể bị ngắt ở bất kỳ điểm chờ nào. Nếu ghi bản đồ trước rồi
  // chết, bản đồ sẽ có những id mà danh sách sự kiện không có — và vòng xoá của
  // doSync coi đó là "đã bị xoá trong extension" rồi XOÁ THẬT sự kiện trên lịch
  // của người dùng. Ghi ngược lại thì mất mát tệ nhất chỉ là nhận lại lượt sau.
  //
  // Cũng bỏ luôn cái điều kiện "chỉ ghi khi số khoá đổi" của bản trước: sửa một
  // mối nối hỏng (cùng id, trỏ sang sự kiện khác) không làm số khoá đổi, nên nó
  // im lặng không được lưu, và lượt sau lại PUT vào một sự kiện đã chết.
  return { fresh, map };
}

/** Ghi bản đồ sau khi bên gọi đã lưu xong danh sách sự kiện. */
export async function commitEventMap(map) {
  await setConfig({ eventMap: map });
}

// ---- Đồng bộ ----

async function findExisting(ev) {
  const q = new URLSearchParams({
    privateExtendedProperty: `amLichId=${ev.id}`,
    showDeleted: 'false',
    maxResults: '5'
  });
  const data = await api(`/calendars/primary/events?${q}`);
  return data?.items?.[0]?.id || null;
}

/**
 * Đẩy toàn bộ sự kiện lên Google Calendar.
 * Chỉ gọi API khi nội dung thực sự đổi (so bằng signature đã lưu).
 */
// Chỉ cho một lượt đồng bộ chạy tại một thời điểm. Hai lượt chồng nhau sẽ cùng
// đọc một eventMap cũ, lượt ghi sau đè lượt trước, và những sự kiện của lượt thua
// thành mồ côi trên lịch — lần sau lại tạo mới, gây nhân đôi sự kiện thật.
// XẾP HÀNG, không gộp. Trước đây nếu đang có lượt chạy thì lượt mới nhận lại
// chính promise cũ — mà lượt cũ đã tính trên danh sách lỗi thời, nên thay đổi
// vừa xảy ra bị bỏ rơi im lặng. Giờ mỗi lượt chạy nối đuôi nhau và tự lấy danh
// sách mới nhất tại thời điểm nó thực sự chạy.
let chain = Promise.resolve();

export function syncAll(eventsOrGetter, opts = {}) {
  const run = chain
    .catch(() => {})
    .then(() => doSync(
      typeof eventsOrGetter === 'function' ? eventsOrGetter() : eventsOrGetter,
      opts));
  chain = run.catch(() => {});
  return run;
}

async function doSync(input, { force = false } = {}) {
  const events = await input;
  const cfg = await getConfig();
  const map = { ...(cfg.eventMap || {}) };
  const report = { created: 0, updated: 0, deleted: 0, skipped: 0, errors: [] };

  // Xoá trên lịch những sự kiện đã bị xoá/tắt trong extension
  const live = new Set(events.filter(e => e.enabled !== false).map(e => e.id));
  for (const id of Object.keys(map)) {
    if (live.has(id)) continue;
    try {
      await api(`/calendars/primary/events/${encodeURIComponent(map[id].gcalId)}`, { method: 'DELETE' });
      report.deleted++;
    } catch (e) {
      if (isAuthLost(e)) { await setConfig({ eventMap: map, lastSyncError: e.message }); throw e; }
      // 404/410 = đã không còn trên lịch, coi như xoá xong.
      if (!/404|410|not found|deleted/i.test(e.message)) {
        report.errors.push(e.message);
        // Xoá HỎNG thì GIỮ mối nối lại, lượt sau xoá tiếp. Bản trước quên nó vô
        // điều kiện: sự kiện vẫn nằm trên lịch nhưng extension không còn nhớ, nên
        // lượt kéo về kế tiếp thấy nó "lạ" và nhận lại như một ngày mới — cái
        // người dùng vừa xoá tự mọc lại, kèm thông báo "Đã nhận 1 ngày mới".
        continue;
      }
    }
    delete map[id];
  }

  for (const ev of events) {
    if (ev.enabled === false) continue;
    try {
      const payload = buildPayload(ev);
      if (!payload) { report.skipped++; continue; }

      const known = map[ev.id];
      if (known && known.signature === payload.signature && !force) { report.skipped++; continue; }

      let gcalId = known?.gcalId || await findExisting(ev);
      if (gcalId) {
        try {
          await api(`/calendars/primary/events/${encodeURIComponent(gcalId)}`, {
            method: 'PUT', body: JSON.stringify(payload.body)
          });
          report.updated++;
        } catch (e) {
          // Sự kiện không còn ở đó nữa: người dùng xoá tay trên Google Calendar,
          // hoặc đăng nhập lại bằng một tài khoản khác trong khi eventMap vẫn trỏ
          // sang lịch cũ. Bản trước cứ PUT mãi vào một id không tồn tại, lần nào
          // cũng 404, và sự kiện không bao giờ được tạo lại. Giờ quên mối nối rồi
          // tạo mới ngay trong lượt này.
          if (!/404|410|not found|deleted/i.test(e.message)) throw e;
          gcalId = null;
        }
      }
      if (!gcalId) {
        const created = await api('/calendars/primary/events', {
          method: 'POST', body: JSON.stringify(payload.body)
        });
        gcalId = created.id;
        report.created++;
      }
      map[ev.id] = { gcalId, signature: payload.signature };
    } catch (e) {
      // Mất phiên thì DỪNG cả lượt và ném ra ngoài. Nếu chỉ gom vào report.errors
      // như mọi lỗi khác thì hai chuyện xảy ra: kiểu lỗi bị bào thành chuỗi nên
      // bên gọi không nhận ra để bật cảnh báo "mất kết nối Google Calendar", và
      // toàn bộ sự kiện còn lại vẫn bị thử tiếp dù chắc chắn hỏng y hệt.
      if (isAuthLost(e)) {
        await setConfig({ eventMap: map, lastSyncError: e.message });
        throw e;
      }
      report.errors.push(`${ev.title}: ${e.message}`);
    }
  }

  await setConfig({
    eventMap: map,
    lastSync: Date.now(),
    lastSyncError: report.errors.length ? report.errors.join(' · ') : null
  });
  return report;
}
