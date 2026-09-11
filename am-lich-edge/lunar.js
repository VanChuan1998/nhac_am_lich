// Lịch âm Việt Nam — thuật toán Hồ Ngọc Đức, múi giờ +7.
// Không phụ thuộc mạng, không phụ thuộc thư viện ngoài.

const TZ = 7.0;

function jdFromDate(dd, mm, yy) {
  const a = Math.floor((14 - mm) / 12);
  const y = yy + 4800 - a;
  const m = mm + 12 * a - 3;
  let jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y
    + Math.floor(y / 4) - Math.floor(y / 100) + Math.floor(y / 400) - 32045;
  if (jd < 2299161) {
    jd = dd + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
  }
  return jd;
}

function jdToDate(jd) {
  let a, b, c;
  if (jd > 2299160) {
    a = jd + 32044;
    b = Math.floor((4 * a + 3) / 146097);
    c = a - Math.floor((b * 146097) / 4);
  } else {
    b = 0;
    c = jd + 32082;
  }
  const d = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * d) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = b * 100 + d - 4800 + Math.floor(m / 10);
  return [day, month, year];
}

function newMoon(k) {
  const T = k / 1236.85;
  const T2 = T * T, T3 = T2 * T, dr = Math.PI / 180;
  let Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
  Jd1 += 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
  const M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
  const Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
  const F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
  let C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
  C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
  C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
  C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
  C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
  C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
  C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
  let deltat;
  if (T < -11) {
    deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
  } else {
    deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
  }
  return Jd1 + C1 - deltat;
}

function sunLongitude(jdn) {
  const T = (jdn - 2451545.0) / 36525;
  const T2 = T * T, dr = Math.PI / 180;
  const M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
  const L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
  let DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
  DL += (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
  let L = (L0 + DL) * dr;
  L = L - Math.PI * 2 * Math.floor(L / (Math.PI * 2));
  return L;
}

function getNewMoonDay(k) {
  return Math.floor(newMoon(k) + 0.5 + TZ / 24);
}

function getSunLongitude(dayNumber) {
  return Math.floor(sunLongitude(dayNumber - 0.5 - TZ / 24) / Math.PI * 6);
}

function getLunarMonth11(yy) {
  const off = jdFromDate(31, 12, yy) - 2415021;
  const k = Math.floor(off / 29.530588853);
  let nm = getNewMoonDay(k);
  if (getSunLongitude(nm) >= 9) nm = getNewMoonDay(k - 1);
  return nm;
}

function getLeapMonthOffset(a11) {
  const k = Math.floor((a11 - 2415021.076998695) / 29.530588853 + 0.5);
  let i = 1, last;
  let arc = getSunLongitude(getNewMoonDay(k + i));
  do {
    last = arc;
    i++;
    arc = getSunLongitude(getNewMoonDay(k + i));
  } while (arc !== last && i < 14);
  return i - 1;
}

/** Đổi ngày dương sang âm. Trả về {day, month, year, leap}. */
export function solarToLunar(dd, mm, yy) {
  const dayNumber = jdFromDate(dd, mm, yy);
  const k = Math.floor((dayNumber - 2415021.076998695) / 29.530588853);
  let monthStart = getNewMoonDay(k + 1);
  if (monthStart > dayNumber) monthStart = getNewMoonDay(k);
  let a11 = getLunarMonth11(yy), b11 = a11, lunarYear;
  if (a11 >= monthStart) {
    lunarYear = yy;
    a11 = getLunarMonth11(yy - 1);
  } else {
    lunarYear = yy + 1;
    b11 = getLunarMonth11(yy + 1);
  }
  const lunarDay = dayNumber - monthStart + 1;
  const diff = Math.floor((monthStart - a11) / 29);
  let lunarLeap = 0;
  let lunarMonth = diff + 11;
  if (b11 - a11 > 365) {
    const leapMonthDiff = getLeapMonthOffset(a11);
    if (diff >= leapMonthDiff) {
      lunarMonth = diff + 10;
      if (diff === leapMonthDiff) lunarLeap = 1;
    }
  }
  if (lunarMonth > 12) lunarMonth -= 12;
  if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
  return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap };
}

const CAN = ['Canh', 'Tân', 'Nhâm', 'Quý', 'Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ'];
const CHI = ['Thân', 'Dậu', 'Tuất', 'Hợi', 'Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi'];

export function canChi(lunarYear) {
  return CAN[lunarYear % 10] + ' ' + CHI[lunarYear % 12];
}

/** Ngày dương hôm nay theo giờ máy, dạng {d, m, y}. */
export function today() {
  const n = new Date();
  return { d: n.getDate(), m: n.getMonth() + 1, y: n.getFullYear() };
}

export function toISO({ d, m, y }) {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

const WEEKDAYS = ['Chủ nhật', 'Thứ hai', 'Thứ ba', 'Thứ tư', 'Thứ năm', 'Thứ sáu', 'Thứ bảy'];

export function formatSolar({ d, m, y }) {
  const w = WEEKDAYS[new Date(y, m - 1, d).getDay()];
  return `${w}, ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
}

export function formatLunar(l) {
  return `${l.day}/${l.month}${l.leap ? ' (nhuận)' : ''} âm lịch — năm ${canChi(l.year)}`;
}

/**
 * Tìm các lần xuất hiện kế tiếp của một ngày âm lịch.
 *
 * ev = { day, month|null, skipLeap, shortMonthFallback }
 *   month = null  → lặp hàng tháng âm
 *   month = 1..12 → lặp hàng năm
 *   skipLeap: bỏ qua tháng nhuận (mặc định true)
 *   shortMonthFallback: ngày 30 mà tháng thiếu thì dùng ngày 29
 *
 * Quét từ ngày dương `from` tối đa `horizonDays` ngày.
 * Trả về mảng { d, m, y, lunar } theo thứ tự tăng dần.
 */
export function nextOccurrences(ev, from, horizonDays = 800, limit = 12) {
  const startJd = jdFromDate(from.d, from.m, from.y);

  // Sự kiện một lần: ngày dương đã được chốt lúc tạo, không tính lại theo chu kỳ.
  // Nhờ vậy nó không "trôi" sang năm sau khi ngày đó qua đi.
  if (ev.onceDate) {
    const t = ev.onceDate;
    if (jdFromDate(t.d, t.m, t.y) < startJd) return [];   // đã qua
    return [{ d: t.d, m: t.m, y: t.y, lunar: solarToLunar(t.d, t.m, t.y) }];
  }

  const results = [];
  const wantDay = Number(ev.day);
  const fallback = ev.shortMonthFallback && wantDay === 30;
  const skipLeap = ev.skipLeap !== false;

  for (let i = 0; i <= horizonDays && results.length < limit; i++) {
    const [d, m, y] = jdToDate(startJd + i);
    const l = solarToLunar(d, m, y);
    if (skipLeap && l.leap) continue;
    if (ev.month !== null && ev.month !== undefined && l.month !== Number(ev.month)) continue;

    let hit = l.day === wantDay;
    if (!hit && fallback && l.day === 29) {
      // tháng thiếu: ngày kế tiếp đã là mùng 1 → tháng này không có ngày 30
      const [nd, nm, ny] = jdToDate(startJd + i + 1);
      if (solarToLunar(nd, nm, ny).day === 1) hit = true;
    }
    if (hit) results.push({ d, m, y, lunar: l });
  }
  return results;
}

/** Số ngày từ hôm nay tới một ngày dương. */
export function daysUntil(target, from) {
  return jdFromDate(target.d, target.m, target.y) - jdFromDate(from.d, from.m, from.y);
}
