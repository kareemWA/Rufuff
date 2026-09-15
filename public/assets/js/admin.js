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
    const [stats, orders, users, books, categories, coupons] = await Promise.all([
        request("/api/admin/stats"),
        request("/api/admin/orders"),
        request("/api/admin/users"),
        request("/api/admin/books"),
        request("/api/admin/categories"),
        request("/api/admin/coupons")
    ]);
    const categorySelect = document.querySelector('#bookForm select[name="category"]');
    if (categorySelect) {
        categorySelect.innerHTML = '<option value="">اختر التصنيف</option>'
            + categories.map(category => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)}</option>`).join("");
    }
    document.getElementById("usersCount").textContent = stats.users;
    document.getElementById("booksCount").textContent = stats.books;
    document.getElementById("ordersCount").textContent = stats.orders;
    document.getElementById("revenue").textContent = `${stats.revenue} جنيه`;
    document.getElementById("orders").innerHTML = orders.slice(0, 20).map(order => `<tr><td>${escapeHtml(order.userId?.name || order.userId?.email || "-")}<br><small>${escapeHtml(order.userId?.email || "")}</small></td><td>${order.books.map(book => escapeHtml(book.title)).join("، ")}</td><td>${order.total} جنيه</td><td><code>${escapeHtml(order.kashierTransactionId || order.kashierOrderReference || "بانتظار Kashier")}</code></td><td>${order.paymentStatus === "paid" ? "تم الدفع وفتح الكتب" : order.paymentStatus === "failed" ? `فشل الدفع: ${escapeHtml(order.rejectionReason || "غير مكتمل")}` : "بانتظار تأكيد Kashier"}</td></tr>`).join("");
    document.getElementById("users").innerHTML = users.slice(0, 20).map(user => `<tr><td>${user.name}</td><td>${user.email}</td><td>${user.role}</td></tr>`).join("");
    document.getElementById("categories").innerHTML = categories.map(category => `<tr><td>${escapeHtml(category.name)}</td><td>${category.bookCount}</td><td>${category.bookCount ? "مرتبط بكتب" : `<button class="delete-resource" data-url="/api/admin/categories/${category.id}" data-label="التصنيف">حذف</button>`}</td></tr>`).join("");
    document.getElementById("coupons").innerHTML = coupons.map(coupon => `<tr><td><strong>${escapeHtml(coupon.code)}</strong></td><td>${coupon.type === "percentage" ? "نسبة مئوية" : "مبلغ ثابت"}</td><td>${coupon.value}${coupon.type === "percentage" ? "%" : " جنيه"}</td><td>${coupon.minPurchase || 0} جنيه</td><td>${coupon.maxUses || "غير محدد"}</td><td><button class="delete-resource" data-url="/api/admin/coupons/${coupon._id}" data-label="الكوبون">حذف</button></td></tr>`).join("");
    document.getElementById("books").innerHTML = books.map(book => `<tr><td>${escapeHtml(book.title)}</td><td>${escapeHtml(book.author)}</td><td>${book.price} جنيه</td><td><button class="delete-resource" data-url="/api/admin/books/${book._id}" data-label="الكتاب">حذف</button></td></tr>`).join("");
}

async function submitForm(form, url) {
    form.addEventListener("submit", async event => {
        event.preventDefault();
        try {
            const data = Object.fromEntries(new FormData(form));
            if (form.id === "bookForm") {
                data.cover = data.cover || await readFileAsDataUrl(data.coverFile, "صورة الغلاف", 2 * 1024 * 1024, /^image\/(png|jpe?g|webp)$/i);
                delete data.coverFile;
                if (!data.cover) throw new Error("اختر صورة الغلاف أو اكتب رابطها");
            }
            await request(url, { method: "POST", body: JSON.stringify(data) });
            form.reset();
            showMessage("تم الحفظ بنجاح");
            await loadDashboard();
        } catch (error) {
            showMessage(error.message || "تعذر الحفظ", true);
        }
    });
}

function readFileAsDataUrl(file, label, maxSize, typePattern) {
    if (!file || !file.size) return Promise.resolve("");
    if (file.size > maxSize) return Promise.reject(new Error(`${label} يجب ألا يتجاوز ${Math.round(maxSize / 1024 / 1024)} ميجابايت`));
    if (!typePattern.test(file.type)) return Promise.reject(new Error(`${label} بصيغة غير مدعومة`));
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error(`تعذر قراءة ${label}`));
        reader.readAsDataURL(file);
    });
}

submitForm(document.getElementById("bookForm"), "/api/admin/books");
submitForm(document.getElementById("couponForm"), "/api/admin/coupons");
submitForm(document.getElementById("categoryForm"), "/api/admin/categories");
document.addEventListener("click", event => {
    const button = event.target.closest(".delete-resource");
    if (button) deleteResource(button.dataset.url, button.dataset.label);
});

loadDashboard().catch(error => showMessage(error.message || "تعذر تحميل لوحة الإدارة", true));
window.setInterval(() => loadDashboard().catch(() => {}), 15000);
