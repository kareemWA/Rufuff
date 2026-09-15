const detailStatus = document.getElementById("detailStatus");
const bookDetail = document.getElementById("bookDetail");
const detailImage = document.getElementById("detailImage");
const detailCategory = document.getElementById("detailCategory");
const detailTitle = document.getElementById("detailTitle");
const detailAuthor = document.getElementById("detailAuthor");
const detailDescription = document.getElementById("detailDescription");
const detailPrice = document.getElementById("detailPrice");
const detailOriginalPrice = document.getElementById("detailOriginalPrice");
const detailDiscount = document.getElementById("detailDiscount");
const detailRating = document.getElementById("detailRating");
const detailReadCount = document.getElementById("detailReadCount");
const reviewsSummary = document.getElementById("reviewsSummary");
const commentsList = document.getElementById("commentsList");
const commentForm = document.getElementById("commentForm");
const commentMessage = document.getElementById("commentMessage");
const buyButton = document.getElementById("buyButton");
const purchaseMessage = document.getElementById("purchaseMessage");
const favoriteButton = document.getElementById("favoriteButton");
const downloadButton = document.getElementById("downloadButton");
const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
const signupPage = "signin.html";
const bookId = new URLSearchParams(window.location.search).get("id");
let book;
let purchased = false;
let pending = false;
let accessUrl = "";
let cart = [];
let favorites = [];
const bookCacheKey = `book:${bookId}`;
const commentsCacheKey = `book-comments:${bookId}`;
const bookCacheTtl = 5 * 60 * 1000;
const commentsCacheTtl = 15 * 1000;

function redirectGuest(event) {
    if (currentUser?.email) return false;
    event.preventDefault();
    event.stopPropagation();
    const returnUrl = `${window.location.pathname}${window.location.search}`;
    window.location.href = `${signupPage}?return=${encodeURIComponent(returnUrl)}`;
    return true;
}

function setText(element, value) {
    element.textContent = value || "";
}

function renderComments(comments, averageRating) {
    const count = comments.length;
    setText(reviewsSummary, count ? `${averageRating} من 5 · ${count} تقييم` : "لا توجد تقييمات بعد");
    commentsList.innerHTML = "";

    if (!count) {
        commentsList.innerHTML = '<p class="empty-comments">كن أول من يشارك رأيه في هذا الكتاب.</p>';
        return;
    }

    comments.forEach(comment => {
        const article = document.createElement("article");
        article.className = "comment-item";

        const header = document.createElement("div");
        header.className = "comment-header";
        const name = document.createElement("strong");
        name.textContent = comment.userName;
        const rating = document.createElement("span");
        rating.className = "comment-rating";
        rating.textContent = `${"★".repeat(comment.rating)}${"☆".repeat(5 - comment.rating)}`;
        header.append(name, rating);

        const text = document.createElement("p");
        text.textContent = comment.text;
        article.append(header, text);
        commentsList.appendChild(article);
    });
}

function renderBook(data) {
    book = data;
    detailImage.src = data.image;
    detailImage.alt = `غلاف كتاب ${data.title}`;
    setText(detailCategory, data.category);
    setText(detailTitle, data.title);
    setText(detailAuthor, data.author);
    setText(detailDescription, data.description);
    setText(detailPrice, `${data.price} جنيه`);
    setText(detailOriginalPrice, `${data.originalPrice || data.price} جنيه`);
    setText(detailDiscount, `خصم ${data.discountPercent || 0}%`);
    setText(detailRating, data.reviewsCount ? `★ ${data.averageRating}` : "☆ لا توجد تقييمات");
    setText(detailReadCount, `${data.readCount || 0} قراءة`);
    document.title = `${data.title} | رفوف`;
    updateFavoriteButton();
    bookDetail.hidden = false;
    detailStatus.hidden = true;
}

function updateFavoriteButton() {
    const isFavorite = favorites.some(item => item._id === book._id);
    favoriteButton.textContent = isFavorite ? "♥ في المفضلة" : "♡ إضافة للمفضلة";
    favoriteButton.classList.toggle("is-favorite", isFavorite);
}

function updatePurchaseButton() {
    const isFree = Number(book?.price) <= 0 && (book?.hasPdf ?? Boolean(book?.pdfFile));
    buyButton.textContent = isFree ? "اقرأ مجانًا" : purchased ? "قراءة الكتاب" : pending ? "بانتظار تأكيد الدفع" : "أضف للسلة";
    buyButton.classList.toggle("is-purchased", purchased);
    buyButton.disabled = pending;
    downloadButton.hidden = !purchased;
    if (purchased) downloadButton.href = `${accessUrl}?download=1`;
}

favoriteButton.addEventListener("click", async event => {
    if (redirectGuest(event)) return;
    const isFavorite = favorites.some(item => item._id === book._id);
    favorites = isFavorite
        ? favorites.filter(item => item._id !== book._id)
        : [...favorites, book];
    const saved = await window.accountLibrary.save(currentUser, cart, favorites);
    updateFavoriteButton();
    purchaseMessage.textContent = saved
        ? (isFavorite ? "تمت إزالة الكتاب من المفضلة." : "تمت إضافة الكتاب إلى المفضلة.")
        : "تعذر حفظ المفضلة. تحقق من اتصال الموقع.";
    purchaseMessage.className = `book-message ${saved ? "success" : "error"}`;
});

async function loadBook() {
    if (!bookId) throw new Error("رابط الكتاب غير صحيح");
    let cachedBook = null;
    try {
        const cached = JSON.parse(localStorage.getItem(bookCacheKey) || "null");
        if (cached?.book && Date.now() - cached.cachedAt < bookCacheTtl) cachedBook = cached.book;
    } catch {
        localStorage.removeItem(bookCacheKey);
    }

    const bookResponse = fetch(`/api/books/${encodeURIComponent(bookId)}`)
        .then(response => {
            if (!response.ok) throw new Error("تعذر تحميل تفاصيل الكتاب");
            return response.json();
        });
    if (cachedBook) renderBook(cachedBook);
    const freshBook = await bookResponse;
    localStorage.setItem(bookCacheKey, JSON.stringify({ cachedAt: Date.now(), book: freshBook }));
    renderBook(freshBook);

    loadComments();
    fetch(`/api/purchases/${encodeURIComponent(bookId)}`)
        .then(response => response.ok ? response.json() : null)
        .then(purchase => {
            if (!purchase) return;
            purchased = purchase.purchased;
            pending = purchase.pending;
            accessUrl = purchase.accessUrl;
            updatePurchaseButton();
        })
        .catch(() => {});
    return freshBook;
}

async function loadComments(force = false) {
    if (!bookId) return;
    if (!force) {
        try {
            const cached = JSON.parse(localStorage.getItem(commentsCacheKey) || "null");
            if (cached?.data && Date.now() - cached.cachedAt < commentsCacheTtl) {
                renderComments(cached.data.comments, cached.data.averageRating);
            }
        } catch {
            localStorage.removeItem(commentsCacheKey);
        }
    }

    const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/comments`);
    if (!response.ok) return;
    const data = await response.json();
    localStorage.setItem(commentsCacheKey, JSON.stringify({ cachedAt: Date.now(), data }));
    renderComments(data.comments, data.averageRating);
}

buyButton.addEventListener("click", async event => {
    const isFree = Number(book?.price) <= 0 && (book?.hasPdf ?? Boolean(book?.pdfFile));
    if (redirectGuest(event)) return;
    if (isFree) {
        window.location.href = `reader.html?id=${encodeURIComponent(book._id)}`;
        return;
    }
    if (purchased) {
        window.location.href = `reader.html?id=${encodeURIComponent(book._id)}`;
        return;
    }
    if (pending) return;
    if (!cart.some(item => item._id === book._id)) cart.push(book);
    const saved = await window.accountLibrary.save(currentUser, cart, favorites);
    purchaseMessage.textContent = saved ? "أُضيف الكتاب إلى السلة." : "تعذر حفظ السلة. تحقق من اتصال الموقع.";
    purchaseMessage.className = `book-message ${saved ? "success" : "error"}`;
});

commentForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (!currentUser?.email) {
        commentMessage.textContent = "سجل الدخول أولًا لإضافة تقييم.";
        commentMessage.className = "form-message error";
        return;
    }

    const rating = document.getElementById("rating").value;
    const text = document.getElementById("commentText").value.trim();
    const submitButton = commentForm.querySelector("button[type=submit]");
    submitButton.disabled = true;
    commentMessage.textContent = "جارٍ نشر التقييم...";
    try {
        const response = await fetch(`/api/books/${encodeURIComponent(bookId)}/comments`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userEmail: currentUser.email, rating, text })
        });
        if (!response.ok) throw new Error(await response.text());
        commentForm.reset();
        commentMessage.textContent = "تم نشر تقييمك بنجاح.";
        commentMessage.className = "form-message success";
        await loadComments(true);
    } catch (error) {
        commentMessage.textContent = error.message || "تعذر نشر التقييم.";
        commentMessage.className = "form-message error";
    } finally {
        submitButton.disabled = false;
    }
});

async function initializeBookDetails() {
    const bookPromise = loadBook().catch(error => {
        detailStatus.textContent = error.message || "تعذر تحميل تفاصيل الكتاب.";
        detailStatus.className = "detail-status error";
        throw error;
    });
    window.accountLibrary.load(currentUser, bookPromise).then(library => {
        cart = library.cart;
        favorites = library.favorites;
        if (book) updateFavoriteButton();
    }).catch(() => {});
}

initializeBookDetails().catch(error => {
    detailStatus.textContent = error.message || "تعذر تحميل تفاصيل الكتاب.";
    detailStatus.className = "detail-status error";
});
