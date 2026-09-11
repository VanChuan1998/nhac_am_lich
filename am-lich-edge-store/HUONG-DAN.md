# Nhắc Âm Lịch — tiện ích cho Microsoft Edge

Nhắc nhở theo ngày âm lịch Việt Nam. Tự tính ngày bằng thuật toán lịch âm
(Hồ Ngọc Đức, múi giờ +7) ngay trong máy — **không cần mạng, không bao giờ hết
hạn** — và đẩy lên Google Calendar nếu bạn bật.

## Cài đặt

1. Giải nén thư mục này ra một chỗ cố định (đừng để trong Downloads rồi xoá —
   Edge nạp trực tiếp từ thư mục đó mỗi lần khởi động).
2. Mở `edge://extensions` → bật **Developer mode** → **Load unpacked** → chọn
   thư mục `am-lich-edge`.
3. Ghim biểu tượng mặt trăng lên thanh công cụ.

Cài xong danh sách trống — bấm biểu tượng rồi **+ Thêm ngày âm lịch** để khai
ngày đầu tiên.

**Gói dành cho Edge Add-ons store**, đã gỡ trường `key`. Extension ID do
Microsoft gán, nên nhớ thêm `https://<ID>.chromiumapp.org/` vào Authorized
redirect URIs trong Google Cloud. Cài tay thì dùng gói `am-lich-edge`.

### Thông báo trên Windows

Cài đặt Windows → Hệ thống → Thông báo → bật cho **Microsoft Edge**, và tắt
**Focus assist** hoặc cho Edge vào danh sách ưu tiên.

## Nối Google Calendar

Bấm biểu tượng → **Cài đặt** → **Đăng nhập bằng Google**. Chọn tài khoản, cho
phép quyền lịch, xong. Không phải dán khoá gì cả.

Lần đầu sẽ gặp màn hình **"Google hasn't verified this app"** → bấm
**Advanced** → **Go to Nhac Am Lich (unsafe)**. Cảnh báo này biến mất sau khi
ứng dụng qua thẩm định của Google (xem phần Phát hành bên dưới).

## Hai lớp nhắc

| | Thông báo trên Edge | Sự kiện trên Google Calendar |
|---|---|---|
| Ai bắn | Tiện ích | Google |
| Ở đâu | Máy này | Mọi thiết bị: điện thoại, Apple Calendar, Outlook |
| Đúng ngày | Được, thông báo ở lại tới khi bạn tắt | Không — sự kiện cả ngày bắt đầu 0h, Google chỉ nhắc *trước*, nên mốc này quy về 9:00 sáng hôm trước |
| Cần mạng | Không | Có, lúc đồng bộ |

## Cách hoạt động

- Mỗi lần mở Edge, và cứ 6 tiếng một lần (mốc chính 8:00 sáng), tiện ích tính
  lại các ngày sắp tới, bắn thông báo nếu tới mốc, và đẩy lịch lên Google.
- Chỉ gọi API Google khi nội dung thực sự đổi, nên không tốn quota.
- Hàng tháng đẩy trước **26 lần**, hàng năm đẩy trước **6 lần**, và **tự gia hạn
  mỗi ngày** — chuỗi sự kiện không bao giờ cạn.
- Mỗi mốc chỉ báo một lần; mở Edge nhiều lần trong ngày không bị báo lại.
- Chỉ một lượt đồng bộ chạy tại một thời điểm, để không nhân đôi sự kiện.

## Thêm sự kiện

Bấm biểu tượng → **+ Thêm ngày âm lịch**. Có ba chế độ lặp:

- **Hàng tháng** — vd mùng một hoặc ngày rằm
- **Hàng năm** — vd giỗ ngày 10/7 âm
- **Một lần** — vd đám cưới, đầy tháng, giỗ đầu

Chế độ **một lần** chốt ngày dương ngay lúc tạo và lưu vào `onceDate`, thay vì
tính lại theo chu kỳ mỗi lần. Nhờ vậy nó không tự trôi sang năm sau. Qua ngày
rồi thì thẻ hiện "Đã qua" chứ không biến mất, để bạn tự xoá khi muốn.

Hai tuỳ chọn khác đáng chú ý:

- **Bỏ qua tháng nhuận** — nên bật cho ngày giỗ (chỉ cúng tháng chính), nên tắt
  cho việc lặp hàng tháng như mùng một hay ngày rằm (tháng nhuận vẫn có).
- **Tháng thiếu thì dùng ngày 29** — chỉ hiện khi chọn ngày 30, vì tháng âm
  thiếu chỉ có 29 ngày.

## Thêm ngày từ điện thoại

Tiện ích chỉ chạy trên máy tính. Để thêm ngày khi đang đi ngoài đường, mở trang
web kèm theo (`app.html` trong gói `am-lich-website`) bằng trình duyệt điện
thoại, đăng nhập Google, chọn ngày âm. Thêm vào màn hình chính thì nó chạy như
một ứng dụng.

**Hai đầu gặp nhau ở Google Calendar.** Trang web ghi sự kiện kèm dữ liệu có cấu
trúc trong `extendedProperties` (`amLichDay`, `amLichMonth`, `amLichRepeat`,
`amLichSkipLeap`, `amLichRemind`, `amLichOnce`). Ở lượt đồng bộ kế tiếp,
`pullFromCalendar()` trong `gcal.js` tìm những sự kiện gắn nhãn `amLichWeb=1`,
đọc lại các trường đó và thêm vào danh sách của tiện ích — không parse từ phần
mô tả, vì chữ nghĩa đổi là hỏng.

Sau khi nhận, tiện ích **tiếp quản** sự kiện: ghi vào `eventMap` với chữ ký rỗng
nên lượt đẩy ngay sau đó sẽ PUT đè lên chính sự kiện cũ thay vì tạo chuỗi trùng.
Lần PUT đó cũng thay nhãn `amLichWeb` bằng `amLichId`, nên nó không bị nhận lại
lần thứ hai. Mỗi lần nhận được ngày mới, tiện ích bắn một thông báo để việc này
không diễn ra âm thầm.

Chiều ngược lại — sửa hoặc xoá trong tiện ích — vẫn đẩy lên lịch như trước.

**Cần cấu hình một lần:** thêm origin của trang web vào
**Authorized JavaScript origins** của OAuth client trong Google Cloud, nếu không
nút đăng nhập trên điện thoại sẽ báo lỗi.

## Kiến trúc xác thực

Tiện ích dùng **luồng implicit của OAuth 2.0**, không có client secret.

Điều này là cố ý. Gói cài của một tiện ích là công khai — ai cũng giải nén
được — nên mọi "bí mật" đặt trong đó đều không còn là bí mật. Client ID thì
khác: nó lộ ra trong mọi luồng OAuth theo thiết kế, và tự nó không mở được dữ
liệu của ai. Bảo mật đến từ chỗ Google chỉ chấp nhận redirect về đúng URI đã
đăng ký cho extension ID này, cộng với tham số `state` chống ghép nối chéo.

Access token sống khoảng một giờ. Khi hết, tiện ích **đăng nhập lại ngầm**
(`prompt=none`): nếu phiên Google trong trình duyệt còn sống, Google cấp token
mới mà không hiện gì cả. Bạn không thấy gì.

Ai muốn chạy trên project Google Cloud riêng thì vào mục **Nâng cao** trong
trang Cài đặt. Nhập cả Client ID và secret (client loại *Web application*) sẽ
chuyển sang luồng authorization code + PKCE, có refresh token.

## Quyền và dữ liệu

| Quyền | Để làm gì |
|---|---|
| `storage` | Lưu danh sách sự kiện và token |
| `alarms` | Hẹn giờ kiểm tra hàng ngày |
| `notifications` | Bắn thông báo Windows |
| `identity` | Mở cửa sổ đăng nhập Google |
| `googleapis.com` | Gọi Calendar API |

Scope Google duy nhất là `calendar.events`. Tiện ích chỉ đụng tới những sự kiện
do chính nó tạo, đánh dấu bằng nhãn nội bộ `amLichId`.

**Dữ liệu nằm ở đâu:**

- **Tất cả trong `storage.local`** — danh sách sự kiện lẫn token. Không có gì
  đồng bộ đi đâu, kể cả sang máy khác của chính bạn.
- Tiện ích hoạt động như một ứng dụng cài trong máy: mỗi người dùng có dữ liệu
  riêng biệt, không có kho chung nào giữa các máy hay giữa những người dùng.
- Ngoài Google Calendar khi bạn bật đồng bộ, không gửi đi đâu khác.
- Bản cũ từng lưu ở `storage.sync`. Khi cập nhật, `clearSyncStorage()` kéo dữ
  liệu về local một lần rồi gọi `chrome.storage.sync.clear()` — **xoá sạch vùng
  sync của tiện ích**. Việc dọn chạy ở mọi lần khởi động, nên vùng sync luôn
  trống. `clear()` chỉ động tới dữ liệu của chính tiện ích này; mỗi tiện ích có
  vùng lưu trữ riêng, không với tới dữ liệu của trình duyệt hay tiện ích khác.

Không có máy chủ của nhà phát triển. Không phân tích, không đo lường, không mã
nạp từ xa, không CDN, không `eval`.

## Phát hành công khai

Tiện ích đã sẵn sàng về mặt kỹ thuật. Phần còn lại là thủ tục, và có một nút
thắt bắt buộc.

### Bắt buộc: một tên miền của bạn

Google yêu cầu app External ở trạng thái Production phải có trang chủ, chính
sách bảo mật, điều khoản sử dụng — và **domain chứa chúng phải được bạn xác
minh sở hữu** qua Google Search Console. Không có tên miền thì nút "Publish
app" vẫn khoá, không có đường vòng.

Bộ ba trang đó đã được viết sẵn, nằm trong gói `am-lich-website`. Việc của bạn
là đưa chúng lên tên miền của mình.

### Các bước

1. **Có tên miền** và trỏ về một hosting bất kỳ (GitHub Pages, Cloudflare
   Pages, Netlify đều miễn phí). Upload ba file trong `am-lich-website`.
2. **Xác minh domain** tại [Google Search Console](https://search.google.com/search-console).
3. Trong Google Cloud → **Branding**: điền Application home page, Privacy
   policy link, Terms of service link, và thêm domain vào **Authorized domains**.
4. **Audience** → **Publish app** (lúc này nút mới hết khoá).
5. **Client ID** — đã tạo mới và thay vào `gcal.js`. Nếu sau này cần tạo lại,
   nhớ khai redirect URI `https://klcbbckmfblinnkfdjfmfaldkapjahpd.chromiumapp.org/`
   cho client *Web application*.
6. **Nộp verification** cho scope nhạy cảm `calendar.events`. Google cần bản
   ghi màn hình cho thấy luồng xin quyền và cách dùng dữ liệu. Duyệt mất vài
   tuần. Trước khi được duyệt, app vẫn chạy với trần 100 người dùng và màn hình
   cảnh báo.
7. **Đăng ký nhà phát triển Microsoft Edge Add-ons** — miễn phí, không mất phí
   đăng ký. Chọn tài khoản Individual cho nhanh, rồi nộp gói `.zip` này. Duyệt
   khoảng 7 ngày làm việc.

### Trước khi nộp, đọc lại

- Đừng đóng gói kèm `HUONG-DAN.md` này nếu bạn không muốn công khai chi tiết
  nội bộ — nó không ảnh hưởng chức năng.
- Ghi rõ trong mô tả trên store rằng ngày âm lịch có thể lệch một ngày so với
  vài bản lịch in, và người dùng nên đối chiếu với dịp hệ trọng.

## Cấu trúc

| File | Việc |
|---|---|
| `lunar.js` | Thuật toán lịch âm + tìm lần xuất hiện kế tiếp |
| `gcal.js` | OAuth + đẩy sự kiện lên Google Calendar |
| `background.js` | Service worker: hẹn giờ, thông báo, badge, gọi đồng bộ |
| `popup.html/css/js` | Xem và quản lý sự kiện |
| `options.html/css/js` | Trang cấu hình Google Calendar |

## Nếu trục trặc

- **`redirect_uri_mismatch`** — URI trong Google Cloud phải khớp từng ký tự,
  kể cả dấu `/` cuối.
- **`access_blocked`** — email của bạn chưa nằm trong Test users, hoặc app chưa
  được publish.
- **Đăng nhập được nhưng không đồng bộ** — mở `edge://extensions` → thẻ Nhắc Âm
  Lịch → **service worker** → tab Console để xem lỗi.
- **Google từ chối luồng implicit** — hiếm, nhưng nếu gặp thì vào mục Nâng cao,
  nhập Client ID + secret của một client *Web application*; tiện ích tự chuyển
  sang luồng authorization code.
