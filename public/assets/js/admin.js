const message = document.getElementById("message");
const bookForm = document.getElementById("bookForm");

async function request(url, options) {
    const response = await fetch(url, { headers: { "Content-Type": "application/json" }, ...options });
    if (!response.ok) throw new Error(await response.text());
    return response.status === 204 ? null : response.json();
}

function showMessage(text, error = false) {
    message.textContent = text;
    message.style.color = error ? "#a33b30" : "#1f5a52";
}

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    }[character]));
}

function resetBookForm() {
    bookForm.reset();
    bookForm.elements.bookId.value = "";
    bookForm.elements.existingCover.value = "";
    bookForm.elements.existingFile.value = "";
    bookForm.elements.isComingSoon.checked = false;
    const title = bookForm.querySelector("h2");
    if (title) title.textContent = "إضافة كتاب";
    const submitButton = bookForm.querySelector("button");
    if (submitButton) submitButton.textContent = "حفظ الكتاب";
}

function fillBookForm(book) {
    bookForm.elements.bookId.value = book._id || "";
    bookForm.elements.existingCover.value = book.image || "";
    bookForm.elements.existingFile.value = book.pdfFile || "";
    bookForm.elements.title.value = book.title || "";
    bookForm.elements.author.value = book.author || "";
    bookForm.elements.price.value = book.price ?? "";
    bookForm.elements.pageCount.value = book.pageCount ?? "";
    bookForm.elements.discountPercent.value = book.discountPercent ?? 0;
    bookForm.elements.isComingSoon.checked = Boolean(book.isComingSoon);
    bookForm.elements.cover.value = book.image || "";
    bookForm.elements.file.value = book.pdfFile || "";
    bookForm.elements.description.value = book.description || "";
    const title = bookForm.querySelector("h2");
    if (title) title.textContent = "تعديل الكتاب";
    const submitButton = bookForm.querySelector("button");
    if (submitButton) submitButton.textContent = "تحديث الكتاب";
}

async function deleteResource(url, label) {
    if (!window.confirm(`هل تريد حذف ${label}؟`)) return;
    try {
        await request(url, { method: "DELETE" });
        showMessage(`تم حذف ${label}`);
        await loadDashboard();
    } catch (error) {
        showMessage(error.message || `تعذر حذف ${label}`, true);
    }
}

async function loadDashboard() {
    const [stats, orders, users, books, coupons] = await Promise.all([
        request("/api/admin/stats"),
        request("/api/admin/orders"),
        request("/api/admin/users"),
        request("/api/admin/books"),
        request("/api/admin/coupons")
    ]);
    window.adminBooks = books;
    document.getElementById("usersCount").textContent = stats.users;
    document.getElementById("booksCount").textContent = stats.books;
    document.getElementById("ordersCount").textContent = stats.orders;
    document.getElementById("revenue").textContent = `${stats.revenue} جنيه`;
    document.getElementById("orders").innerHTML = orders.slice(0, 20).map(order => `<tr><td>${escapeHtml(order.userId?.name || order.userId?.email || "-")}<br><small>${escapeHtml(order.userId?.email || "")}</small></td><td>${order.books.map(book => escapeHtml(book.title)).join("، ")}</td><td>${order.total} جنيه</td><td><code>${escapeHtml(order.kashierTransactionId || order.kashierOrderReference || "بانتظار Kashier")}</code></td><td>${order.paymentStatus === "paid" ? "تم الدفع وفتح الكتب" : order.paymentStatus === "failed" ? `فشل الدفع: ${escapeHtml(order.rejectionReason || "غير مكتمل")}` : "بانتظار تأكيد Kashier"}</td></tr>`).join("");
    document.getElementById("users").innerHTML = users.slice(0, 20).map(user => `<tr><td>${user.name}</td><td>${user.email}</td><td>${user.role}</td></tr>`).join("");
    document.getElementById("coupons").innerHTML = coupons.map(coupon => `<tr><td><strong>${escapeHtml(coupon.code)}</strong></td><td>${coupon.type === "percentage" ? "نسبة مئوية" : "مبلغ ثابت"}</td><td>${coupon.value}${coupon.type === "percentage" ? "%" : " جنيه"}</td><td>${coupon.minPurchase || 0} جنيه</td><td>${coupon.maxUses || "غير محدد"}</td><td><button class="delete-resource" data-url="/api/admin/coupons/${coupon._id}" data-label="الكوبون">حذف</button></td></tr>`).join("");
    document.getElementById("books").innerHTML = books.map(book => `<tr><td>${escapeHtml(book.title)}</td><td>${escapeHtml(book.author)}</td><td>${book.isComingSoon ? "قريبًا" : `${book.price} جنيه`}</td><td class="receipt-actions"><button type="button" class="edit-resource" data-book-id="${book._id}">تعديل</button><button type="button" class="delete-resource" data-url="/api/admin/books/${book._id}" data-label="الكتاب">حذف</button></td></tr>`).join("");
}

async function submitForm(form, url) {
    form.addEventListener("submit", async event => {
        event.preventDefault();
        try {
            const data = Object.fromEntries(new FormData(form));
            const isEdit = form.id === "bookForm" && Boolean(data.bookId);
            if (form.id === "bookForm") {
                const coverFile = data.coverFile;
                const pdfFile = data.fileUpload;
                data.category = "كتب";
                data.isComingSoon = Boolean(data.isComingSoon);
                if (coverFile?.size > 4 * 1024 * 1024) throw new Error("صورة الغلاف يجب ألا تتجاوز 4 ميجابايت");
                if (pdfFile?.size > 50 * 1024 * 1024) throw new Error("ملف PDF يجب ألا يتجاوز 50 ميجابايت");
                const existingCover = typeof data.existingCover === "string" ? data.existingCover.trim() : "";
                const existingFile = typeof data.existingFile === "string" ? data.existingFile.trim() : "";
                if (coverFile?.size || pdfFile?.size) {
                    const uploadData = new FormData();
                    if (coverFile?.size) uploadData.append("coverFile", coverFile);
                    if (pdfFile?.size) uploadData.append("fileUpload", pdfFile);
                    const uploadResponse = await fetch("/api/admin/uploads", { method: "POST", body: uploadData });
                    if (!uploadResponse.ok) throw new Error(await uploadResponse.text());
                    const uploaded = await uploadResponse.json();
                    data.cover = uploaded.cover || data.cover || existingCover;
                    data.file = uploaded.file || data.file || existingFile;
                } else {
                    data.cover = (typeof data.cover === "string" ? data.cover.trim() : "") || existingCover;
                    data.file = (typeof data.file === "string" ? data.file.trim() : "") || existingFile || null;
                }
                delete data.coverFile;
                delete data.fileUpload;
                delete data.existingCover;
                delete data.existingFile;
                if (!data.cover) throw new Error("اختر صورة الغلاف أو أدخل رابطها");
            }

            const requestUrl = form.id === "bookForm" && isEdit ? `${url}/${data.bookId}` : url;
            const requestMethod = form.id === "bookForm" && isEdit ? "PUT" : "POST";
            if (form.id === "bookForm") {
                delete data.bookId;
            }
            await request(requestUrl, { method: requestMethod, body: JSON.stringify(data) });
            resetBookForm();
            showMessage(isEdit ? "تم تحديث الكتاب بنجاح" : "تم الحفظ بنجاح");
            await loadDashboard();
        } catch (error) {
            showMessage(error.message || "تعذر الحفظ", true);
        }
    });
}

submitForm(document.getElementById("bookForm"), "/api/admin/books");
submitForm(document.getElementById("couponForm"), "/api/admin/coupons");
document.addEventListener("click", event => {
    const editButton = event.target.closest(".edit-resource");
    if (editButton) {
        const book = (window.adminBooks || []).find(item => String(item._id) === String(editButton.dataset.bookId));
        if (book) {
            fillBookForm(book);
            window.scrollTo({ top: 0, behavior: "smooth" });
        }
        return;
    }
    const deleteButton = event.target.closest(".delete-resource");
    if (deleteButton) deleteResource(deleteButton.dataset.url, deleteButton.dataset.label);
});

resetBookForm();
loadDashboard().catch(error => showMessage(error.message || "تعذر تحميل لوحة الإدارة", true));
window.setInterval(() => loadDashboard().catch(() => {}), 15000);
