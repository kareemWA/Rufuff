const title = document.getElementById("title");
const menuButton = document.getElementById("menuBtn");
const nav = document.querySelector(".list");
const navBottom = document.querySelector(".list_bottom");
const searchInput = document.getElementById("search_input");
const booksContainer = document.getElementById("books");
const booksStatus = document.getElementById("booksStatus");
const categoriesList = document.getElementById("categoriesList");
const cartButton = document.getElementById("cartButton");
const cartCount = document.getElementById("cartCount");
const logout = document.getElementById("logout");
const nameElement = document.getElementById("naMe");
const photo = document.getElementById("photo");

const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
const signupPage = "signin.html";
let selectedCategory = "all";
let cart = [];
let favorites = [];
let books = [];
let categoryButtons = [];
let purchaseState = null;
const booksCacheKey = "booksCache";
const categoriesCacheKey = "categoriesCache";
const localStorageMaxBytes = 200000;

function safeLocalStorageSet(key, value) {
    const serialized = JSON.stringify(value);
    if (serialized.length > localStorageMaxBytes) return false;
    try {
        localStorage.setItem(key, serialized);
        return true;
    } catch (error) {
        if (error?.name === "QuotaExceededError") {
            localStorage.removeItem(key);
            console.warn(`تعذر تخزين ${key} محليًا بسبب امتلاء مساحة المتصفح`);
            return false;
        }
        throw error;
    }
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
}

function markCurrentMenuItem() {
    const currentPage = window.location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".list a, .list_bottom a").forEach(element => {
        const target = (element.getAttribute("href") || "").split(/[?#]/)[0];
        const isCurrent = target && target === currentPage;
        element.classList.toggle("is-current", isCurrent);
        if (isCurrent) element.setAttribute("aria-current", "page");
    });
}

markCurrentMenuItem();

function sortBooksNewestFirst(items) {
    return [...items].sort((left, right) => {
        const leftDate = new Date(left.createdAt || 0).getTime();
        const rightDate = new Date(right.createdAt || 0).getTime();
        return rightDate - leftDate;
    });
}

function redirectGuest(event) {
    if (currentUser?.email) return false;
    event.preventDefault();
    event.stopPropagation();
    const returnUrl = `${window.location.pathname}${window.location.search}`;
    window.location.href = `${signupPage}?return=${encodeURIComponent(returnUrl)}`;
    return true;
}

async function refreshCurrentUserFromServer() {
    if (!currentUser?.email) return null;

    try {
        const response = await fetch("/api/me");
        if (!response.ok) return null;

        const serverUser = await response.json();
        if (!serverUser?.email) return null;

        localStorage.setItem("currentUser", JSON.stringify(serverUser));
        const updatedUser = JSON.parse(localStorage.getItem("currentUser") || "null");
        if (nameElement) nameElement.textContent = updatedUser?.name || "حسابي";
        if (photo && updatedUser?.avatar) photo.src = updatedUser.avatar;
        return updatedUser;
    } catch (error) {
        console.warn("تعذر تحديث بيانات الحساب من السيرفر", error);
        return null;
    }
}

if (currentUser && nameElement) {
    nameElement.textContent = currentUser.name || "حسابي";
    if (photo && currentUser.avatar) photo.src = currentUser.avatar;
}

if (logout) {
    logout.textContent = currentUser ? "تسجيل خروج" : "تسجيل الدخول";
    logout.href = currentUser ? "#" : "signin.html";
    logout.addEventListener("click", event => {
        if (!currentUser) return;
        event.preventDefault();
        logoutUser();
    });
}

if (photo) {
    photo.closest(".acc")?.addEventListener("click", redirectGuest);
}

async function logoutUser() {
    try {
        await fetch("/logout", { method: "POST" });
    } finally {
        if (window.accountLibrary?.clearUserData) {
            window.accountLibrary.clearUserData(currentUser.email);
        }
        localStorage.removeItem("currentUser");
        if (window.accountLibrary?.clearLegacyLocalData) {
            window.accountLibrary.clearLegacyLocalData();
        }
        window.location.reload();
    }
}

function createBookCard(book, index = 0) {
    const article = document.createElement("article");
    article.className = "one_videos";
    article.dataset.category = book.category;
    article.dataset.title = book.title;

    article.innerHTML = `
        <img class="book-cover" src="${book.image}" alt="غلاف كتاب ${book.title}" loading="${index > 3 ? "lazy" : "eager"}">
        <div class="book-info">
            <span class="book-category">${book.category}</span>
            <h3>${book.title}</h3>
            <p>${book.author}</p>
            <div class="price-box"><strong class="price">${book.price} جنيه</strong><del>${book.originalPrice || book.price} جنيه</del><span class="discount-badge">خصم ${book.discountPercent || 0}%</span></div>
            <div class="book-footer">
                ${Number(book.price) <= 0 && (book.hasPdf ?? Boolean(book.pdfFile))
                    ? `<a class="btn buy-book" href="reader.html?id=${encodeURIComponent(book._id)}">اقرأ مجانًا</a>`
                    : '<button class="btn buy-book" type="button">أضف للسلة</button>'}
            </div>
            <button class="favorite-toggle" type="button" aria-label="إضافة ${book.title} للمفضلة">${favorites.some(item => item._id === book._id) ? "♥" : "♡"}</button>
            <a class="book-details-link" href="book-detail.html?id=${book._id}">التفاصيل</a>
            <p class="book-message" role="status" aria-live="polite"></p>
        </div>`;

    const buyControl = article.querySelector(".buy-book");
    buyControl.addEventListener("click", event => {
        if (redirectGuest(event)) return;
        if (buyControl.tagName === "A") return;
        const message = article.querySelector(".book-message");
        if (!cart.some(item => item._id === book._id)) {
            cart.push(book);
            updateCart();
            message.textContent = "أُضيف الكتاب إلى السلة.";
            message.className = "book-message success";
        } else {
            message.textContent = "الكتاب موجود في السلة بالفعل.";
            message.className = "book-message";
        }
    });

    article.querySelector(".book-details-link").addEventListener("click", redirectGuest);

    article.querySelector(".favorite-toggle").addEventListener("click", async event => {
        if (redirectGuest(event)) return;
        const isFavorite = favorites.some(item => item._id === book._id);
        favorites = isFavorite
            ? favorites.filter(item => item._id !== book._id)
            : [...favorites, book];
        const saved = await window.accountLibrary.save(currentUser, cart, favorites);
        event.currentTarget.textContent = isFavorite ? "♡" : "♥";
        event.currentTarget.classList.toggle("is-favorite", !isFavorite);
        event.currentTarget.setAttribute("aria-label", isFavorite ? `إزالة ${book.title} من المفضلة` : `إضافة ${book.title} للمفضلة`);
        const message = article.querySelector(".book-message");
        message.textContent = saved
            ? (isFavorite ? "تمت إزالة الكتاب من المفضلة." : "تمت إضافة الكتاب إلى المفضلة.")
            : "تعذر حفظ المفضلة. تحقق من اتصال الموقع.";
        message.className = `book-message ${saved ? "success" : "error"}`;
    });

    if (favorites.some(item => item._id === book._id)) {
        article.querySelector(".favorite-toggle").classList.add("is-favorite");
    }

    return article;
}

function renderBooks() {
    const searchValue = (searchInput?.value || "").trim().toLowerCase();
    const visibleBooks = books.filter(book => {
        const matchesCategory = selectedCategory === "all" || book.category === selectedCategory;
        const matchesSearch = `${book.title} ${book.author} ${book.category}`.toLowerCase().includes(searchValue);
        return matchesCategory && matchesSearch;
    });

    booksContainer.querySelectorAll(".one_videos, .no").forEach(element => element.remove());
    visibleBooks.forEach((book, index) => booksContainer.appendChild(createBookCard(book, index)));
    refreshPurchasedBooks(visibleBooks);

    if (!visibleBooks.length) {
        const noResults = document.createElement("p");
        noResults.className = "no";
        noResults.textContent = books.length ? "لم نجد كتابًا بهذا الاسم." : "لا توجد كتب متاحة حاليًا.";
        booksContainer.appendChild(noResults);
    }
}

async function refreshPurchasedBooks(visibleBooks) {
    if (!currentUser) return;

    if (!purchaseState) {
        purchaseState = { purchasedIds: new Set(), pendingIds: new Set(), loading: null };
        purchaseState.loading = fetch("/api/purchases")
            .then(response => {
                if (!response.ok) throw new Error("تعذر تحميل حالة المشتريات");
                return response.json();
            })
            .then(data => {
                purchaseState.purchasedIds = new Set(data.purchasedIds || []);
                purchaseState.pendingIds = new Set(data.pendingIds || []);
            })
            .catch(() => {});
    }

    await purchaseState.loading;
    const localRecords = window.accountLibrary?.readPaymentState(currentUser)?.records || {};

    visibleBooks.forEach(book => {
        const card = [...booksContainer.querySelectorAll(".one_videos")]
            .find(element => element.dataset.title === book.title);
        if (!card) return;

        const localRecord = localRecords[String(book._id)];
        const isPending = purchaseState.pendingIds.has(String(book._id));
        const isPurchased = purchaseState.purchasedIds.has(String(book._id));
        if (localRecord?.status === "pending" || localRecord?.status === "paid") {
            const button = card.querySelector(".buy-book");
            const message = card.querySelector(".book-message");
            if (button) button.remove();
            if (localRecord.status === "pending") {
                message.textContent = "تم إرسال الإيصال، والكتاب بانتظار تأكيد الدفع.";
                message.className = "book-message pending";
            } else {
                message.textContent = (book.hasPdf ?? Boolean(book.pdfFile)) ? "تم شراء الكتاب" : "تم الشراء، ملف PDF غير مرفوع بعد.";
                message.className = "book-message success";
            }
        }

        const button = card.querySelector(".buy-book");
        const message = card.querySelector(".book-message");
        if (isPending) {
            if (button) button.remove();
            message.textContent = "تم إرسال الإيصال، والكتاب بانتظار تأكيد الدفع.";
            message.className = "book-message pending";
            return;
        }
        if (!isPurchased) return;

        if (isPurchased && localRecord?.status !== "paid") {
            window.accountLibrary.markPaymentRecord(currentUser, book, "paid");
        }

        if (button) button.remove();
        message.textContent = (book.hasPdf ?? Boolean(book.pdfFile)) ? "تم شراء الكتاب" : "تم الشراء، ملف PDF غير مرفوع بعد.";
        message.className = "book-message success";
        if (book.hasPdf ?? Boolean(book.pdfFile)) {
            const accessUrl = `/api/books/${encodeURIComponent(book._id)}/access`;
            const readerUrl = `reader.html?id=${encodeURIComponent(book._id)}`;
            message.innerHTML = `<a class="btn read-book-link" href="${readerUrl}">اقرأ الكتاب</a> <span aria-hidden="true">·</span> <a href="${accessUrl}?download=1" target="_blank" rel="noopener">تحميل PDF</a>`;
        }
    });
}

async function loadBooks() {
    const sharedBooks = window.accountLibrary?.getBooks?.();
    if (Array.isArray(sharedBooks) && sharedBooks.length) {
        books = sortBooksNewestFirst(sharedBooks);
        if (booksStatus) booksStatus.remove();
        renderBooks();
    }

    try {
        const response = await fetch("/api/books");
        if (!response.ok) throw new Error("تعذر تحميل الكتب");
        const freshBooks = sortBooksNewestFirst(await response.json());
        const currentSignature = books.map(book => `${book._id}:${book.updatedAt || ""}`).join("|");
        const freshSignature = freshBooks.map(book => `${book._id}:${book.updatedAt || ""}`).join("|");
        books = freshBooks;
        if (booksStatus) booksStatus.remove();
        if (currentSignature !== freshSignature) renderBooks();
        return books;
    } catch (error) {
        if (booksStatus) {
            booksStatus.textContent = "تعذر تحميل الكتب. تأكد أن السيرفر يعمل.";
            booksStatus.className = "no error";
        }
        return books;
    }
}

async function updateCart() {
    if (cartCount) cartCount.textContent = cart.length;
    if (currentUser?.email) {
        const saved = await window.accountLibrary.save(currentUser, cart, favorites);
        if (!saved) {
            const message = document.querySelector(".book-message");
            if (message) {
                message.textContent = "تعذر حفظ السلة. تحقق من اتصال الموقع.";
                message.className = "book-message error";
            }
        }
    }
}

function renderCategories(categories) {
    if (!categoriesList) return;
    categoriesList.innerHTML = `<button class="category active" data-category="all">الكل</button>${categories.map(category => `<button class="category" data-category="${escapeHtml(category.name)}">${escapeHtml(category.name)}</button>`).join("")}`;
    categoryButtons = [...categoriesList.querySelectorAll(".category")];
    categoryButtons.forEach(button => button.addEventListener("click", () => {
        categoryButtons.forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        selectedCategory = button.dataset.category;
        renderBooks();
    }));
}

async function loadCategories() {
    try {
        const cachedCategories = JSON.parse(localStorage.getItem(categoriesCacheKey) || "null");
        if (Array.isArray(cachedCategories) && cachedCategories.length) renderCategories(cachedCategories);
    } catch {
        localStorage.removeItem(categoriesCacheKey);
    }

    try {
        const response = await fetch("/api/categories");
        if (!response.ok) throw new Error("تعذر تحميل التصنيفات");
        const categories = await response.json();
        safeLocalStorageSet(categoriesCacheKey, categories);
        renderCategories(categories);
    } catch (error) {
        renderCategories([]);
    }
}

if (searchInput) searchInput.addEventListener("input", renderBooks);

function showPaymentToast(message, error = false) {
    const toast = document.createElement("div");
    toast.className = `payment-toast${error ? " error" : ""}`;
    toast.setAttribute("role", "status");
    toast.innerHTML = `<span></span><button type="button" aria-label="إغلاق">×</button>`;
    toast.querySelector("span").textContent = message;
    toast.querySelector("button").addEventListener("click", () => toast.remove());
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 9000);
}

async function checkPaymentConfirmation() {
    if (!currentUser?.email) return;
    const response = await fetch("/api/payments/mine");
    if (!response.ok) return;
    const payments = await response.json();
    const statuses = Object.fromEntries(payments.map(payment => [payment.id, payment.status]));
    const previous = JSON.parse(localStorage.getItem("paymentStatuses") || "{}");
    const changedPayment = payments.find(payment => previous[payment.id] === "pending" && ["paid", "failed"].includes(payment.status));
    if (changedPayment?.status === "paid") showPaymentToast("تم تأكيد دفع الكتب. أصبحت كتبك متاحة الآن.");
    if (changedPayment?.status === "failed") showPaymentToast(`تم رفض الدفع. السبب: ${changedPayment.rejectionReason || "الإيصال غير صحيح أو لم يتم تحويل المبلغ المحدد"}`, true);
    safeLocalStorageSet("paymentStatuses", statuses);
}

checkPaymentConfirmation().catch(() => {});
window.setInterval(() => checkPaymentConfirmation().catch(() => {}), 15000);

if (cartButton) {
    cartButton.addEventListener("click", () => { window.location.href = "cart.html"; });
}

const favoriteLink = document.getElementById("favorite");
if (favoriteLink) favoriteLink.href = "favorites.html";

function closeMenu() {
    if (!nav || !navBottom) return;
    nav.classList.remove("show");
    navBottom.classList.remove("show");
    document.body.classList.remove("menu-open");
    menuButton?.setAttribute("aria-expanded", "false");
    menuButton?.setAttribute("aria-label", "فتح القائمة");
}

if (menuButton && nav && navBottom) {
    menuButton.setAttribute("aria-expanded", "false");
    menuButton.addEventListener("click", () => {
        const isOpen = nav.classList.toggle("show");
        navBottom.classList.toggle("show", isOpen);
        document.body.classList.toggle("menu-open", isOpen);
        menuButton.setAttribute("aria-expanded", String(isOpen));
        menuButton.setAttribute("aria-label", isOpen ? "إغلاق القائمة" : "فتح القائمة");
    });

    document.addEventListener("click", event => {
        const clickedInsideMenu = nav.contains(event.target) || navBottom.contains(event.target) || menuButton.contains(event.target);
        if (!clickedInsideMenu) closeMenu();
    });
}

document.querySelectorAll(".list a, .list_bottom a, .book-details-link, #cartButton").forEach(element => {
    element.addEventListener("click", redirectGuest);
});

if (title) title.addEventListener("click", () => window.location.reload());

async function initializeStore() {
    refreshCurrentUserFromServer().catch(() => {});
    loadCategories();
    const booksPromise = loadBooks();
    window.accountLibrary.load(currentUser, booksPromise).then(async library => {
        cart = library.cart;
        favorites = library.favorites;
        await updateCart();
        renderBooks();
    });
}

initializeStore();
