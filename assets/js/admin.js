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
    document.getElementById("orders").innerHTML = orders.slice(0, 20).map(order => `<tr><td>${order.userId?.email || "-"}</td><td>${order.total} جنيه</td><td>${order.paymentStatus}</td></tr>`).join("");
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
});
loadDashboard().catch(error => showMessage(error.message || "تعذر تحميل لوحة الإدارة", true));
