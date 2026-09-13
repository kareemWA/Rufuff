# رفوف

منصة لبيع الكتب الرقمية.

## التشغيل

```bash
npm install
cp .env.example .env
npm start
```

يجب ضبط `MONGODB_URI` و`SESSION_SECRET` و`ADMIN_EMAIL` و`KASHIER_SECRET_KEY` و`KASHIER_MERCHANT_ID` في `.env`. الدفع يتم عبر رابط Kashier مستضاف، ويؤكد الخادم الطلب من خلال webhook عام مضبوط في `KASHIER_WEBHOOK_URL`. استخدم `https://test-api.kashier.io/v2/payment-link` للاختبار، وفي الإنتاج استخدم endpoint الذي توفره Kashier لحسابك. في الإنتاج يجب استخدام HTTPS، وقيمة سرية عشوائية، والسماح بعنوان الخادم في MongoDB Atlas.

## الأمان

- كلمات المرور تُخزن باستخدام `bcryptjs` ولا تعاد في أي استجابة. كلمات المرور القديمة تُرقّى إلى تشفير آمن عند أول دخول.
- الجلسة توقيع HMAC داخل Cookie من نوع `HttpOnly` و`SameSite=Lax`، وتصبح `Secure` في الإنتاج.
- التسجيل، الدخول، التحقق، وإعادة التعيين محمية بـ rate limiting.
- البريد يدعم رموز تحقق وإعادة تعيين أحادية الاستخدام مخزنة كـ SHA-256 فقط. في بيئة التطوير يظهر الرمز في الاستجابة والسجل، ولا يحدث ذلك في الإنتاج.
- تحديث الحساب يتطلب جلسة صالحة، والوصول إلى الكتب يعتمد على سجل `Library` بعد تحقق webhook الدفع.

## مسارات رئيسية

- الكتب: `GET /api/books?search=html&category=programming&series=<id>`
- السلاسل: `GET /api/series` و`GET /api/series/:id`
- المفضلة: `GET/POST/DELETE /api/favorites`
- المكتبة والطلبات: `GET /api/library/owned` و`GET /api/orders`
- الدفع: `POST /api/payments/create`، وإشعار Kashier عبر `POST /api/payments/kashier/webhook`، وحالة الطلب عبر `GET /api/payments/mine`
- الحساب والمكتبة: `GET /api/me` و`GET/PUT /api/library`، وتعتمد على جلسة HttpOnly.
- الإدارة: `/admin.html`، مع حماية كل `/api/admin/*` بصلاحية `role=admin`. يكتسب الحساب المطابق لـ `ADMIN_EMAIL` الصلاحية عند التسجيل.

## فحص قبل الإطلاق

```bash
npm test
npm audit --audit-level=high
```

في الإنتاج يجب ضبط `MONGODB_URI` إلى قاعدة MongoDB متاحة. إذا ظهر خطأ `querySrv ECONNREFUSED` مع MongoDB Atlas، اضبط `DNS_SERVERS=1.1.1.1,8.8.8.8`. لا تضع أي أسرار فعلية في Git أو في ملفات الواجهة.
