const purchasedStatus = document.getElementById("purchasedStatus");
const purchasedBooks = document.getElementById("purchasedBooks");
const purchasedSummary = document.getElementById("purchasedSummary");
const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");

function showEmpty(message, linkText, linkHref) {
    purchasedBooks.innerHTML = `
        <div class="cart-empty">
            <strong>${message}</strong>
            <p>ستظهر الكتب التي تشتريها هنا.</p>
            <a class="btn" href="${linkHref}">${linkText}</a>
        </div>`;
}

function renderBook(book, purchase) {
    const article = document.createElement("article");
    article.className = "purchased-card";
    const accessUrl = `${purchase.accessUrl}?email=${encodeURIComponent(currentUser.email)}`;
    article.innerHTML = `
        <img class="purchased-cover" src="${book.image}" alt="غلاف كتاب ${book.title}">
        <div class="purchased-card-info">
            <span class="book-category">${book.category}</span>
            <h2>${book.title}</h2>
            <p>${book.author}</p>
            ${book.pdfFile
                ? `<div class="purchased-actions"><a class="btn" href="${accessUrl}" target="_blank">اقرأ الكتاب</a><a class="download-link" href="${accessUrl}&download=1" target="_blank">تحميل PDF</a></div>`
                : '<p class="book-message">ملف القراءة غير مرفوع حاليًا.</p>'}
        </div>`;
    purchasedBooks.appendChild(article);
}

async function loadPurchasedBooks() {
    if (!currentUser?.email) {
        purchasedStatus.hidden = true;
        showEmpty("سجل الدخول لرؤية كتبك", "تسجيل الدخول", "logIn.html?return=/purchased.html");
        return;
    }

    try {
        const response = await fetch("/api/books");
        if (!response.ok) throw new Error("تعذر تحميل الكتب");
        const books = await response.json();
        const checks = await Promise.all(books.map(async book => {
            const purchaseResponse = await fetch(`/api/purchases/${book._id}?email=${encodeURIComponent(currentUser.email)}`);
            if (!purchaseResponse.ok) return null;
            const purchase = await purchaseResponse.json();
            return purchase.purchased ? { book, purchase } : null;
        }));
        const ownedBooks = checks.filter(Boolean);
        purchasedStatus.hidden = true;
        purchasedSummary.textContent = `${ownedBooks.length} ${ownedBooks.length === 1 ? "كتاب" : "كتب"}`;
        if (!ownedBooks.length) {
            showEmpty("لم تشترِ أي كتاب بعد", "اكتشف الكتب", "index.html");
            return;
        }
        ownedBooks.forEach(({ book, purchase }) => renderBook(book, purchase));
    } catch (error) {
        purchasedStatus.textContent = error.message || "تعذر تحميل كتبك المشتراة.";
        purchasedStatus.className = "detail-status error";
    }
}

loadPurchasedBooks();
