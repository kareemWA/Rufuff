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
const authModal = document.getElementById("authModal");
const authTabs = Array.from(document.querySelectorAll(".auth-tab"));
const authForms = Array.from(document.querySelectorAll(".auth-form"));
const authFormMessage = document.getElementById("authFormMessage");
const authLoginForm = document.getElementById("authLoginForm");
const authSignupForm = document.getElementById("authSignupForm");
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

function setAuthModalMode(mode) {
    if (!authModal) return;

    authTabs.forEach(tab => {
        const isActive = tab.dataset.authMode === mode;
        tab.classList.toggle("is-active", isActive);
        tab.setAttribute("aria-selected", String(isActive));
    });

    authForms.forEach(form => {
        const isActive = form.dataset.authForm === mode;
        form.classList.toggle("is-active", isActive);
    });

    const title = document.getElementById("authModalTitle");
    if (title) {
        title.textContent = mode === "signup" ? "إنشاء حساب" : "تسجيل الدخول";
    }
}

function showAuthModal(mode = "login") {
    if (!authModal) return;
    setAuthModalMode(mode);
    authModal.classList.remove("hidden");
    authModal.setAttribute("aria-hidden", "false");
    if (authFormMessage) {
        authFormMessage.textContent = "";
        authFormMessage.className = "auth-form-message";
    }
}

function hideAuthModal() {
    if (!authModal) return;
    authModal.classList.add("hidden");
    authModal.setAttribute("aria-hidden", "true");
}

function redirectGuest(event) {
    if (currentUser?.email) return false;
    event.preventDefault();
    event.stopPropagation();
    showAuthModal("login");
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
    logout.href = "#";
    logout.addEventListener("click", event => {
        if (!currentUser) {
            event.preventDefault();
            showAuthModal("login");
            return;
        }
        event.preventDefault();
        logoutUser();
    });
}

if (authModal) {
    authTabs.forEach(tab => {
        tab.addEventListener("click", () => setAuthModalMode(tab.dataset.authMode));
    });

    authModal.addEventListener("click", event => {
        if (event.target.closest("[data-close-auth-modal='true']") || event.target === authModal) {
            hideAuthModal();
        }
    });

    document.addEventListener("keydown", event => {
        if (event.key === "Escape" && !authModal.classList.contains("hidden")) {
            hideAuthModal();
        }
    });

    const closeButton = authModal.querySelector(".auth-modal-close");
    if (closeButton) {
        closeButton.addEventListener("click", hideAuthModal);
    }

    authLoginForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const phone = document.getElementById("authLoginPhone")?.value.replace(/\D/g, "") || "";
        const pass = document.getElementById("authLoginPassword")?.value || "";
        if (!/^\d{11}$/.test(phone) || !pass.trim()) {
            if (authFormMessage) {
                authFormMessage.textContent = "اكتب رقم هاتف صحيحًا من 11 رقمًا وكلمة المرور.";
                authFormMessage.className = "auth-form-message error";
            }
            return;
        }

        if (authFormMessage) {
            authFormMessage.textContent = "جارٍ تسجيل الدخول...";
            authFormMessage.className = "auth-form-message";
        }

        try {
            const response = await fetch("/login", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ phone, pass })
            });

            if (!response.ok) {
                throw new Error(await response.text());
            }

            const user = await response.json();
            localStorage.setItem("currentUser", JSON.stringify(user));
            hideAuthModal();
            window.location.reload();
        } catch (error) {
            if (authFormMessage) {
                authFormMessage.textContent = error.message || "تعذر تسجيل الدخول.";
                authFormMessage.className = "auth-form-message error";
            }
        }
    });

    authSignupForm?.addEventListener("submit", async event => {
        event.preventDefault();
        const name = document.getElementById("authSignupName")?.value.trim() || "";
        const phone = document.getElementById("authSignupPhone")?.value.replace(/\D/g, "") || "";
        const pass = document.getElementById("authSignupPassword")?.value || "";

        if (!name || !/^\d{11}$/.test(phone) || !pass.trim()) {
            if (authFormMessage) {
                authFormMessage.textContent = "اكتب الاسم ورقم هاتف صحيحًا من 11 رقمًا وكلمة المرور.";
                authFormMessage.className = "auth-form-message error";
            }
            return;
        }

        if (authFormMessage) {
            authFormMessage.textContent = "جارٍ إنشاء الحساب...";
            authFormMessage.className = "auth-form-message";
        }

        try {
            const response = await fetch("/register", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ name, phone, pass })
            });

            const data = response.ok ? await response.json() : await response.text();
            if (!response.ok) {
                throw new Error(data);
            }

            localStorage.setItem("currentUser", JSON.stringify(data));
            hideAuthModal();
            window.location.reload();
        } catch (error) {
            if (authFormMessage) {
                authFormMessage.textContent = error.message || "تعذر إنشاء الحساب.";
                authFormMessage.className = "auth-form-message error";
            }
        }
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
    const isComingSoon = Boolean(book.isComingSoon || book.comingSoon);
    article.className = `one_videos ${isComingSoon ? "is-coming-soon" : ""}`;
    article.dataset.category = "كتب";
    article.dataset.title = book.title;
    article.dataset.bookId = String(book._id || "");

    article.innerHTML = `
        <div class="book-cover-wrap">
            <button class="favorite-toggle" type="button" aria-label="إضافة ${book.title} للمفضلة">${favorites.some(item => item._id === book._id) ? "♥" : "♡"}</button>
            <img class="book-cover" src="${book.image}" alt="غلاف كتاب ${book.title}" loading="${index > 3 ? "lazy" : "eager"}">
        </div>
        <div class="book-info">
            <div class="book-top-bar">
                <span class="book-category">كتب</span>
                ${isComingSoon ? '<span class="book-pdf-tag coming-soon-tag">قريبًا</span>' : (book.hasPdf ?? Boolean(book.pdfFile)) ? '<span class="book-pdf-tag">كتاب PDF</span>' : ""}
            </div>
            <h3>${book.title}</h3>
            <p>${book.author}</p>
            <div class="book-meta-row">
                <div class="book-price-group">
                    ${isComingSoon
                        ? '<div class="price-box"><strong class="price">قريبًا</strong><span class="discount-badge">سيتوفر قريبًا</span></div>'
                        : `<div class="price-box"><strong class="price">${book.price} جنيه</strong><del>${book.originalPrice || book.price} جنيه</del><span class="discount-badge">خصم ${book.discountPercent || 0}%</span></div>`}
                </div>
                ${book.pageCount ? `<span class="book-pages" aria-label="عدد صفحات الكتاب">${book.pageCount}</span>` : ""}
            </div>
            <div class="book-actions-row">
                <a class="book-details-link" href="book-detail.html?id=${book._id}">التفاصيل</a>
            </div>
            <div class="book-footer">
                ${isComingSoon
                    ? '<button class="btn buy-book" type="button" disabled>قريبًا</button>'
                    : Number(book.price) <= 0 && (book.hasPdf ?? Boolean(book.pdfFile))
                        ? `<a class="btn buy-book" href="reader.html?id=${encodeURIComponent(book._id)}">اقرأ مجانًا</a>`
                        : '<button class="btn buy-book" type="button">أضف للسلة</button>'}
            </div>
            <p class="book-message" role="status" aria-live="polite"></p>
        </div>`;

    const buyControl = article.querySelector(".buy-book");
    if (!isComingSoon) {
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
    }

    article.querySelector(".book-details-link").addEventListener("click", redirectGuest);

    article.querySelector(".favorite-toggle").addEventListener("click", async event => {
        if (redirectGuest(event)) return;
        const favoriteButton = event.currentTarget;
        const isFavorite = favorites.some(item => item._id === book._id);
        favorites = isFavorite
            ? favorites.filter(item => item._id !== book._id)
            : [...favorites, book];
        favoriteButton.textContent = isFavorite ? "♡" : "♥";
        favoriteButton.classList.toggle("is-favorite", !isFavorite);
        favoriteButton.setAttribute("aria-label", isFavorite ? `إضافة ${book.title} للمفضلة` : `إزالة ${book.title} من المفضلة`);
        const message = article.querySelector(".book-message");
        message.textContent = isFavorite ? "تمت إزالة الكتاب من المفضلة." : "تمت إضافة الكتاب إلى المفضلة.";
        message.className = "book-message success";
        const saved = await window.accountLibrary.save(currentUser, cart, favorites);
        if (!saved) {
            favorites = isFavorite
                ? [...favorites, book]
                : favorites.filter(item => item._id !== book._id);
            favoriteButton.textContent = isFavorite ? "♥" : "♡";
            favoriteButton.classList.toggle("is-favorite", isFavorite);
            favoriteButton.setAttribute("aria-label", isFavorite ? `إزالة ${book.title} من المفضلة` : `إضافة ${book.title} للمفضلة`);
            message.textContent = "تعذر حفظ المفضلة. تحقق من اتصال الموقع.";
            message.className = "book-message error";
        }
    });

    if (favorites.some(item => item._id === book._id)) {
        article.querySelector(".favorite-toggle").classList.add("is-favorite");
    }

    return article;
}

function renderBooks() {
    const searchValue = (searchInput?.value || "").trim().toLowerCase();
    const visibleBooks = books.filter(book => {
        const matchesCategory = true;
        const matchesSearch = `${book.title} ${book.author}`.toLowerCase().includes(searchValue);
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
            .find(element => String(element.dataset.bookId || "") === String(book._id || ""));
        if (!card) return;

        const localRecord = localRecords[String(book._id)];
        const hasFreshPending = localRecord?.status === "pending" && (!localRecord.expiresAt || Number(localRecord.expiresAt) > Date.now());
        const isPurchased = purchaseState.purchasedIds.has(String(book._id));
        if (localRecord?.status === "failed") {
            const button = card.querySelector(".buy-book");
            const message = card.querySelector(".book-message");
            if (button) button.remove();
            message.textContent = "لم يكتمل الدفع";
            message.className = "book-message error";
            return;
        }

        if (hasFreshPending || localRecord?.status === "paid") {
            const button = card.querySelector(".buy-book");
            const message = card.querySelector(".book-message");
            if (button) button.remove();
            if (hasFreshPending) {
                message.textContent = "بانتظار الدفع";
                message.className = "book-message pending";
                const waitMs = Math.max(0, Number(localRecord.expiresAt || Date.now()) - Date.now());
                window.setTimeout(() => {
                    if (books.length) renderBooks();
                }, waitMs);
            } else {
                message.textContent = (book.hasPdf ?? Boolean(book.pdfFile)) ? "تم شراء الكتاب" : "تم الشراء، ملف PDF غير مرفوع بعد.";
                message.className = "book-message success";
            }
            return;
        }

        const button = card.querySelector(".buy-book");
        const message = card.querySelector(".book-message");
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
    categoriesList.innerHTML = '<button class="category active" data-category="all" type="button">كتب</button><a class="category chat-category-button" href="chat.html">💬 دردشة</a>';
    categoryButtons = [...categoriesList.querySelectorAll(".category")];
    categoryButtons.forEach(button => button.addEventListener("click", () => {
        categoryButtons.forEach(item => item.classList.remove("active"));
        button.classList.add("active");
        selectedCategory = "all";
        renderBooks();
    }));
}

async function loadCategories() {
    renderCategories([{ name: "كتب" }]);
}

if (searchInput) {
    searchInput.addEventListener("input", renderBooks);
}
window.addEventListener("paymentStateChanged", () => {
    if (books.length) {
        renderBooks();
    }
});

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
