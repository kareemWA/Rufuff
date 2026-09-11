
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const { rateLimit } = require("express-rate-limit");
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dns = require("dns");
const { Readable } = require("stream");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const app = express();
mongoose.set("bufferCommands", false);
const storagePath = path.join(__dirname, "storage.json");
const PORT = Number(process.env.PORT || 3000);
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/myapp";
const DEFAULT_DISCOUNT_PERCENT = 65;
const SESSION_COOKIE = "book_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SESSION_SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : crypto.randomBytes(32).toString("hex"));

if (process.env.DNS_SERVERS) {
    dns.setServers(process.env.DNS_SERVERS.split(",").map(server => server.trim()).filter(Boolean));
}

if (process.env.NODE_ENV === "production" && (!SESSION_SECRET || SESSION_SECRET.length < 32)) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
}

const bookSchema = new mongoose.Schema({
    title: { type: String, required: true, unique: true },
    author: { type: String, required: true },
    category: { type: String, required: true },
    price: { type: Number, required: true },
    originalPrice: { type: Number },
    discountPercent: { type: Number, min: 0, max: 90, default: DEFAULT_DISCOUNT_PERCENT },
    image: { type: String, required: true },
    description: { type: String, default: "كتاب رقمي مختار بعناية من رفوف." },
    pdfFile: { type: String, default: null }
}, { timestamps: true });
bookSchema.index({ category: 1, createdAt: 1 });

const Book = mongoose.model("Book", bookSchema);

const purchaseSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    status: { type: String, enum: ["paid"], default: "paid" }
}, { timestamps: true });

purchaseSchema.index({ userEmail: 1, bookId: 1 }, { unique: true });
const Purchase = mongoose.model("Purchase", purchaseSchema);

const paymentSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    bookIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true }],
    receiptImage: { type: String, required: true },
    rejectionReason: { type: String, default: null },
    orderNumber: { type: Number, unique: true, default: () => Date.now() + Math.floor(Math.random() * 100000) },
    amountCents: { type: Number, required: true },
    status: { type: String, enum: ["pending", "paid", "failed"], default: "pending" }
}, { timestamps: true });
paymentSchema.index({ userEmail: 1, status: 1, createdAt: -1 });

const Payment = mongoose.model("Payment", paymentSchema);

const commentSchema = new mongoose.Schema({
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    userEmail: { type: String, required: true },
    userName: { type: String, required: true },

    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, required: true, trim: true, maxlength: 1000 }
}, { timestamps: true });
commentSchema.index({ bookId: 1, createdAt: -1 });

const Comment = mongoose.model("Comment", commentSchema);

const librarySchema = new mongoose.Schema({
    userEmail: { type: String, required: true, unique: true },
    cartBookIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book" }],
    favoriteBookIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book" }]
}, { timestamps: true });

const Library = mongoose.model("Library", librarySchema);

const seriesSchema = new mongoose.Schema({
    name: { type: String, required: true, trim: true },
    cover: String,
    description: String
}, { timestamps: true });

const Series = mongoose.model("Series", seriesSchema);

const couponSchema = new mongoose.Schema({
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    type: { type: String, enum: ["percentage", "fixed"], required: true },
    value: { type: Number, required: true, min: 0 },
    maxUses: { type: Number, min: 1 },
    minPurchase: { type: Number, min: 0, default: 0 }
}, { timestamps: true });

const Coupon = mongoose.model("Coupon", couponSchema);

function applyBookDiscount(book) {
    const originalPrice = Number(book.originalPrice || book.price);
    const discountPercent = Math.min(90, Math.max(0, Number(book.discountPercent ?? DEFAULT_DISCOUNT_PERCENT)));
    const price = Math.round(originalPrice * (100 - discountPercent) / 100);
    return { ...book, originalPrice, discountPercent, price };
}

function createSessionToken(email) {
    const payload = Buffer.from(JSON.stringify({ email, expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000 })).toString("base64url");
    const signature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
    return `${payload}.${signature}`;
}

function getSessionEmail(req) {
    const cookies = Object.fromEntries((req.headers.cookie || "").split(";").filter(Boolean).map(cookie => {
        const separator = cookie.indexOf("=");
        return [cookie.slice(0, separator).trim(), decodeURIComponent(cookie.slice(separator + 1))];
    }));
    const [payload, signature] = (cookies[SESSION_COOKIE] || "").split(".");
    if (!payload || !signature) return null;

    const expectedSignature = crypto.createHmac("sha256", SESSION_SECRET).update(payload).digest("base64url");
    const signaturesMatch = signature.length === expectedSignature.length
        && crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
    if (!signaturesMatch) return null;

    try {
        const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
        return session.expiresAt > Date.now() ? session.email : null;
    } catch {
        return null;
    }
}

function setSessionCookie(res, email) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=${encodeURIComponent(createSessionToken(email))}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}${secure}`);
}

function clearSessionCookie(res) {
    const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
    res.setHeader("Set-Cookie", `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

async function createBooksCollection() {
    await Book.createCollection();
    await Book.bulkWrite([

    ]);
    console.log("MongoDB collection ready: books");
}

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    pass: { type: String, required: true },
    phone: String,
    photo: String,
    role: { type: String, enum: ["user", "admin"], default: "user" }
}, { timestamps: true });

const User = mongoose.model("User", userSchema);

function publicUser(user) {
    if (!user) return null;
    const { pass, ...safeUser } = user.toObject ? user.toObject() : user;
    return { ...safeUser, avatar: safeUser.photo || safeUser.avatar || null };
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function isConfiguredAdminEmail(email) {
    const configuredAdminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    return Boolean(configuredAdminEmail && normalizeEmail(email) === configuredAdminEmail);
}

async function ensureAdminRoleForEmail(email) {
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedEmail || !isConfiguredAdminEmail(normalizedEmail)) return false;

    const result = await User.updateOne(
        { email: normalizedEmail },
        { $set: { role: "admin" } },
        { runValidators: true }
    );

    return result.modifiedCount > 0 || result.matchedCount > 0;
}

async function getCurrentUser(req) {
    const email = getSessionEmail(req);
    if (!email) return null;

    const user = await User.findOne({ email: normalizeEmail(email) }).lean();
    if (!user) return null;

    if (isConfiguredAdminEmail(user.email)) {
        const shouldBeAdmin = user.role !== "admin";
        if (shouldBeAdmin) {
            await User.updateOne({ _id: user._id }, { $set: { role: "admin" } });
            user.role = "admin";
        }
    }

    return user;
}

async function requireUser(req, res, next) {
    const user = await getCurrentUser(req);
    if (!user) return res.status(401).send("يجب تسجيل الدخول أولًا");
    req.currentUser = user;
    next();
}

async function requireAdmin(req, res, next) {
    await requireUser(req, res, async () => {
        if (req.currentUser.role !== "admin" && !isConfiguredAdminEmail(req.currentUser.email)) {
            return res.status(403).send("لا تملك صلاحية الإدارة");
        }

        if (isConfiguredAdminEmail(req.currentUser.email) && req.currentUser.role !== "admin") {
            await User.updateOne({ _id: req.currentUser._id }, { $set: { role: "admin" } });
            req.currentUser.role = "admin";
        }

        next();
    });
}

function readUsers() {
    if (!fs.existsSync(storagePath)) {
        fs.writeFileSync(storagePath, "[]");
    }

    return JSON.parse(fs.readFileSync(storagePath, "utf8"));
}

function saveUsers(users) {
    fs.writeFileSync(storagePath, JSON.stringify(users, null, 4));
}

// السماح بقراءة الملفات الثابتة
app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ contentSecurityPolicy: false }));
app.use(compression());
app.use(express.static(__dirname));
app.use(express.json({ limit: "10mb" }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 600,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "طلبات كثيرة جدًا. حاول مرة أخرى بعد قليل."
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "محاولات تسجيل كثيرة جدًا. حاول مرة أخرى بعد قليل."
});
app.use("/api", apiLimiter);
app.use(["/login", "/register"], authLimiter);

app.use((error, req, res, next) => {
    if (error.type === "entity.too.large") {
        return res.status(413).send("حجم الصورة كبير جدًا. استخدم صورة أقل من 10 ميجابايت.");
    }
    next(error);
});

// الصفحة الرئيسية
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "public", "index.html"));
});
app.get("/courses", (req, res) => {
    res.send("⭐⭐⭐⭐⭐ هذا السيرفر الجديد ⭐⭐⭐⭐⭐");
});

app.get("/api/me", requireUser, (req, res) => {
    res.json(publicUser(req.currentUser));
});

app.get("/api/library", requireUser, async (req, res) => {
    try {
        const library = await Library.findOne({ userEmail: req.currentUser.email }).lean();
        res.json(library || { userEmail: req.currentUser.email, cartBookIds: [], favoriteBookIds: [] });
    } catch (error) {
        res.status(500).send("تعذر تحميل مكتبتك");
    }
});

app.put("/api/library", requireUser, async (req, res) => {
    try {
        const cartBookIds = Array.isArray(req.body.cartBookIds) ? req.body.cartBookIds : [];
        const favoriteBookIds = Array.isArray(req.body.favoriteBookIds) ? req.body.favoriteBookIds : [];
        const library = await Library.findOneAndUpdate(
            { userEmail: req.currentUser.email },
            { userEmail: req.currentUser.email, cartBookIds, favoriteBookIds },
            { upsert: true, new: true, runValidators: true }
        ).lean();
        res.json(library);
    } catch (error) {
        res.status(400).send("تعذر حفظ مكتبتك");
    }
});

app.get("/api/books", async (req, res) => {
    try {
        const books = await Book.find().sort({ createdAt: 1 }).lean();
        res.json(books.map(applyBookDiscount));
    } catch (error) {
        console.error("Books query error:", error.message);
        res.status(500).send("تعذر تحميل الكتب");
    }
});

app.get("/api/admin/stats", requireAdmin, async (req, res) => {
    try {
        const [users, books, orders, revenue] = await Promise.all([
            User.countDocuments(),
            Book.countDocuments(),
            Payment.countDocuments({ status: "paid" }),
            Payment.aggregate([{ $match: { status: "paid" } }, { $group: { _id: null, total: { $sum: "$amountCents" } } }])
        ]);
        res.json({ users, books, orders, revenue: Number(((revenue[0]?.total || 0) / 100).toFixed(2)) });
    } catch (error) {
        res.status(500).send("تعذر تحميل الإحصائيات");
    }
});

app.get("/api/admin/orders", requireAdmin, async (req, res) => {
    try {
        const payments = await Payment.find().sort({ createdAt: -1 }).limit(100).populate("bookIds", "title price originalPrice discountPercent").lean();
        const emails = [...new Set(payments.map(payment => payment.userEmail))];
        const users = await User.find({ email: { $in: emails } }).select("email").lean();
        const usersByEmail = new Map(users.map(user => [user.email, user]));
        res.json(payments.map(payment => ({
            ...payment,
            userId: usersByEmail.get(payment.userEmail) || { email: payment.userEmail },
            books: payment.bookIds,
            total: Number((payment.amountCents / 100).toFixed(2)),
            paymentStatus: payment.status
        })));
    } catch (error) {
        res.status(500).send("تعذر تحميل الطلبات");
    }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
    try {
        const users = await User.find().sort({ createdAt: -1 }).limit(100).lean();
        res.json(users.map(publicUser));
    } catch (error) {
        res.status(500).send("تعذر تحميل المستخدمين");
    }
});

app.get("/api/admin/books", requireAdmin, async (req, res) => {
    try {
        const books = await Book.find().sort({ createdAt: -1 }).lean();
        res.json(books.map(applyBookDiscount));
    } catch (error) {
        res.status(500).send("تعذر تحميل الكتب");
    }
});

app.delete("/api/admin/books/:bookId", requireAdmin, async (req, res) => {
    try {
        const bookId = new mongoose.Types.ObjectId(req.params.bookId);

        const deletedBook = await Book.findByIdAndDelete(bookId);
        if (!deletedBook) return res.status(404).send("الكتاب غير موجود");

        await Promise.all([
            Purchase.deleteMany({ bookId }),
            Payment.deleteMany({ bookIds: bookId }),
            Comment.deleteMany({ bookId }),
            Library.updateMany({}, { $pull: { cartBookIds: bookId, favoriteBookIds: bookId } })
        ]);

        res.status(204).end();
    } catch (error) {
        res.status(400).send("معرّف الكتاب غير صالح أو تعذر حذفه");
    }
});

app.get("/api/admin/series", requireAdmin, async (req, res) => {
    try {
        res.json(await Series.find().sort({ createdAt: -1 }).lean());
    } catch (error) {
        res.status(500).send("تعذر تحميل السلاسل");
    }
});

app.delete("/api/admin/series/:seriesId", requireAdmin, async (req, res) => {
    try {
        const deletedSeries = await Series.findByIdAndDelete(req.params.seriesId);
        if (!deletedSeries) return res.status(404).send("السلسلة غير موجودة");
        res.status(204).end();
    } catch (error) {
        res.status(400).send("معرّف السلسلة غير صالح أو تعذر حذفها");
    }
});

app.post("/api/admin/books", requireAdmin, async (req, res) => {
    try {
        const { title, author, category, price, cover, file, description } = req.body;
        const book = await Book.create({ title, author, category, price: Number(price), image: cover, pdfFile: file || null, description });
        res.status(201).json(book);
    } catch (error) {
        res.status(400).send("تعذر حفظ الكتاب");
    }
});

app.post("/api/admin/series", requireAdmin, async (req, res) => {
    try {
        res.status(201).json(await Series.create(req.body));
    } catch (error) {
        res.status(400).send("تعذر حفظ السلسلة");
    }
});

app.post("/api/admin/coupons", requireAdmin, async (req, res) => {
    try {
        res.status(201).json(await Coupon.create(req.body));
    } catch (error) {
        res.status(400).send("تعذر حفظ الكوبون");
    }
});

app.get("/api/books/:bookId", async (req, res) => {
    try {
        const book = await Book.findById(req.params.bookId).lean();
        if (!book) return res.status(404).send("الكتاب غير موجود");

        const comments = await Comment.find({ bookId: book._id }).sort({ createdAt: -1 }).lean();
        const averageRating = comments.length
            ? comments.reduce((sum, comment) => sum + comment.rating, 0) / comments.length
            : 0;

        res.json({ ...applyBookDiscount(book), comments, averageRating: Number(averageRating.toFixed(1)), reviewsCount: comments.length });
    } catch (error) {
        res.status(500).send("تعذر تحميل تفاصيل الكتاب");
    }
});

app.post("/api/books/:bookId/comments", async (req, res) => {
    try {
        const userEmail = getSessionEmail(req);
        const { rating, text } = req.body;
        if (!userEmail) return res.status(401).send("يجب تسجيل الدخول أولًا");
        if (!rating || !text?.trim()) return res.status(400).send("اكتب التقييم والتعليق أولًا");

        const user = await User.findOne({ email: userEmail }).lean();
        if (!user) return res.status(401).send("يجب تسجيل الدخول أولًا");

        const book = await Book.findById(req.params.bookId).lean();
        if (!book) return res.status(404).send("الكتاب غير موجود");

        const comment = await Comment.create({
            bookId: book._id,
            userEmail,
            userName: user.name,
            rating: Number(rating),
            text: text.trim()
        });

        res.status(201).json(comment);
    } catch (error) {
        res.status(500).send("تعذر حفظ التعليق");
    }
});

app.post("/api/purchases", async (req, res) => {
    try {
        const userEmail = getSessionEmail(req);
        const { bookIds, receiptImage } = req.body;
        if (!userEmail) return res.status(401).send("يجب تسجيل الدخول أولًا");
        if (!Array.isArray(bookIds) || !bookIds.length) return res.status(400).send("السلة فارغة");
        if (typeof receiptImage !== "string" || !/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(receiptImage)) {
            return res.status(400).send("أرفق صورة إيصال التحويل");
        }
        if (receiptImage.length > 10 * 1024 * 1024) return res.status(413).send("حجم الإيصال كبير جدًا");

        const books = await Book.find({ _id: { $in: bookIds } }).lean();
        if (books.length !== new Set(bookIds.map(String)).size) return res.status(404).send("أحد الكتب غير موجود");
        const alreadyPurchased = await Purchase.exists({ userEmail, bookId: { $in: bookIds }, status: "paid" });
        if (alreadyPurchased) return res.status(409).send("أحد الكتب موجود بالفعل في كتبك المشتراة");
        const pricedBooks = books.map(applyBookDiscount);
        const amountCents = pricedBooks.reduce((sum, book) => sum + Math.round(book.price * 100), 0);

        const alreadyPending = await Payment.exists({ userEmail, bookIds: { $in: bookIds }, status: "pending" });
        if (alreadyPending) return res.status(409).send("لديك طلب قيد المراجعة بالفعل");
        await Payment.create({ userEmail, bookIds: books.map(book => book._id), receiptImage, amountCents });
        await Library.updateOne({ userEmail }, { $set: { cartBookIds: [] } });

        res.status(201).json({ pending: true });
    } catch (error) {
        res.status(500).send("تعذر إرسال طلب الدفع للمراجعة");
    }
});

app.get("/api/payments/mine", requireUser, async (req, res) => {
    try {
        const payments = await Payment.find({ userEmail: req.currentUser.email })
            .sort({ createdAt: -1 }).limit(20).populate("bookIds", "title").lean();
        res.json(payments.map(payment => ({
            id: payment._id,
            status: payment.status,
            rejectionReason: payment.rejectionReason,
            total: Number((payment.amountCents / 100).toFixed(2)),
            bookIds: payment.bookIds.map(book => String(book._id || book)),
            books: payment.bookIds.map(book => book.title),
            createdAt: payment.createdAt
        })));
    } catch (error) {
        res.status(500).send("تعذر تحميل حالة طلباتك");
    }
});

app.post("/api/admin/orders/:orderId/confirm", requireAdmin, async (req, res) => {
    try {
        const payment = await Payment.findOne({ _id: req.params.orderId, status: "pending" });
        if (!payment) return res.status(404).send("طلب الدفع غير موجود أو تم اعتماده بالفعل");
        await Purchase.bulkWrite(payment.bookIds.map(bookId => ({
            updateOne: {
                filter: { userEmail: payment.userEmail, bookId },
                update: { userEmail: payment.userEmail, bookId, status: "paid" },
                upsert: true
            }
        })));
        payment.status = "paid";
        await payment.save();
        res.json({ confirmed: true });
    } catch (error) {
        res.status(500).send("تعذر تأكيد الدفع");
    }
});

app.post("/api/admin/orders/:orderId/reject", requireAdmin, async (req, res) => {
    try {
        const reason = String(req.body.reason || "الإيصال غير صحيح أو لم يتم تحويل المبلغ المحدد").trim();
        if (!reason) return res.status(400).send("اكتب سبب رفض الدفع");
        const payment = await Payment.findOne({ _id: req.params.orderId, status: "pending" });
        if (!payment) return res.status(404).send("طلب الدفع غير موجود أو تم التعامل معه بالفعل");
        payment.status = "failed";
        payment.rejectionReason = reason.slice(0, 300);
        await payment.save();
        res.json({ rejected: true });
    } catch (error) {
        res.status(500).send("تعذر رفض الدفع");
    }
});

app.get("/api/purchases/:bookId", async (req, res) => {
    try {
        const userEmail = getSessionEmail(req);
        if (!userEmail) return res.status(401).send("يجب تسجيل الدخول أولًا");
        const purchase = await Purchase.exists({
            userEmail,
            bookId: req.params.bookId,
            status: "paid"
        });
        const pending = !purchase && await Payment.exists({
            userEmail,
            bookIds: req.params.bookId,
            status: "pending"
        });
        res.json({ purchased: Boolean(purchase), pending: Boolean(pending), accessUrl: `/api/books/${req.params.bookId}/access` });
    } catch (error) {
        res.status(500).send("تعذر التحقق من الشراء");
    }
});

app.get("/api/books/:bookId/access", async (req, res) => {
    try {
        const userEmail = getSessionEmail(req);
        if (!userEmail) return res.status(401).send("يجب تسجيل الدخول أولًا");
        const purchase = await Purchase.findOne({ userEmail, bookId: req.params.bookId, status: "paid" });
        if (!purchase) return res.status(403).send("يجب شراء الكتاب أولًا");

        const book = await Book.findById(req.params.bookId).lean();
        if (!book || !book.pdfFile) return res.status(404).send("ملف PDF غير مرفوع لهذا الكتاب");
        if (/^https?:\/\//i.test(book.pdfFile)) {
            const pdfResponse = await fetch(book.pdfFile);
            if (!pdfResponse.ok || !pdfResponse.body) return res.status(502).send("تعذر جلب ملف PDF");

            res.setHeader("Content-Type", pdfResponse.headers.get("content-type") || "application/pdf");
            if (req.query.download === "1") {
                res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${book.title}.pdf`)}`);
            }
            Readable.fromWeb(pdfResponse.body).pipe(res);
            return;
        }
        const pdfPath = path.join(__dirname, "digital-books", path.basename(book.pdfFile));
        if (!fs.existsSync(pdfPath)) return res.status(404).send("ملف PDF غير موجود على السيرفر");
        if (req.query.download === "1") return res.download(pdfPath, path.basename(pdfPath));
        res.sendFile(pdfPath);
    } catch (error) {
        res.status(500).send("تعذر فتح الكتاب");
    }
});

app.post("/register", async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        const email = normalizeEmail(req.body.email);
        const pass = String(req.body.pass || "");
        if (!name || !email || pass.length < 8) return res.status(400).send("الاسم والبريد وكلمة مرور من 8 أحرف مطلوبة");

        const existingUser = await User.findOne({ email });
        if (existingUser) return res.status(400).send("البريد الإلكتروني مستخدم بالفعل");

        const role = isConfiguredAdminEmail(email) ? "admin" : "user";
        await User.create({
            name,
            email,
            pass: await bcrypt.hash(pass, 12),
            role
        });

        res.send("تم استلام البيانات بنجاح");
    } catch (error) {
        res.status(500).send("تعذر الاتصال بقاعدة البيانات");
    }
});

app.post("/login", async (req, res) => {
    try {
        const email = normalizeEmail(req.body.email);
        const user = await User.findOne({ email });
        const submittedPass = String(req.body.pass || "");
        const validPassword = user && (await bcrypt.compare(submittedPass, user.pass).catch(() => false)
            || user.pass === submittedPass);
        if (validPassword) {
            if (user.pass === submittedPass) {
                user.pass = await bcrypt.hash(submittedPass, 12);
                await user.save();
            }

            if (isConfiguredAdminEmail(user.email) && user.role !== "admin") {
                user.role = "admin";
                await User.updateOne({ _id: user._id }, { $set: { role: "admin" } });
            }

            setSessionCookie(res, user.email);
            return res.json(publicUser(user));
        }
        return res.status(401).send("البريد الإلكتروني أو كلمة المرور غير صحيحة");
    } catch (error) {
        res.status(500).send("تعذر الاتصال بقاعدة البيانات");
    }
});

app.post("/logout", (req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
});

async function updateUser(req, res) {
    try {
        const userEmail = getSessionEmail(req);
        if (!userEmail) return res.status(401).send("يجب تسجيل الدخول أولًا");
        const updates = {
            name: String(req.body.name || "").trim(),
            email: String(req.body.email || "").trim().toLowerCase(),
            phone: req.body.phone,
            photo: req.body.photo || req.body.avatar
        };
        if (!updates.name || !updates.email) return res.status(400).send("الاسم والبريد مطلوبان");
        if (req.body.pass) updates.pass = await bcrypt.hash(String(req.body.pass), 12);

        const user = await User.findOneAndUpdate(
            { email: userEmail },
            updates,
            { new: true, runValidators: true }
        ).lean();

        if (!user) return res.status(404).send("المستخدم غير موجود");
        setSessionCookie(res, user.email);
        res.json(publicUser(user));
    } catch (error) {
        res.status(400).send("تعذر تحديث البيانات");
    }
}

app.put("/update-user", updateUser);

app.post("/update", updateUser);

async function ensureDefaultAdminUser() {
    const configuredAdminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const adminPassword = String(process.env.ADMIN_PASSWORD || "Admin123456").trim();
    if (!configuredAdminEmail) return;

    const existingUser = await User.findOne({ email: configuredAdminEmail }).lean();
    if (existingUser) {
        if (existingUser.role !== "admin") {
            await User.updateOne({ email: configuredAdminEmail }, { $set: { role: "admin" } });
        }
        return;
    }

    if (!adminPassword) return;

    await User.create({
        name: "Administrator",
        email: configuredAdminEmail,
        pass: await bcrypt.hash(adminPassword, 12),
        role: "admin",
        phone: "",
        photo: ""
    });

    console.log(`Default admin account created for ${configuredAdminEmail} with password: ${adminPassword}`);
}

let databasePromise;

async function connectDatabase() {
    if (!databasePromise) {
        databasePromise = mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 50,
            minPoolSize: 5,
            maxIdleTimeMS: 30000
        }).then(async () => {
            console.log("MongoDB connected: myapp");
            await Payment.collection.dropIndex("paymobOrderId_1").catch(() => {});

            const configuredAdminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
            if (configuredAdminEmail) {
                await User.updateMany(
                    { email: configuredAdminEmail },
                    { $set: { role: "admin" } },
                    { runValidators: true }
                );
            }

            await ensureDefaultAdminUser();
            await createBooksCollection();
        });
    }
    return databasePromise;
}

async function startServer() {
    try {
        await connectDatabase();
        app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));
    } catch (error) {
        console.error("MongoDB connection failed:", error.message);
        process.exitCode = 1;
    }
}

if (require.main === module) {
    startServer();
}

module.exports = { app, connectDatabase };

