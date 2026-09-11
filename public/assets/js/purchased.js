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

function renderPendingBook(book) {
    const article = document.createElement("article");
    article.className = "purchased-card";
    article.innerHTML = `
        <img class="purchased-cover" src="${book.image}" alt="غلاف كتاب ${book.title}">
        <div class="purchased-card-info">
            <span class="book-category">قيد المراجعة</span>
            <h2>${book.title}</h2>
            <p>${book.author}</p>
            <p class="book-message pending">تم استلام الإيصال. سيظهر الكتاب هنا فور تأكيد الدفع.</p>
        </div>`;
    purchasedBooks.appendChild(article);
}

function showPaymentToast() {
    const toast = document.createElement("div");
    toast.className = "payment-toast";
    toast.setAttribute("role", "status");
    toast.innerHTML = `<span>تم تأكيد دفع الكتب. أصبحت كتبك متاحة الآن.</span><button type="button" aria-label="إغلاق">×</button>`;
    toast.querySelector("button").addEventListener("click", () => toast.remove());
    document.body.appendChild(toast);
    window.setTimeout(() => toast.remove(), 9000);
}

async function loadPurchasedBooks(notify = false) {
    if (!currentUser?.email) {
        purchasedStatus.hidden = true;
        showEmpty("سجل الدخول لرؤية كتبك", "تسجيل الدخول", "logIn.html?return=/purchased.html");
        return;
    }

    try {
        const paymentsResponse = await fetch("/api/payments/mine");
        const payments = paymentsResponse.ok ? await paymentsResponse.json() : [];
        const paymentStatuses = Object.fromEntries(payments.map(payment => [payment.id, payment.status]));
        const previousStatuses = JSON.parse(localStorage.getItem("paymentStatuses") || "{}");
        if (notify && Object.entries(paymentStatuses).some(([id, status]) => status === "paid" && previousStatuses[id] === "pending")) {
            showPaymentToast();
        }
        localStorage.setItem("paymentStatuses", JSON.stringify(paymentStatuses));
        const response = await fetch("/api/books");
        if (!response.ok) throw new Error("تعذر تحميل الكتب");
        const books = await response.json();
        purchasedBooks.innerHTML = "";
        const checks = await Promise.all(books.map(async book => {
            const purchaseResponse = await fetch(`/api/purchases/${book._id}?email=${encodeURIComponent(currentUser.email)}`);
            if (!purchaseResponse.ok) return null;
            const purchase = await purchaseResponse.json();
            return purchase.purchased ? { book, purchase } : null;
        }));
        const ownedBooks = checks.filter(Boolean);
        const latestPayment = payments[0];
        const pendingBookIds = new Set(
            payments.filter(payment => payment.status === "pending")
                .flatMap(payment => payment.bookIds || [])
                .map(String)
        );
        const ownedBookIds = new Set(ownedBooks.map(({ book }) => String(book._id)));
        const pendingBooks = books.filter(book => pendingBookIds.has(String(book._id)) && !ownedBookIds.has(String(book._id)));
        purchasedStatus.hidden = false;
        purchasedSummary.textContent = `${ownedBooks.length + pendingBooks.length} ${ownedBooks.length + pendingBooks.length === 1 ? "كتاب" : "كتب"}`;
        if (!ownedBooks.length && !pendingBooks.length) {
            if (latestPayment?.status === "pending") {
                purchasedStatus.textContent = "طلبك قيد المراجعة. سيتم فتح الكتاب خلال نصف ساعة إلى ساعة، وللتأخير تواصل مع الدعم على 01016355675.";
            }
            showEmpty("لم تشترِ أي كتاب بعد", "اكتشف الكتب", "index.html");
            return;
        }
        pendingBooks.forEach(renderPendingBook);
        ownedBooks.forEach(({ book, purchase }) => renderBook(book, purchase));
        if (latestPayment?.status === "paid") {
            purchasedStatus.textContent = "ألف مبروك يا بشمهندس، تم تأكيد الدفع وفتح الكتاب لك.";
            purchasedStatus.className = "detail-status success";
        } else if (latestPayment?.status === "pending") {
            purchasedStatus.textContent = "بعض الكتب قيد مراجعة الدفع. ستظهر تلقائيًا بعد التأكيد.";
            purchasedStatus.className = "detail-status";
        } else {
            purchasedStatus.hidden = true;
        }
    } catch (error) {
        purchasedStatus.textContent = error.message || "تعذر تحميل كتبك المشتراة.";
        purchasedStatus.className = "detail-status error";
    }
}

loadPurchasedBooks();
window.setInterval(() => loadPurchasedBooks(true), 15000);
