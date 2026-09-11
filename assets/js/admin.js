const message = document.getElementById("message");

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
    const [stats, orders, users, books, series] = await Promise.all([
        request("/api/admin/stats"),
        request("/api/admin/orders"),
        request("/api/admin/users"),
        request("/api/admin/books"),
        request("/api/admin/series")
    ]);
    document.getElementById("usersCount").textContent = stats.users;
    document.getElementById("booksCount").textContent = stats.books;
    document.getElementById("ordersCount").textContent = stats.orders;
    document.getElementById("revenue").textContent = `${stats.revenue} جنيه`;
    document.getElementById("orders").innerHTML = orders.slice(0, 20).map(order => `<tr><td>${escapeHtml(order.userId?.name || order.userId?.email || "-")}<br><small>${escapeHtml(order.userId?.email || "")}</small></td><td>${order.books.map(book => escapeHtml(book.title)).join("، ")}</td><td>${order.total} جنيه</td><td><div class="receipt-actions"><img class="receipt-thumb" src="${escapeHtml(order.receiptImage)}" alt="إيصال التحويل"><button class="view-receipt" type="button" data-receipt="${escapeHtml(order.receiptImage)}">عرض</button></div></td><td>${order.paymentStatus === "paid" ? "تم التأكيد" : order.paymentStatus === "failed" ? `مرفوض: ${escapeHtml(order.rejectionReason || "غير صحيح")}` : "قيد المراجعة"}</td><td>${order.paymentStatus === "pending" ? `<div class="payment-actions"><button class="confirm-payment" data-id="${order._id}">تأكيد الدفع</button><button class="reject-payment" data-id="${order._id}">رفض الدفع</button></div>` : "-"}</td></tr>`).join("");
    document.getElementById("users").innerHTML = users.slice(0, 20).map(user => `<tr><td>${user.name}</td><td>${user.email}</td><td>${user.role}</td></tr>`).join("");
    document.getElementById("books").innerHTML = books.map(book => `<tr><td>${escapeHtml(book.title)}</td><td>${escapeHtml(book.author)}</td><td>${book.price} جنيه</td><td><button class="delete-resource" data-url="/api/admin/books/${book._id}" data-label="الكتاب">حذف</button></td></tr>`).join("");
    document.getElementById("series").innerHTML = series.map(item => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.description || "-")}</td><td><button class="delete-resource" data-url="/api/admin/series/${item._id}" data-label="السلسلة">حذف</button></td></tr>`).join("");
}

async function submitForm(form, url) {
    form.addEventListener("submit", async event => {
        event.preventDefault();
        try {
            const data = Object.fromEntries(new FormData(form));
            await request(url, { method: "POST", body: JSON.stringify(data) });
            form.reset();
            showMessage("تم الحفظ بنجاح");
            await loadDashboard();
        } catch (error) {
            showMessage(error.message || "تعذر الحفظ", true);
        }
    });
}

submitForm(document.getElementById("bookForm"), "/api/admin/books");
submitForm(document.getElementById("seriesForm"), "/api/admin/series");
submitForm(document.getElementById("couponForm"), "/api/admin/coupons");
document.addEventListener("click", event => {
    const button = event.target.closest(".delete-resource");
    if (button) deleteResource(button.dataset.url, button.dataset.label);
    const confirmButton = event.target.closest(".confirm-payment");
    if (confirmButton) confirmPayment(confirmButton);
    const rejectButton = event.target.closest(".reject-payment");
    if (rejectButton) rejectPayment(rejectButton);
    const receiptButton = event.target.closest(".view-receipt");
    if (receiptButton) window.open(receiptButton.dataset.receipt, "_blank", "noopener,noreferrer");
});

async function confirmPayment(button) {
    if (!window.confirm("تأكيد استلام التحويل وفتح الكتاب للمستخدم؟")) return;
    button.disabled = true;
    try {
        await request(`/api/admin/orders/${button.dataset.id}/confirm`, { method: "POST", body: "{}" });
        showMessage("تم تأكيد الدفع وفتح الكتاب للمستخدم");
        await loadDashboard();
    } catch (error) {
        button.disabled = false;
        showMessage(error.message || "تعذر تأكيد الدفع", true);
    }
}

async function rejectPayment(button) {
    const reason = window.prompt("سبب رفض الدفع:", "الإيصال غير صحيح أو لم يتم تحويل المبلغ المحدد");
    if (reason === null) return;
    button.disabled = true;
    try {
        await request(`/api/admin/orders/${button.dataset.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) });
        showMessage("تم رفض الدفع وإبلاغ العميل");
        await loadDashboard();
    } catch (error) {
        button.disabled = false;
        showMessage(error.message || "تعذر رفض الدفع", true);
    }
}
loadDashboard().catch(error => showMessage(error.message || "تعذر تحميل لوحة الإدارة", true));
