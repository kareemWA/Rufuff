
const express = require("express");
const helmet = require("helmet");
const compression = require("compression");
const { rateLimit } = require("express-rate-limit");
const multer = require("multer");
require("dotenv").config();
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dns = require("dns");
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
const SUPABASE_URL = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
const SUPABASE_STORAGE_BUCKET = process.env.SUPABASE_STORAGE_BUCKET || "rufuff-books";
const SUPABASE_PUBLIC_URL = (process.env.SUPABASE_PUBLIC_URL || `${SUPABASE_URL}/storage/v1/object/public/${SUPABASE_STORAGE_BUCKET}`).replace(/\/$/, "");
const adminUpload = multer({
    storage: multer.memoryStorage(),
    limits: { files: 2, fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, callback) => {
        const validCover = file.fieldname === "coverFile" && /^image\/(png|jpe?g|webp|avif)$/i.test(file.mimetype);
        const validPdf = file.fieldname === "fileUpload" && /pdf|octet-stream|x-pdf/i.test(file.mimetype);
        callback(null, validCover || validPdf);
    }
});
const chatUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (req, file, callback) => callback(null, /^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype))
});
const configuredKashierPaymentUrl = process.env.KASHIER_PAYMENT_URL || "";
const KASHIER_PAYMENT_URL = configuredKashierPaymentUrl.includes("/v3/payment/sessions")
    ? configuredKashierPaymentUrl
    : "https://test-api.kashier.io/v3/payment/sessions";

if (process.env.DNS_SERVERS) {
    dns.setServers(process.env.DNS_SERVERS.split(",").map(server => server.trim()).filter(Boolean));
}

if (process.env.NODE_ENV === "production" && !process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is required in production");
}

if (process.env.NODE_ENV === "production" && (!SESSION_SECRET || SESSION_SECRET.length < 32)) {
    throw new Error("SESSION_SECRET must be at least 32 characters in production");
}

const bookSchema = new mongoose.Schema({
    title: { type: String, required: true, unique: true },
    author: { type: String, required: true },
    category: { type: String, required: true, trim: true, maxlength: 80 },
    price: { type: Number, required: true, min: 0 },
    pageCount: { type: Number, min: 1, max: 100000, default: null },
    originalPrice: { type: Number },
    discountPercent: { type: Number, min: 0, max: 90, default: DEFAULT_DISCOUNT_PERCENT },
    isComingSoon: { type: Boolean, default: false },
    seriesId: { type: mongoose.Schema.Types.ObjectId, ref: "Series", default: null },
    image: { type: String, required: true },
    description: { type: String, default: "كتاب رقمي مختار بعناية من رفوف." },
    pdfFile: { type: String, default: null },
    readCount: { type: Number, min: 0, default: 0 },
    deletedAt: { type: Date, default: null }
}, { timestamps: true });
bookSchema.index({ deletedAt: 1, createdAt: -1 });
bookSchema.index({ title: 1 });
bookSchema.index({ category: 1, deletedAt: 1, createdAt: -1 });

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
    kashierSessionId: { type: String, default: null, index: true },
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

    rating: { type: Number, min: 1, max: 5 },
    text: { type: String, default: "", trim: true, maxlength: 1000 },
    imageUrl: { type: String, default: null }
}, { timestamps: true });
commentSchema.index({ bookId: 1, createdAt: -1 });

const Comment = mongoose.model("Comment", commentSchema);

const chatMessageSchema = new mongoose.Schema({
    room: { type: String, enum: ["public", "founder"], required: true },
    conversationUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
    conversationEmail: { type: String, default: null },
    userEmail: { type: String, required: true },
    userName: { type: String, required: true },
    userAvatar: { type: String, default: null },
    text: { type: String, default: "", trim: true, maxlength: 1000 },
    imageUrl: { type: String, default: null }
}, { timestamps: true });
chatMessageSchema.index({ room: 1, createdAt: -1 });
chatMessageSchema.index({ room: 1, conversationUserId: 1, createdAt: -1 });
chatMessageSchema.index({ room: 1, conversationEmail: 1, createdAt: -1 });

const ChatMessage = mongoose.model("ChatMessage", chatMessageSchema);

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

function normalizeGoogleDrivePdfUrl(fileUrl) {
    if (!fileUrl || typeof fileUrl !== "string") return fileUrl;
    try {
        const parsed = new URL(fileUrl);
        const fileId = parsed.searchParams.get("id") || parsed.pathname.match(/\/file\/d\/([^/]+)/i)?.[1];
        if ((parsed.hostname === "drive.google.com" || parsed.hostname === "docs.google.com") && fileId) {
            return `https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileId)}`;
        }
    } catch {
        // Ignore invalid URLs and keep the original value.
    }
    return fileUrl;
}

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

function getKashierPaymentResult(data) {
    return data?.payment || data?.data?.payment || data?.data || data || {};
}

function getKashierStatus(data) {
    const result = getKashierPaymentResult(data);
    return String(result.status || result.paymentStatus || result.paymentState || data?.status || "").trim().toUpperCase();
}

function getKashierAmount(data) {
    const result = getKashierPaymentResult(data);
    return Number(result.amount ?? result.totalAmount ?? result.transactionAmount ?? data?.amount ?? data?.totalAmount);
}

function getKashierTransactionCode(data) {
    const result = getKashierPaymentResult(data);
    return String(result.transactionResponseCode || result.responseCode || data?.transactionResponseCode || data?.responseCode || "");
}

function isSuccessfulKashierPayment(data) {
    const status = getKashierStatus(data);
    return ["SUCCESS", "PAID", "CAPTURED", "COMPLETED", "APPROVED"].includes(status)
        || getKashierTransactionCode(data) === "00";
}

function getKashierTransactionId(data) {
    const result = getKashierPaymentResult(data);
    return result.transactionId || result.transaction?.id || data?.transactionId || null;
}

async function findBookSummaries(filter = {}, options = {}) {
    const skip = Math.max(0, Number(options.skip) || 0);
    const limit = Math.min(100, Math.max(1, Number(options.limit) || 100));
    return Book.aggregate([
        { $match: filter },
        { $sort: { createdAt: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $project: {
            title: 1,
            author: 1,
            category: 1,
            price: 1,
            pageCount: 1,
            originalPrice: 1,
            discountPercent: 1,
            isComingSoon: 1,
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
    try {
        let user;
        try {
            user = await getCurrentUser(req);
        } catch (error) {
            databaseState.promise = null;
            await mongoose.disconnect().catch(() => {});
            await connectDatabase();
            user = await getCurrentUser(req);
        }
        if (!user) return res.status(401).send("يجب تسجيل الدخول أولًا");
        req.currentUser = user;
        next();
    } catch (error) {
        console.error("Authenticated request database error:", error.message);
        res.status(503).send("قاعدة البيانات غير متاحة حاليًا. حاول مرة أخرى بعد قليل.");
    }
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
const sensitiveApiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "طلبات كثيرة جدًا لهذه العملية. حاول مرة أخرى بعد قليل."
});
const downloadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: "تم تجاوز حد التحميل المؤقت. حاول مرة أخرى بعد قليل."
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
app.get("/signin.html", (req, res) => {
    res.redirect("/index.html?auth=login");
});
app.get("/logIn.html", (req, res) => {
    res.redirect("/index.html?auth=signup");
});
app.get("/courses", (req, res) => {
    res.send("⭐⭐⭐⭐⭐ هذا السيرفر الجديد ⭐⭐⭐⭐⭐");
});

app.get("/api/me", requireUser, (req, res) => {
    res.json(publicUser(req.currentUser));
});

app.get("/api/chat/messages", requireUser, async (req, res) => {
    try {
        const room = req.query.room === "founder" ? "founder" : "public";
        const isAdmin = req.currentUser.role === "admin" || isConfiguredAdminEmail(req.currentUser.email);
        const filter = { room };
        if (room === "founder") {
            const rawConversationId = isAdmin && req.query.conversationId ? String(req.query.conversationId).trim() : String(req.currentUser._id);
            const conversationId = mongoose.Types.ObjectId.isValid(rawConversationId) ? rawConversationId : null;
            const conversationEmail = isAdmin && req.query.conversation ? normalizeEmail(req.query.conversation) : normalizeEmail(req.currentUser.email);
            const conversationMatches = [];
            if (conversationId) {
                conversationMatches.push({ conversationUserId: conversationId });
            }
            if (conversationEmail) {
                conversationMatches.push(
                    { conversationEmail, conversationUserId: null },
                    { conversationEmail: { $exists: false }, userEmail: conversationEmail }
                );
            }
            if (conversationMatches.length) {
                filter.$or = conversationMatches;
            }
        }
        let messages;
        try {
            messages = await ChatMessage.find(filter).sort({ createdAt: -1 }).limit(100).lean();
        } catch (error) {
            console.error("Chat messages sorted query error:", error);
            messages = await ChatMessage.find(filter).limit(100).lean();
        }
        res.json(messages.sort((first, second) => new Date(first.createdAt || 0) - new Date(second.createdAt || 0)).map(message => ({
            id: String(message._id),
            room: message.room,
            conversationUserId: message.conversationUserId ? String(message.conversationUserId) : null,
            conversationEmail: message.conversationEmail || message.userEmail,
            userName: message.userName,
            userAvatar: message.userAvatar || null,
            text: typeof message.text === "string" ? message.text : "",
            imageUrl: message.imageUrl || null,
            createdAt: message.createdAt || new Date(0),
            mine: normalizeEmail(message.userEmail) === normalizeEmail(req.currentUser.email)
        })));
    } catch (error) {
        console.error("Chat messages load error:", error);
        res.status(500).send("تعذر تحميل رسائل الدردشة");
    }
});

app.post("/api/chat/messages", requireUser, async (req, res) => {
    try {
        const room = req.body.room === "founder" ? "founder" : "public";
        const text = String(req.body.text || "").trim();
        const imageUrl = String(req.body.imageUrl || "").trim() || null;
        if ((!text && !imageUrl) || text.length > 1000) return res.status(400).send("اكتب رسالة أو اختر صورة");
        if (imageUrl && (!/^https:\/\//i.test(imageUrl) || !imageUrl.startsWith(`${SUPABASE_PUBLIC_URL}/`))) {
            return res.status(400).send("رابط الصورة غير صالح");
        }
        const isAdmin = req.currentUser.role === "admin" || isConfiguredAdminEmail(req.currentUser.email);
        let conversationUser = room === "founder" && isAdmin && mongoose.Types.ObjectId.isValid(req.body.recipientId)
            ? await User.findById(req.body.recipientId).select("_id email").lean()
            : req.currentUser;
        if (room === "founder" && isAdmin && !conversationUser && req.body.recipientEmail) {
            conversationUser = await User.findOne({ email: normalizeEmail(req.body.recipientEmail) }).select("_id email").lean();
        }
        if (room === "founder" && !conversationUser) return res.status(400).send("اختر محادثة لإرسال الرسالة");
        const conversationEmail = room === "founder" ? normalizeEmail(conversationUser.email) : null;
        const conversationUserId = room === "founder" ? conversationUser._id : null;
        const message = await ChatMessage.create({
            room,
            conversationUserId,
            conversationEmail,
            userEmail: normalizeEmail(req.currentUser.email),
            userName: req.currentUser.name,
            userAvatar: req.currentUser.photo || req.currentUser.avatar || null,
            text,
            imageUrl
        });
        res.status(201).json({
            id: String(message._id), room: message.room, conversationEmail: message.conversationEmail,
            conversationUserId: message.conversationUserId ? String(message.conversationUserId) : null,
            userName: message.userName,
            userAvatar: message.userAvatar || null,
            text: message.text, imageUrl: message.imageUrl || null, createdAt: message.createdAt, mine: true
        });
    } catch (error) {
        res.status(500).send("تعذر إرسال الرسالة");
    }
});

app.delete("/api/chat/messages/:messageId", requireUser, async (req, res) => {
    try {
        if (!mongoose.Types.ObjectId.isValid(req.params.messageId)) {
            return res.status(400).send("معرّف الرسالة غير صالح");
        }
        const message = await ChatMessage.findOneAndDelete({
            _id: req.params.messageId,
            userEmail: normalizeEmail(req.currentUser.email)
        }).lean();
        if (!message) return res.status(404).send("لا يمكنك حذف هذه الرسالة");
        if (message.imageUrl) await deleteFromObjectStorage(message.imageUrl).catch(() => {});
        res.status(204).end();
    } catch (error) {
        console.error("Chat message delete error:", error.message);
        res.status(500).send("تعذر حذف الرسالة");
    }
});

app.post("/api/chat/uploads", requireUser, (req, res, next) => {
    chatUpload.single("image")(req, res, error => {
        if (error) return res.status(400).send(error.code === "LIMIT_FILE_SIZE" ? "حجم الصورة يجب ألا يتجاوز 5 ميجابايت" : "اختر صورة بصيغة صحيحة");
        next();
    });
}, async (req, res) => {
    try {
        if (!req.file) return res.status(400).send("اختر صورة أولًا");
        const imageUrl = await uploadToObjectStorage(req.file, "chat");
        res.status(201).json({ imageUrl });
    } catch (error) {
        console.error("Chat image upload error:", error.message);
        res.status(503).send("تعذر رفع الصورة");
    }
});

app.get("/api/chat/conversations", requireAdmin, async (req, res) => {
    try {
        const messages = await ChatMessage.find({ room: "founder" }).sort({ createdAt: -1 }).lean();
        const conversations = new Map();
        messages.forEach(message => {
            const email = normalizeEmail(message.conversationEmail || message.userEmail);
            const id = message.conversationUserId ? String(message.conversationUserId) : email;
            if (!id || conversations.has(id)) return;
            conversations.set(id, { id, email, name: message.userName, lastMessage: message.text, createdAt: message.createdAt });
        });
        const emails = [...conversations.values()].map(conversation => conversation.email).filter(Boolean);
        const users = await User.find({ email: { $in: emails } }).select("email name photo").lean();
        const userByEmail = new Map(users.map(user => [user.email, user]));
        res.json([...conversations.values()].map(conversation => {
            const user = userByEmail.get(conversation.email);
            return { ...conversation, name: user?.name || conversation.name, avatar: user?.photo || null };
        }));
    } catch (error) {
        res.status(500).send("تعذر تحميل محادثات المؤسس");
    }
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
        const page = Math.max(1, Number(req.query.page) || 1);
        const limit = Math.min(40, Math.max(1, Number(req.query.limit) || 40));
        const search = String(req.query.search || "").trim();
        const category = String(req.query.category || "").trim();
        const filter = { deletedAt: null };
        if (category) filter.category = category;
        if (search) {
            const safeSearch = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
            filter.$or = [
                { title: { $regex: safeSearch, $options: "i" } },
                { author: { $regex: safeSearch, $options: "i" } },
                { category: { $regex: safeSearch, $options: "i" } }
            ];
        }
        const books = await findBookSummaries(filter, { skip: (page - 1) * limit, limit });
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

async function uploadToObjectStorage(file, folder) {
    const missingStorageSettings = [
        ["SUPABASE_URL", SUPABASE_URL],
        ["SUPABASE_SERVICE_ROLE_KEY", SUPABASE_SERVICE_ROLE_KEY],
        ["SUPABASE_STORAGE_BUCKET", SUPABASE_STORAGE_BUCKET]
    ].filter(([, value]) => !value).map(([name]) => name);
    if (missingStorageSettings.length) {
        throw new Error(`إعدادات Supabase Storage ناقصة: ${missingStorageSettings.join(", ")}`);
    }
    const safeMimeType = /pdf/i.test(file.mimetype) || /x-pdf|octet-stream/i.test(file.mimetype)
        ? "application/pdf"
        : file.mimetype;
    const extension = /pdf/i.test(safeMimeType)
        ? "pdf"
        : safeMimeType.split("/")[1]?.replace("jpeg", "jpg") || "bin";
    const key = `${folder}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
    const uploadUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}/${key.split("/").map(encodeURIComponent).join("/")}`;
    const response = await fetch(uploadUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": safeMimeType,
            "Cache-Control": "public, max-age=31536000, immutable",
            "x-upsert": "false"
        },
        body: file.buffer
    });
    if (!response.ok) throw new Error(`تعذر رفع الملف إلى Supabase Storage: ${await response.text()}`);
    return `${SUPABASE_PUBLIC_URL}/${key.split("/").map(encodeURIComponent).join("/")}`;
}

async function deleteFromObjectStorage(fileUrl) {
    if (!fileUrl || !SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return;
    const publicPrefix = `${SUPABASE_PUBLIC_URL}/`;
    if (!fileUrl.startsWith(publicPrefix)) return;
    const objectPath = fileUrl.slice(publicPrefix.length).split("?")[0]
        .split("/").map(part => decodeURIComponent(part)).join("/");
    if (!objectPath) return;
    const deleteUrl = `${SUPABASE_URL}/storage/v1/object/${encodeURIComponent(SUPABASE_STORAGE_BUCKET)}/remove`;
    const response = await fetch(deleteUrl, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
            apikey: SUPABASE_SERVICE_ROLE_KEY,
            "Content-Type": "application/json"
        },
        body: JSON.stringify({ prefixes: [objectPath] })
    });
    if (!response.ok) throw new Error(`تعذر حذف الملف من Supabase Storage: ${await response.text()}`);
}

app.post("/api/admin/uploads", requireAdmin, (req, res, next) => {
    adminUpload.fields([{ name: "coverFile", maxCount: 1 }, { name: "fileUpload", maxCount: 1 }])(req, res, error => {
        if (error) return res.status(400).send(error.code === "LIMIT_FILE_SIZE" ? "حجم الملف كبير جدًا" : "ملف غير صالح");
        next();
    });
}, async (req, res) => {
    try {
        const coverFile = req.files?.coverFile?.[0];
        const pdfFile = req.files?.fileUpload?.[0];
        if (!coverFile && !pdfFile) return res.status(400).send("اختر صورة الغلاف أو ملف PDF");
        const [cover, file] = await Promise.all([
            coverFile ? uploadToObjectStorage(coverFile, "covers") : null,
            pdfFile ? uploadToObjectStorage(pdfFile, "books") : null
        ]);
        res.status(201).json({ cover, file });
    } catch (error) {
        console.error("Supabase Storage upload error:", error.message);
        res.status(503).send(error.message || "تعذر رفع الملفات إلى Supabase Storage");
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
        const rawBookId = String(req.params.bookId || "").trim();
        if (!mongoose.Types.ObjectId.isValid(rawBookId)) {
            return res.status(400).send("معرّف الكتاب غير صالح");
        }

        const bookId = new mongoose.Types.ObjectId(rawBookId);
        const book = await Book.findOne({ _id: bookId }).select("image pdfFile").lean();
        if (!book) return res.status(404).send("الكتاب غير موجود أو محذوف بالفعل");

        await Promise.allSettled([
            deleteFromObjectStorage(book.image),
            deleteFromObjectStorage(book.pdfFile)
        ]);

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
        console.error("Delete book error:", error);
        res.status(500).send("تعذر حذف الكتاب");
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

app.put("/api/admin/books/:bookId", requireAdmin, async (req, res) => {
    try {
        const rawBookId = String(req.params.bookId || "").trim();
        if (!mongoose.Types.ObjectId.isValid(rawBookId)) {
            return res.status(400).send("معرّف الكتاب غير صالح");
        }

        const existingBook = await Book.findById(rawBookId);
        if (!existingBook) return res.status(404).send("الكتاب غير موجود");

        const { title, author, price, pageCount, discountPercent, cover, file, description, seriesId, isComingSoon } = req.body;
        const titleValue = String(title || "").trim();
        const authorValue = String(author || "").trim();
        const basePrice = Number(price);
        const normalizedPageCount = pageCount === "" || pageCount == null ? null : Number(pageCount);
        const discount = Math.min(90, Math.max(0, Number(discountPercent || 0)));
        const finalCover = typeof cover === "string" ? cover.trim() : existingBook.image;
        const finalFile = typeof file === "string" ? (file.trim() || null) : (file ?? existingBook.pdfFile ?? null);
        const comingSoonValue = isComingSoon === true || isComingSoon === "true" || isComingSoon === "on";

        if (!titleValue || !authorValue) return res.status(400).send("العنوان والمؤلف مطلوبان");
        if (!Number.isFinite(basePrice) || basePrice < 0) return res.status(400).send("السعر يجب أن يكون صفرًا أو أكبر");
        if (normalizedPageCount !== null && (!Number.isInteger(normalizedPageCount) || normalizedPageCount < 1 || normalizedPageCount > 100000)) return res.status(400).send("عدد الصفحات يجب أن يكون رقمًا صحيحًا بين 1 و100000");
        if (!Number.isFinite(discount)) return res.status(400).send("نسبة الخصم غير صحيحة");
        if (!finalCover || !/^https:\/\/[^"]+$/i.test(finalCover)) return res.status(400).send("رابط صورة الغلاف الخارجي عبر HTTPS مطلوب");
        if (finalFile && !/^https:\/\/[^"]+$/i.test(String(finalFile).trim())) return res.status(400).send("رابط ملف PDF خارجي عبر HTTPS مطلوب");

        const finalPrice = Math.round(basePrice * (100 - discount) / 100 * 100) / 100;

        if (seriesId && !await Series.exists({ _id: seriesId })) return res.status(404).send("السلسلة غير موجودة");

        existingBook.title = titleValue;
        existingBook.author = authorValue;
        existingBook.category = "كتب";
        existingBook.price = finalPrice;
        existingBook.pageCount = normalizedPageCount;
        existingBook.originalPrice = basePrice;
        existingBook.discountPercent = discount;
        existingBook.isComingSoon = comingSoonValue;
        existingBook.image = finalCover;
        existingBook.pdfFile = finalFile || null;
        existingBook.description = description || "كتاب رقمي مختار بعناية من رفوف.";
        existingBook.seriesId = seriesId || null;

        await existingBook.save();
        res.json(publicBook(existingBook.toObject()));
    } catch (error) {
        console.error("Update book error:", error);
        if (error?.code === 11000) return res.status(409).send("عنوان الكتاب موجود بالفعل");
        res.status(400).send(error.message || "تعذر تحديث الكتاب");
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
        const { title, author, price, pageCount, discountPercent, cover, file, description, seriesId, isComingSoon } = req.body;
        const normalizedCategory = "كتب";
        const basePrice = Number(price);
        const normalizedPageCount = pageCount === "" || pageCount == null ? null : Number(pageCount);
        const discount = Math.min(90, Math.max(0, Number(discountPercent || 0)));
        const comingSoonValue = isComingSoon === true || isComingSoon === "true" || isComingSoon === "on";
        if (!Number.isFinite(basePrice) || basePrice < 0) return res.status(400).send("السعر يجب أن يكون صفرًا أو أكبر");
        if (normalizedPageCount !== null && (!Number.isInteger(normalizedPageCount) || normalizedPageCount < 1 || normalizedPageCount > 100000)) return res.status(400).send("عدد الصفحات يجب أن يكون رقمًا صحيحًا بين 1 و100000");
        if (!Number.isFinite(discount)) return res.status(400).send("نسبة الخصم غير صحيحة");
        if (typeof cover !== "string" || !/^https:\/\/[^\s]+$/i.test(cover.trim())) return res.status(400).send("رابط صورة الغلاف الخارجي عبر HTTPS مطلوب");
        if (file && !/^https:\/\/[^\s]+$/i.test(String(file).trim())) return res.status(400).send("رابط ملف PDF خارجي عبر HTTPS مطلوب");
        const finalPrice = Math.round(basePrice * (100 - discount) / 100 * 100) / 100;
        const book = await Book.create({ title, author, category: normalizedCategory, price: finalPrice, pageCount: normalizedPageCount, originalPrice: basePrice, discountPercent: discount, isComingSoon: comingSoonValue, image: cover, pdfFile: file || null, description, seriesId: seriesId || null });
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
        const { text } = req.body;
        if (!userEmail) return res.status(401).send("يجب تسجيل الدخول أولًا");
        if (!text?.trim()) return res.status(400).send("اكتب التعليق أولًا");

        const user = await User.findOne({ email: userEmail }).lean();
        if (!user) return res.status(401).send("يجب تسجيل الدخول أولًا");

        const book = await Book.findById(req.params.bookId).lean();
        if (!book) return res.status(404).send("الكتاب غير موجود");

        const comment = await Comment.create({
            bookId: book._id,
            userEmail,
            userName: user.name,
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

app.post("/api/payments/create", sensitiveApiLimiter, async (req, res) => {
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
        payment.kashierSessionId = data.sessionId
            || data.id
            || data.data?.sessionId
            || data.data?.id
            || data.data?.session?.id
            || data.data?.session?.sessionId
            || paymentUrl.match(/\/session\/([^/?]+)/)?.[1]
            || null;
        payment.kashierOrderReference = data.orderReference || data.data?.orderReference || orderReference;
        await payment.save();
        res.status(201).json({ paymentUrl, paymentId: String(payment._id), bookIds: books.map(book => String(book._id)) });
    } catch (error) {
        const clientError = /السلة|غير موجود|كود الخصم|الحد الأدنى|موجود بالفعل|قيد المراجعة/.test(error.message);
        res.status(clientError ? 400 : 500).send(error.message || "تعذر إنشاء طلب الدفع");
    }
});

app.get("/api/payments/:paymentId/status", sensitiveApiLimiter, requireUser, async (req, res) => {
    try {
        const payment = await Payment.findOne({ _id: req.params.paymentId, userEmail: req.currentUser.email });
        if (!payment) return res.status(404).send("طلب الدفع غير موجود");
        if (payment.status === "pending" && payment.kashierSessionId && KASHIER_PAYMENT_URL.includes("/v3/payment/sessions")) {
            const verifyUrl = `${KASHIER_PAYMENT_URL}/${encodeURIComponent(payment.kashierSessionId)}/payment`;
            const response = await fetch(verifyUrl, {
                headers: {
                    Authorization: KASHIER_SECRET_KEY,
                    "api-key": KASHIER_API_KEY
                }
            });
            const responseText = await response.text();
            let data = {};
            try {
                data = responseText ? JSON.parse(responseText) : {};
            } catch {
                data = {};
            }
            const result = getKashierPaymentResult(data);
            const paymentStatus = getKashierStatus(data);
            const receivedAmount = getKashierAmount(data);
            const amountMatches = receivedAmount === payment.amountCents
                || receivedAmount === Number((payment.amountCents / 100).toFixed(2));
            if (response.ok && isSuccessfulKashierPayment(data) && amountMatches) {
                await completePayment(payment, getKashierTransactionId(data));
            } else if (response.ok && ["FAILURE", "FAILED", "DECLINED", "CANCELLED", "CANCELED"].includes(paymentStatus)) {
                payment.status = "failed";
                payment.rejectionReason = result.transactionResponseMessage?.en || result.message || "لم تكتمل عملية الدفع";
                await payment.save();
            }
        }
        res.json({
            id: String(payment._id),
            status: payment.status,
            rejectionReason: payment.rejectionReason,
            bookIds: payment.bookIds.map(bookId => String(bookId))
        });
    } catch (error) {
        res.status(500).send("تعذر التحقق من حالة الدفع");
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
        const paymentStatus = getKashierStatus(data);
        const receivedAmount = getKashierAmount(data);
        const amountMatches = receivedAmount === payment.amountCents || receivedAmount === Number((payment.amountCents / 100).toFixed(2));
        if (isSuccessfulKashierPayment(data) && amountMatches) {
            await completePayment(payment, getKashierTransactionId(data));
        } else if (paymentStatus && !isSuccessfulKashierPayment(data) && payment.status === "pending") {
            payment.status = "failed";
            payment.rejectionReason = data.transactionResponseMessage?.en || "لم تكتمل معاملة Kashier";
            await payment.save();
        }
        res.status(200).json({ received: true });
    } catch (error) {
        res.status(500).send("تعذر معالجة إشعار Kashier");
    }
});

app.post("/api/purchases/free", sensitiveApiLimiter, async (req, res) => {
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

app.get("/api/books/:bookId/access", downloadLimiter, async (req, res) => {
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
        if (!/^https:\/\//i.test(book.pdfFile)) return res.status(410).send("ملف الكتاب يجب أن يكون على تخزين خارجي آمن");

        const directPdfUrl = normalizeGoogleDrivePdfUrl(book.pdfFile);
        const pdfResponse = await fetch(directPdfUrl, { redirect: "follow" });
        if (!pdfResponse.ok) return res.status(502).send("تعذر تحميل ملف PDF من التخزين الخارجي");

        const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
        const filename = `${(book.title || "book").replace(/[^\w\s-]/g, "").trim() || "book"}.pdf`;
        const isDownload = req.query.download === "1";
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Length", String(pdfBuffer.length));
        res.setHeader("Content-Disposition", `${isDownload ? "attachment" : "inline"}; filename="${encodeURIComponent(filename)}"`);
        res.setHeader("Cache-Control", "private, max-age=0, must-revalidate");
        res.send(pdfBuffer);
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
        const user = await User.create({
            name,
            phone,
            email,
            pass: await bcrypt.hash(pass, 12),
            role: "user"
        });

        setSessionCookie(res, email);
        res.status(201).json(publicUser(user));
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
            Comment.deleteMany({ userEmail: email }),
            ChatMessage.deleteMany({ userEmail: email })
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
    if (mongoose.connection.readyState === 1) {
        try {
            await mongoose.connection.db.admin().ping({ maxTimeMS: 3000 });
            return mongoose.connection;
        } catch {
            databaseState.promise = null;
            await mongoose.disconnect().catch(() => {});
        }
    }

    if (mongoose.connection.readyState === 0) {
        databaseState.promise = null;
    }

    if (!databaseState.promise) {
        databaseState.promise = mongoose.connect(MONGODB_URI, {
            serverSelectionTimeoutMS: 10000,
            connectTimeoutMS: 10000,
            socketTimeoutMS: 10000,
            maxPoolSize: 10,
            minPoolSize: 0,
            maxIdleTimeMS: 30000
        }).then(() => {
            console.log("MongoDB connected: myapp");
            void Promise.allSettled([
                Payment.collection.dropIndex("paymobOrderId_1"),
                ensureDefaultAdminUser(),
                ensureDefaultCategories(),
                createBooksCollection()
            ]).then(results => {
                const failedTasks = results.filter(result => result.status === "rejected");
                if (failedTasks.length) console.error("Database maintenance failed:", failedTasks.map(result => result.reason?.message || result.reason));
            });
            return mongoose.connection;
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

