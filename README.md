# 📝 QuizHub - Hệ thống Luyện thi trắc nghiệm hiện đại

Đây là source code Frontend tĩnh hoàn toàn (HTML/CSS/JS) cho nền tảng thi trắc nghiệm. Dữ liệu và xác thực được quản lý qua [Supabase](https://supabase.com) - một giải pháp backend-as-a-service miễn phí và mạnh mẽ dựa trên PostgreSQL.

## 🌟 Tính năng
- **Dùng chung nhiều người:** 100% dữ liệu nằm trên mây, không nằm trong file tĩnh.
- **Admin Dashboard:** Đăng nhập an toàn, tạo bài thi, xem kết quả, xuất CSV.
- **Import File thông minh:** Tự động đọc file Word (`.docx`) và nhận diện đáp án đúng dựa trên bôi màu vàng/đỏ hoặc chữ xanh. Hỗ trợ cả file Excel (`.xlsx`), CSV.
- **Bảo mật đề thi:** Đáp án đúng chỉ được gửi lên server lúc chấm điểm, học viên không thể bấm F12 (DevTools) để xem trộm đáp án trước khi nộp.
- **Hai chế độ:** Thi thật (nộp xong mới biết điểm) và Luyện tập (chọn xong biết đúng/sai ngay).
- **Trải nghiệm người dùng:** Tự động lưu bài khi làm, có chế độ Tối (Dark mode).

## 🚀 Hướng dẫn cài đặt & Deploy

### Bước 1: Tạo dự án Supabase
1. Truy cập [supabase.com](https://supabase.com) và tạo một Project mới (miễn phí).
2. Vào **Project Settings > API**, copy 2 chuỗi: `Project URL` và `anon / public key`.
3. Mở file `js/config.js` trong thư mục code này, dán 2 chuỗi đó vào.

### Bước 2: Thiết lập Database (Chỉ 1 phút)
1. Trong Supabase Dashboard, chuyển sang mục **SQL Editor**.
2. Bấm **New query**, mở file `supabase/schema.sql` (nằm trong thư mục code này), copy toàn bộ nội dung và dán vào SQL Editor.
3. Bấm **Run** để Supabase tự động tạo các bảng (`tests`, `questions`, `attempts`), cài đặt bảo mật RLS và các hàm API chấm điểm (RPC).

### Bước 3: Tạo tài khoản Admin
1. Chuyển sang mục **Authentication > Users**, bấm **Add user > Create new user**.
2. Nhập Email (VD: `admin@gmail.com`) và mật khẩu cho bạn.
3. Quay lại **SQL Editor**, chạy dòng lệnh sau (thay bằng email bạn vừa tạo) để cấp quyền Admin cho tài khoản đó:
   ```sql
   insert into public.admins (user_id)
   select id from auth.users where email = 'admin@gmail.com';
   ```

### Bước 4: Deploy lên Netlify / Vercel / GitHub Pages
Vì toàn bộ code chỉ là file tĩnh (HTML/CSS/JS), bạn có thể host ở bất kỳ đâu miễn phí.
- **Cách dễ nhất (Netlify Drop):**
  Truy cập [app.netlify.com/drop](https://app.netlify.com/drop), kéo thả toàn bộ thư mục `quizhub` này vào. Netlify sẽ cấp cho bạn một đường link ngay lập tức (VD: `https://ten-ban-chon.netlify.app`).
- Bạn có thể gửi link này cho 50+ người bạn để họ vào làm bài.
- Bạn truy cập `https://ten-ban-chon.netlify.app/admin.html` để quản lý.

## 📂 Cấu trúc thư mục
- `index.html` & `js/home.js`: Trang chủ cho Học viên (chọn bài thi).
- `quiz.html` & `js/quiz.js`: Giao diện làm bài và kết quả.
- `admin.html` & `js/admin.js`: Bảng điều khiển Admin (cần đăng nhập).
- `js/api.js`: Tương tác với Supabase (ẩn đi chi tiết backend).
- `js/parser.js`: Logic đọc file Word, Excel trên trình duyệt (dùng JSZip và SheetJS).
- `css/style.css`: File thiết kế (hỗ trợ dark mode).
- `supabase/schema.sql`: Script tạo database.

*Được xây dựng với kiến trúc serverless an toàn và hiện đại.*
