
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
const DEFAULT_DISCOUNT_PERCENT = 0;
const SESSION_COOKIE = "book_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const SESSION_SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : crypto.randomBytes(32).toString("hex"));
const KASHIER_SECRET_KEY = process.env.KASHIER_SECRET_KEY || "";
const KASHIER_API_KEY = process.env.KASHIER_API_KEY || "";
const KASHIER_MERCHANT_ID = process.env.KASHIER_MERCHANT_ID || "";
const configuredKashierPaymentUrl = process.env.KASHIER_PAYMENT_URL || "";
const KASHIER_PAYMENT_URL = configuredKashierPaymentUrl.includes("/v3/payment/sessions")
    ? configuredKashierPaymentUrl
    : "https://test-api.kashier.io/v3/payment/sessions";

if (process.env.DNS_SERVERS) {
    dns.setServers(process.env.DNS_SERVERS.split(",").map(server => server.trim()).filter(Boolean));
}

if (process.env.NODE_ENV === "production" && (!SESSION_SECRET || SESSION_SECRET.length < 32)) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
}

const bookSchema = new mongoose.Schema({
    title: { type: String, required: true, unique: true },
    author: { type: String, required: true },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    price: { type: Number, required: true, min: 0 },
    originalPrice: { type: Number },
    discountPercent: { type: Number, min: 0, max: 90, default: DEFAULT_DISCOUNT_PERCENT },
    seriesId: { type: mongoose.Schema.Types.ObjectId, ref: "Series", default: null },
    image: { type: String, required: true },
    description: { type: String, default: "كتاب رقمي مختار بعناية من رفوف." },
    pdfFile: { type: String, default: null },
    readCount: { type: Number, min: 0, default: 0 },
    deletedAt: { type: Date, default: null }
}, { timestamps: true });
bookSchema.index({ deletedAt: 1, createdAt: -1 });

const Book = mongoose.model("Book", bookSchema);

const categorySchema = new mongoose.Schema({
    name: { type: String, required: true, unique: true, trim: true, maxlength: 80 }
}, { timestamps: true });

const Category = mongoose.model("Category", categorySchema);

const purchaseSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    bookId: { type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true },
    status: { type: String, enum: ["paid"], default: "paid" }
}, { timestamps: true });

purchaseSchema.index({ userEmail: 1, bookId: 1 }, { unique: true });
purchaseSchema.index({ userEmail: 1, status: 1 });
const Purchase = mongoose.model("Purchase", purchaseSchema);

const paymentSchema = new mongoose.Schema({
    userEmail: { type: String, required: true },
    bookIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Book", required: true }],
    rejectionReason: { type: String, default: null },
    orderNumber: { type: Number, unique: true, default: () => Date.now() + Math.floor(Math.random() * 100000) },
    amountCents: { type: Number, required: true },
    status: { type: String, enum: ["pending", "paid", "failed"], default: "pending" },
    kashierOrderId: { type: String, default: null, index: true },
    kashierTransactionId: { type: String, default: null, index: true },
    kashierOrderReference: { type: String, default: null, index: true }
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
    const discountPercent = Math.min(90, Math.max(0, Number(book.discountPercent ?? 0)));
    const price = Math.round(originalPrice * (100 - discountPercent)) / 100;
    return { ...book, originalPrice, discountPercent, price };
}

function publicBook(book) {
    const discountedBook = applyBookDiscount(book);
    const { pdfFile, ...bookWithoutPdf } = discountedBook;
    return { ...bookWithoutPdf, hasPdf: book.hasPdf ?? Boolean(pdfFile) };
}

async function findBookSummaries(filter = {}) {
    return Book.aggregate([
        { $match: filter },
        { $sort: { createdAt: -1 } },
        { $project: {
            title: 1,
            author: 1,
            category: 1,
            price: 1,
            originalPrice: 1,
            discountPercent: 1,
            seriesId: 1,
            image: 1,
            description: 1,
            readCount: 1,
            deletedAt: 1,
            createdAt: 1,
            updatedAt: 1,
            hasPdf: { $ne: [{ $ifNull: ["$pdfFile", null] }, null] }
        } }
    ]);
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
    await Book.createCollection().catch(error => {
        if (error.code !== 48) throw error;
    });
    await Book.bulkWrite([

    ]);
    console.log("MongoDB collection ready: books");
}

async function ensureDefaultCategories() {
    const defaultCategories = ["برمجة وتطوير", "ذكاء اصطناعي", "أمن المعلومات", "علوم البيانات"];
    await Category.bulkWrite(defaultCategories.map(name => ({
        updateOne: { filter: { name }, update: { $setOnInsert: { name } }, upsert: true }
    })));
}

const userSchema = new mongoose.Schema({
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    phone: { type: String, unique: true, sparse: true },
    pass: { type: String, required: true },
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

function normalizePhone(value) {
    return String(value || "").replace(/\D/g, "");
}

function isValidPhone(value) {
    return /^\d{11}$/.test(value);
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
app.use(express.static(path.join(__dirname, "public")));
app.use(express.static(__dirname));
app.use(express.json({ limit: "20mb" }));

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
        const cartBookIds = Array.isArray(req.body.cartBookIds) ? [...new Set(req.body.cartBookIds.map(String))] : [];
        const favoriteBookIds = Array.isArray(req.body.favoriteBookIds) ? [...new Set(req.body.favoriteBookIds.map(String))] : [];
        const library = await Library.findOneAndUpdate(
            { userEmail: req.currentUser.email },
            { $set: { userEmail: req.currentUser.email, cartBookIds, favoriteBookIds } },
            { upsert: true, new: true, runValidators: true }
        ).lean();
        res.json(library);
    } catch (error) {
        console.error("Library save error:", error.message);
        res.status(400).send("تعذر حفظ مكتبتك");
    }
});

app.get("/api/categories", async (req, res) => {
    try {
        const categories = await Category.find().sort({ name: 1 }).lean();
        res.json(categories.map(category => ({ id: String(category._id), name: category.name })));
    } catch (error) {
        res.status(500).send("تعذر تحميل التصنيفات");
    }
});

app.get("/api/books", async (req, res) => {
    try {
        const books = await findBookSummaries({ deletedAt: null });
        res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        res.json(books.map(publicBook));
    } catch (error) {
        console.error("Books query error:", error.message);
        res.status(500).send("تعذر تحميل الكتب");
    }
});

app.get("/api/purchased-books", requireUser, async (req, res) => {
    try {
        const [purchases, pendingPayments] = await Promise.all([
            Purchase.find({ userEmail: req.currentUser.email, status: "paid" }).select("bookId").lean(),
            Payment.find({ userEmail: req.currentUser.email, status: "pending" }).select("bookIds").lean()
        ]);
        const bookIds = [
            ...purchases.map(item => item.bookId),
            ...pendingPayments.flatMap(payment => payment.bookIds)
        ];
        const books = await Book.find({ _id: { $in: bookIds } }).lean();
        res.json(books.map(publicBook));
    } catch (error) {
        res.status(500).send("تعذر تحميل كتبك المشتراة");
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
            id: String(payment._id),
            userEmail: payment.userEmail,
            status: payment.status,
            rejectionReason: payment.rejectionReason,
            amountCents: payment.amountCents,
            kashierOrderId: payment.kashierOrderId,
            kashierTransactionId: payment.kashierTransactionId,
            kashierOrderReference: payment.kashierOrderReference,
            createdAt: payment.createdAt,
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
        const books = await findBookSummaries({ deletedAt: null });
        res.json(books.map(publicBook));
    } catch (error) {
        res.status(500).send("تعذر تحميل الكتب");
    }
});

app.get("/api/admin/categories", requireAdmin, async (req, res) => {
    try {
        const categories = await Category.find().sort({ name: 1 }).lean();
        const usage = await Book.aggregate([{ $group: { _id: "$category", count: { $sum: 1 } } }]);
        const usageByName = new Map(usage.map(item => [item._id, item.count]));
        res.json(categories.map(category => ({ id: String(category._id), name: category.name, bookCount: usageByName.get(category.name) || 0 })));
    } catch (error) {
        res.status(500).send("تعذر تحميل التصنيفات");
    }
});

app.post("/api/admin/categories", requireAdmin, async (req, res) => {
    try {
        const name = String(req.body.name || "").trim();
        if (!name) return res.status(400).send("اسم التصنيف مطلوب");
        if (name.length > 80) return res.status(400).send("اسم التصنيف طويل جدًا");
        const category = await Category.create({ name });
        res.status(201).json({ id: String(category._id), name: category.name, bookCount: 0 });
    } catch (error) {
        res.status(error.code === 11000 ? 409 : 400).send(error.code === 11000 ? "التصنيف موجود بالفعل" : "تعذر إضافة التصنيف");
    }
});

app.delete("/api/admin/categories/:categoryId", requireAdmin, async (req, res) => {
    try {
        const category = await Category.findById(req.params.categoryId).lean();
        if (!category) return res.status(404).send("التصنيف غير موجود");
        const booksUsingCategory = await Book.exists({ category: category.name });
        if (booksUsingCategory) return res.status(409).send("لا يمكن حذف تصنيف مرتبط بكتب");
        await Category.deleteOne({ _id: category._id });
        res.status(204).end();
    } catch (error) {
        res.status(400).send("تعذر حذف التصنيف");
    }
});

app.delete("/api/admin/books/:bookId", requireAdmin, async (req, res) => {
    try {
        const bookId = new mongoose.Types.ObjectId(req.params.bookId);

        const deletedBook = await Book.findOneAndDelete({ _id: bookId });
        if (!deletedBook) return res.status(404).send("الكتاب غير موجود أو محذوف بالفعل");

        await Promise.all([
            Library.updateMany(
                { $or: [{ cartBookIds: bookId }, { favoriteBookIds: bookId }] },
                { $pull: { cartBookIds: bookId, favoriteBookIds: bookId } }
            ),
            Purchase.deleteMany({ bookId }),
            Payment.updateMany(
                { bookIds: bookId },
                { $pull: { bookIds: bookId } }
            )
        ]);

        res.status(204).end();
    } catch (error) {
        res.status(400).send("معرّف الكتاب غير صالح أو تعذر حذفه");
    }
});

app.put("/api/admin/books/:bookId/series", requireAdmin, async (req, res) => {
    try {
        const seriesId = req.body.seriesId || null;
        if (seriesId && !await Series.exists({ _id: seriesId })) return res.status(404).send("السلسلة غير موجودة");
        const book = await Book.findByIdAndUpdate(req.params.bookId, { seriesId }, { new: true }).lean();
        if (!book) return res.status(404).send("الكتاب غير موجود");
        res.json(book);
    } catch (error) {
        res.status(400).send("تعذر تحديث السلسلة");
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
        const { title, author, category, price, discountPercent, cover, file, description, seriesId } = req.body;
        const normalizedCategory = String(category || "").trim();
        const basePrice = Number(price);
        const discount = Math.min(90, Math.max(0, Number(discountPercent || 0)));
        if (!Number.isFinite(basePrice) || basePrice < 0) return res.status(400).send("السعر يجب أن يكون صفرًا أو أكبر");
        if (!Number.isFinite(discount)) return res.status(400).send("نسبة الخصم غير صحيحة");
        if (!normalizedCategory || !await Category.exists({ name: normalizedCategory })) return res.status(400).send("التصنيف غير موجود");
        if (typeof cover !== "string" || !cover.trim()) return res.status(400).send("صورة الغلاف مطلوبة");
        if (cover.startsWith("data:") && !/^data:image\/(png|jpe?g|webp);base64,[A-Za-z0-9+/=]+$/i.test(cover)) return res.status(400).send("صيغة صورة الغلاف غير مدعومة");
        if (typeof file === "string" && file.startsWith("data:") && !/^data:application\/pdf;base64,[A-Za-z0-9+/=]+$/i.test(file)) return res.status(400).send("صيغة ملف الكتاب غير مدعومة");
        if (typeof file === "string" && file.length > 8 * 1024 * 1024) return res.status(413).send("ملف الكتاب كبير جدًا، الحد الأقصى 6 ميجابايت");
        const finalPrice = Math.round(basePrice * (100 - discount) / 100 * 100) / 100;
        const book = await Book.create({ title, author, category: normalizedCategory, price: finalPrice, originalPrice: basePrice, discountPercent: discount, image: cover, pdfFile: file || null, description, seriesId: seriesId || null });
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

app.get("/api/admin/coupons", requireAdmin, async (req, res) => {
    try {
        res.json(await Coupon.find().sort({ createdAt: -1 }).lean());
    } catch (error) {
        res.status(500).send("تعذر تحميل الكوبونات");
    }
});

app.delete("/api/admin/coupons/:couponId", requireAdmin, async (req, res) => {
    try {
        const deletedCoupon = await Coupon.findByIdAndDelete(req.params.couponId);
        if (!deletedCoupon) return res.status(404).send("الكوبون غير موجود");
        res.status(204).end();
    } catch (error) {
        res.status(400).send("تعذر حذف الكوبون");
    }
});

app.post("/api/coupons/validate", async (req, res) => {
    try {
        const code = String(req.body.code || "").trim().toUpperCase();
        const subtotal = Number(req.body.subtotal);
        if (!code) return res.status(400).send("اكتب كود الخصم أولًا");
        if (!Number.isFinite(subtotal) || subtotal < 0) return res.status(400).send("إجمالي الطلب غير صحيح");

        const coupon = await Coupon.findOne({ code }).lean();
        if (!coupon) return res.status(404).send("كود الخصم غير صحيح");
        if (subtotal < Number(coupon.minPurchase || 0)) return res.status(400).send("الطلب لا يحقق الحد الأدنى للكوبون");

        const total = coupon.type === "percentage"
            ? Math.max(0, subtotal * (100 - Math.min(100, Number(coupon.value))) / 100)
            : Math.max(0, subtotal - Number(coupon.value));
        res.json({ code, subtotal, total: Number(total.toFixed(2)), discount: Number((subtotal - total).toFixed(2)) });
    } catch (error) {
        res.status(500).send("تعذر التحقق من الكوبون");
    }
});

app.get("/api/books/:bookId", async (req, res) => {
    try {
        const book = await Book.findOne({ _id: req.params.bookId, deletedAt: null }).lean();
        if (!book) return res.status(404).send("الكتاب غير موجود");
        res.set("Cache-Control", "public, max-age=300, stale-while-revalidate=600");
        res.json(publicBook(book));
    } catch (error) {
        res.status(500).send("تعذر تحميل تفاصيل الكتاب");
    }
});

app.get("/api/books/:bookId/comments", async (req, res) => {
    try {
        const [result] = await Comment.aggregate([
            { $match: { bookId: new mongoose.Types.ObjectId(req.params.bookId) } },
            { $facet: {
                comments: [
                    { $sort: { createdAt: -1 } },
                    { $project: { _id: 0, userName: 1, rating: 1, text: 1, createdAt: 1 } }
                ],
                summary: [
                    { $group: { _id: null, count: { $sum: 1 }, averageRating: { $avg: "$rating" } } }
                ]
            } }
        ]);
        const summary = result?.summary[0] || { count: 0, averageRating: 0 };
        res.set("Cache-Control", "public, max-age=15, stale-while-revalidate=60");
        res.json({
            comments: result?.comments || [],
            averageRating: Number(Number(summary.averageRating || 0).toFixed(1)),
            reviewsCount: summary.count || 0
        });
    } catch (error) {
        console.error("Book comments query error:", error.message);
        res.status(500).send("تعذر تحميل التقييمات");
    }
});

app.post("/api/books/:bookId/read", requireUser, async (req, res) => {
    try {
        const book = await Book.findOne({ _id: req.params.bookId, deletedAt: null }).lean();
        if (!book) return res.status(404).send("الكتاب غير موجود");
        if (!book.pdfFile) return res.status(404).send("ملف القراءة غير مرفوع لهذا الكتاب");

        const freeBook = applyBookDiscount(book).price <= 0;
        if (!freeBook) {
            const purchase = await Purchase.findOne({ userEmail: req.currentUser.email, bookId: book._id, status: "paid" });
            if (!purchase) return res.status(403).send("يجب شراء الكتاب أولًا");
        }

        const updatedBook = await Book.findOneAndUpdate(
            { _id: book._id, deletedAt: null, pdfFile: { $ne: null } },
            { $inc: { readCount: 1 } },
            { new: true }
        ).select("readCount").lean();
        res.json({ readCount: updatedBook?.readCount || 0 });
    } catch (error) {
        res.status(500).send("تعذر تسجيل القراءة");
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

async function getPaymentBooks(req, userEmail) {
    const { bookIds } = req.body;
    if (!Array.isArray(bookIds) || !bookIds.length) throw new Error("السلة فارغة");
    const books = await Book.find({ _id: { $in: bookIds } }).lean();
    if (books.length !== new Set(bookIds.map(String)).size) throw new Error("أحد الكتب غير موجود");
    if (await Purchase.exists({ userEmail, bookId: { $in: bookIds }, status: "paid" })) throw new Error("أحد الكتب موجود بالفعل في كتبك المشتراة");

    let amountCents = books.map(applyBookDiscount).reduce((sum, book) => sum + Math.round(book.price * 100), 0);
    const couponCode = String(req.body.couponCode || "").trim().toUpperCase();
    if (couponCode) {
        const coupon = await Coupon.findOne({ code: couponCode }).lean();
        if (!coupon) throw new Error("كود الخصم غير صحيح");
        if (amountCents < Math.round(Number(coupon.minPurchase || 0) * 100)) throw new Error("الطلب لا يحقق الحد الأدنى للكوبون");
        amountCents = coupon.type === "percentage"
            ? Math.max(0, Math.round(amountCents * (100 - Math.min(100, coupon.value)) / 100))
            : Math.max(0, amountCents - Math.round(coupon.value * 100));
    }
    if (await Payment.exists({ userEmail, bookIds: { $in: bookIds }, status: "pending" })) throw new Error("لديك طلب قيد المراجعة بالفعل");
    return { books, amountCents };
}

async function completePayment(payment, transactionId) {
    if (payment.status === "paid") return;
    await Purchase.bulkWrite(payment.bookIds.map(bookId => ({
        updateOne: {
            filter: { userEmail: payment.userEmail, bookId },
            update: { userEmail: payment.userEmail, bookId, status: "paid" },
            upsert: true
        }
    })));
    payment.status = "paid";
    payment.kashierTransactionId = transactionId || payment.kashierTransactionId;
    await payment.save();
    await Library.updateOne({ userEmail: payment.userEmail }, { $set: { cartBookIds: [] } });
}

app.post("/api/payments/create", async (req, res) => {
    try {
        const userEmail = getSessionEmail(req);
        if (!userEmail) return res.status(401).send("يجب تسجيل الدخول أولًا");
        if (!KASHIER_SECRET_KEY || !KASHIER_MERCHANT_ID) return res.status(503).send("لم يتم إعداد بيانات Kashier على الخادم");
        const { books, amountCents } = await getPaymentBooks(req, userEmail);
        if (amountCents <= 0) return res.status(400).send("استخدم مسار شراء الكتب المجانية");

        const payment = await Payment.create({ userEmail, bookIds: books.map(book => book._id), amountCents });
        const orderReference = String(payment._id);
        const origin = `${req.protocol}://${req.get("host")}`;
        const isPaymentSession = KASHIER_PAYMENT_URL.includes("/v3/payment/sessions");
        if (isPaymentSession && !KASHIER_API_KEY) {
            await Payment.deleteOne({ _id: payment._id, status: "pending" });
            return res.status(503).send("لم يتم إعداد KASHIER_API_KEY على الخادم");
        }
        const redirectUrl = `${origin}/cart.html?payment=return&order=${encodeURIComponent(orderReference)}&paymentId=${encodeURIComponent(String(payment._id))}`;
        const requestBody = isPaymentSession
            ? {
                expireAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                maxFailureAttempts: 3,
                paymentType: "credit",
                amount: (amountCents / 100).toFixed(2),
                currency: "EGP",
                order: orderReference,
                merchantId: KASHIER_MERCHANT_ID,
                merchantRedirect: redirectUrl,
                serverWebhook: process.env.KASHIER_WEBHOOK_URL || `${origin}/api/payments/kashier/webhook`,
                display: "ar",
                type: "one-time",
                customer: { email: userEmail, reference: userEmail }
            }
            : {
                merchantId: KASHIER_MERCHANT_ID,
                amount: (amountCents / 100).toFixed(2),
                currency: "EGP",
                orderReference,
                redirectUrl,
                webhookUrl: process.env.KASHIER_WEBHOOK_URL || `${origin}/api/payments/kashier/webhook`
            };
        const response = await fetch(KASHIER_PAYMENT_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: KASHIER_SECRET_KEY,
                ...(isPaymentSession ? { "api-key": KASHIER_API_KEY } : {})
            },
            body: JSON.stringify(requestBody)
        });
        const responseText = await response.text();
        let data = {};
        try {
            data = responseText ? JSON.parse(responseText) : {};
        } catch {
            data = { message: responseText };
        }
        if (!response.ok) {
            await Payment.deleteOne({ _id: payment._id, status: "pending" });
            const firstError = Array.isArray(data.errors) ? data.errors[0] : data.errors;
            const kashierError = data.message || data.error?.message || data.error || firstError?.message || firstError || responseText;
            console.error("Kashier payment-link error:", response.status, data);
            return res.status(502).send(kashierError || "تعذر إنشاء رابط الدفع عبر Kashier");
        }
        const paymentUrl = data.sessionUrl
            || data.paymentUrl
            || data.redirectUrl
            || data.url
            || data.data?.sessionUrl
            || data.data?.paymentUrl
            || data.data?.redirectUrl
            || data.data?.url;
        if (!paymentUrl) {
            await Payment.deleteOne({ _id: payment._id, status: "pending" });
            return res.status(502).send("استجابة Kashier لا تحتوي على رابط دفع");
        }
        payment.kashierOrderId = data.kashierOrderId || data.orderId || data.data?.kashierOrderId || null;
        payment.kashierOrderReference = data.orderReference || data.data?.orderReference || orderReference;
        await payment.save();
        res.status(201).json({ paymentUrl, paymentId: String(payment._id), bookIds: books.map(book => String(book._id)) });
    } catch (error) {
        const clientError = /السلة|غير موجود|كود الخصم|الحد الأدنى|موجود بالفعل|قيد المراجعة/.test(error.message);
        res.status(clientError ? 400 : 500).send(error.message || "تعذر إنشاء طلب الدفع");
    }
});

app.post("/api/payments/kashier/webhook", async (req, res) => {
    try {
        const payload = req.body?.payload || req.body;
        const data = payload?.data || {};
        const signature = req.get("x-kashier-signature");
        const signatureKeys = Array.isArray(data.signatureKeys) ? [...data.signatureKeys].sort() : [];
        const signaturePayload = signatureKeys
            .filter(key => Object.prototype.hasOwnProperty.call(data, key))
            .map(key => `${key}=${encodeURIComponent(data[key])}`)
            .join("&");
        const expectedSignature = signaturePayload && KASHIER_API_KEY
            ? crypto.createHmac("sha256", KASHIER_API_KEY).update(signaturePayload).digest("hex")
            : "";
        const receivedSignature = Buffer.from(String(signature || "").toLowerCase());
        const expectedSignatureBuffer = Buffer.from(expectedSignature);
        const signaturesMatch = receivedSignature.length === expectedSignatureBuffer.length
            && expectedSignatureBuffer.length > 0
            && crypto.timingSafeEqual(receivedSignature, expectedSignatureBuffer);
        if (!signaturesMatch) {
            return res.status(401).send("توقيع Kashier غير صحيح");
        }
        if (KASHIER_MERCHANT_ID && data.merchantId && data.merchantId !== KASHIER_MERCHANT_ID) return res.status(401).send("معرّف التاجر غير صحيح");
        const identifiers = [data.kashierOrderId, data.orderReference, data.merchantOrderId].filter(Boolean);
        const payment = await Payment.findOne({ $or: [
            { kashierOrderId: { $in: identifiers } },
            { kashierOrderReference: { $in: identifiers } },
            { _id: data.merchantOrderId }
        ] });
        if (!payment) return res.status(404).send("طلب الدفع غير موجود");
        const receivedAmount = Number(data.amount);
        const amountMatches = receivedAmount === payment.amountCents || receivedAmount === Number((payment.amountCents / 100).toFixed(2));
        if (data.status === "SUCCESS" && String(data.transactionResponseCode) === "00" && amountMatches) {
            await completePayment(payment, data.transactionId);
        } else if (data.status && data.status !== "SUCCESS" && payment.status === "pending") {
            payment.status = "failed";
            payment.rejectionReason = data.transactionResponseMessage?.en || "لم تكتمل معاملة Kashier";
            await payment.save();
        }
        res.status(200).json({ received: true });
    } catch (error) {
        res.status(500).send("تعذر معالجة إشعار Kashier");
    }
});

app.post("/api/purchases/free", async (req, res) => {
    try {
        const userEmail = getSessionEmail(req);
        const { bookIds } = req.body;
        if (!userEmail) return res.status(401).send("يجب تسجيل الدخول أولًا");
        if (!Array.isArray(bookIds) || !bookIds.length) return res.status(400).send("السلة فارغة");

        const books = await Book.find({ _id: { $in: bookIds } }).lean();
        if (books.length !== new Set(bookIds.map(String)).size) return res.status(404).send("أحد الكتب غير موجود");
        const alreadyPurchased = await Purchase.exists({ userEmail, bookId: { $in: bookIds }, status: "paid" });
        if (alreadyPurchased) return res.status(409).send("أحد الكتب موجود بالفعل في كتبك المشتراة");
        const pricedBooks = books.map(applyBookDiscount);
        let amountCents = pricedBooks.reduce((sum, book) => sum + Math.round(book.price * 100), 0);
        const couponCode = String(req.body.couponCode || "").trim().toUpperCase();
        if (couponCode) {
            const coupon = await Coupon.findOne({ code: couponCode }).lean();
            if (!coupon) return res.status(400).send("كود الخصم غير صحيح");
            if (amountCents < Math.round(Number(coupon.minPurchase || 0) * 100)) return res.status(400).send("الطلب لا يحقق الحد الأدنى للكوبون");
            amountCents = coupon.type === "percentage"
                ? Math.max(0, Math.round(amountCents * (100 - Math.min(100, coupon.value)) / 100))
                : Math.max(0, amountCents - Math.round(coupon.value * 100));
        }

        if (amountCents !== 0) return res.status(400).send("هذا المسار مخصص للكتب المجانية فقط");
        await Purchase.bulkWrite(books.map(book => ({
            updateOne: {
                filter: { userEmail, bookId: book._id },
                update: { userEmail, bookId: book._id, status: "paid" },
                upsert: true
            }
        })));
        await Library.updateOne({ userEmail }, { $set: { cartBookIds: [] } });
        res.status(201).json({ pending: false, paid: true, bookIds: books.map(book => String(book._id)) });
    } catch (error) {
        res.status(500).send("تعذر تثبيت الكتب المجانية");
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

app.get("/api/purchases", async (req, res) => {
    try {
        const userEmail = getSessionEmail(req);
        if (!userEmail) return res.status(401).send("يجب تسجيل الدخول أولًا");

        const [purchases, pendingPayments] = await Promise.all([
            Purchase.find({ userEmail, status: "paid" }).select("bookId").lean(),
            Payment.find({ userEmail, status: "pending" }).select("bookIds").lean()
        ]);

        res.json({
            purchasedIds: purchases.map(item => String(item.bookId)),
            pendingIds: pendingPayments.flatMap(payment => payment.bookIds.map(bookId => String(bookId)))
        });
    } catch (error) {
        res.status(500).send("تعذر التحقق من مشترياتك");
    }
});

app.get("/api/books/:bookId/access", async (req, res) => {
    try {
        const book = await Book.findById(req.params.bookId).lean();
        if (!book || !book.pdfFile) return res.status(404).send("ملف PDF غير مرفوع لهذا الكتاب");
        const freeBook = applyBookDiscount(book).price <= 0;
        const userEmail = getSessionEmail(req);
        if (!freeBook) {
            if (!userEmail) return res.status(401).send("يجب تسجيل الدخول أولًا");
            const purchase = await Purchase.findOne({ userEmail, bookId: req.params.bookId, status: "paid" });
            if (!purchase) return res.status(403).send("يجب شراء الكتاب أولًا");
        }
        if (/^data:application\/pdf;base64,/i.test(book.pdfFile)) {
            const pdfData = Buffer.from(book.pdfFile.split(",", 2)[1], "base64");
            res.setHeader("Content-Type", "application/pdf");
            if (req.query.download === "1") res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`${book.title}.pdf`)}`);
            return res.end(pdfData);
        }
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
        const phone = normalizePhone(req.body.phone);
        const pass = String(req.body.pass || "");
        if (!name || !isValidPhone(phone) || pass.length < 8) return res.status(400).send("الاسم ورقم هاتف من 11 رقمًا وكلمة مرور من 8 أحرف مطلوبة");

        const existingUser = await User.findOne({ phone });
        if (existingUser) return res.status(400).send("رقم الهاتف مستخدم بالفعل");

        const email = `${phone}@phone.rufuff.local`;
        await User.create({
            name,
            phone,
            email,
            pass: await bcrypt.hash(pass, 12),
            role: "user"
        });

        res.send("تم استلام البيانات بنجاح");
    } catch (error) {
        res.status(500).send("تعذر الاتصال بقاعدة البيانات");
    }
});

app.post("/login", async (req, res) => {
    try {
        const phone = normalizePhone(req.body.phone);
        const user = isValidPhone(phone)
            ? await User.findOne({ phone })
            : await User.findOne({ email: normalizeEmail(req.body.phone) });
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
        return res.status(401).send("رقم الهاتف أو كلمة المرور غير صحيحة");
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
            phone: normalizePhone(req.body.phone),
            photo: req.body.photo || req.body.avatar
        };
        if (!updates.name || !isValidPhone(updates.phone)) return res.status(400).send("الاسم ورقم هاتف من 11 رقمًا مطلوبان");
        if (req.body.pass) updates.pass = await bcrypt.hash(String(req.body.pass), 12);

        const user = await User.findOneAndUpdate(
            { $or: [{ email: userEmail }, { phone: userEmail }] },
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

app.delete("/api/me", requireUser, async (req, res) => {
    try {
        const email = req.currentUser.email;
        await Promise.all([
            User.deleteOne({ _id: req.currentUser._id }),
            Library.deleteOne({ userEmail: email }),
            Purchase.deleteMany({ userEmail: email }),
            Payment.deleteMany({ userEmail: email }),
            Comment.deleteMany({ userEmail: email })
        ]);
        clearSessionCookie(res);
        res.status(204).end();
    } catch {
        res.status(500).send("تعذر حذف الحساب");
    }
});

async function ensureDefaultAdminUser() {
    const configuredAdminEmail = normalizeEmail(process.env.ADMIN_EMAIL);
    const adminPassword = String(process.env.ADMIN_PASSWORD || "").trim();
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

const databaseState = globalThis.__rufuffDatabaseState || { promise: null };
globalThis.__rufuffDatabaseState = databaseState;

async function connectDatabase() {
    if (!databaseState.promise) {
        databaseState.promise = mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 5000,
            maxPoolSize: 10,
            minPoolSize: 0,
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
            await ensureDefaultCategories();
            await createBooksCollection();
        }).catch(error => {
            databaseState.promise = null;
            throw error;
        });
    }
    return databaseState.promise;
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

