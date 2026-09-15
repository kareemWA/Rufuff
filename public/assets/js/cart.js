const cartItems = document.getElementById("cartItems");
const cartSummary = document.getElementById("cartSummary");
const cartTotal = document.getElementById("cartTotal");
const checkoutButton = document.getElementById("checkoutButton");
const cartMessage = document.getElementById("cartMessage");
const manualPaymentPanel = document.getElementById("manualPaymentPanel");
const paymentAmount = document.getElementById("paymentAmount");
const submitPayment = document.getElementById("submitPayment");
const paymentMessage = document.getElementById("paymentMessage");
const couponCode = document.getElementById("couponCode");
const applyCouponButton = document.getElementById("applyCoupon");
const couponStatus = document.getElementById("couponStatus");
const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
let cart = [];
let favorites = [];
let appliedCoupon = null;

function setCouponStatus(text, state = "") {
    couponStatus.textContent = text;
    couponStatus.className = `coupon-status${state ? ` ${state}` : ""}`;
}

function showPaymentToast(message, error = false) {
    const toast = document.createElement("div");
    toast.className = `payment-toast${error ? " error" : ""}`;
    toast.setAttribute("role", "status");
    toast.innerHTML = `<span></span><button type="button" aria-label="إغلاق">×</button>`;
    toast.querySelector("span").textContent = message;
    toast.querySelector("button").addEventListener("click", () => toast.remove());
    document.body.appendChild(toast);
    return toast;
}

const paymentStatus = new URLSearchParams(window.location.search).get("payment");
const returnedPaymentId = new URLSearchParams(window.location.search).get("paymentId");
if (paymentStatus === "paid") {
    cartMessage.textContent = "تم الدفع بنجاح. سيتم تحديث كتبك المشتراة.";
    cartMessage.className = "form-message success";
} else if (paymentStatus === "failed") {
    cartMessage.textContent = "لم يكتمل الدفع، والكتب ما زالت في السلة.";
    cartMessage.className = "form-message error";
} else if (paymentStatus === "return") {
    cartMessage.textContent = "تمت العودة من Kashier. سيتم إتاحة الكتب تلقائيًا بعد تأكيد الدفع.";
    cartMessage.className = "form-message";
}

function saveCart() {
    if (currentUser?.email) {
        window.accountLibrary.save(currentUser, cart, favorites);
    }
}

function renderCart() {
    cartItems.innerHTML = "";
    const subtotal = cart.reduce((sum, book) => sum + Number(book.price || 0), 0);
    if (appliedCoupon && Math.abs(appliedCoupon.subtotal - subtotal) > 0.001) {
        appliedCoupon = null;
        setCouponStatus("");
    }
    const total = appliedCoupon?.total ?? subtotal;
    cartSummary.textContent = `${cart.length} ${cart.length === 1 ? "كتاب" : "كتب"}`;
    cartTotal.textContent = `${total} جنيه`;
    paymentAmount.textContent = `${total} جنيه`;
    checkoutButton.disabled = !cart.length;

    if (!cart.length) {
        cartItems.innerHTML = `
            <div class="cart-empty">
                <strong>السلة فارغة</strong>
                <p>أضف كتابًا من المتجر ليظهر هنا.</p>
                <a class="btn" href="index.html">اكتشف الكتب</a>
            </div>`;
        return;
    }

    cart.forEach(book => {
        const item = document.createElement("article");
        item.className = "cart-item";
        item.innerHTML = `
            <img src="${book.image}" alt="غلاف كتاب ${book.title}">
            <div class="cart-item-info">
                <span class="book-category">${book.category}</span>
                <h2>${book.title}</h2>
                <p>${book.author}</p>
                <div class="price-box"><strong class="price">${book.price} جنيه</strong><del>${book.originalPrice || book.price} جنيه</del><span class="discount-badge">خصم ${book.discountPercent || 0}%</span></div>
            </div>
            <button class="remove-cart-item" type="button" aria-label="إزالة ${book.title}">إزالة</button>`;
        item.querySelector(".remove-cart-item").addEventListener("click", () => {
            cart = cart.filter(itemBook => itemBook._id !== book._id);
            saveCart();
            renderCart();
        });
        cartItems.appendChild(item);
    });
}

async function applyCoupon() {
    const code = couponCode.value.trim();
    const subtotal = cart.reduce((sum, book) => sum + Number(book.price || 0), 0);
    if (!code) {
        appliedCoupon = null;
        setCouponStatus("اكتب كود الخصم أولًا", "error");
        renderCart();
        return false;
    }

    applyCouponButton.disabled = true;
    setCouponStatus("جارٍ التحقق...");
    try {
        const response = await fetch("/api/coupons/validate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ code, subtotal })
        });
        if (!response.ok) throw new Error(await response.text());
        appliedCoupon = await response.json();
        setCouponStatus(`✓ تم تطبيق الكوبون، وفرت ${appliedCoupon.discount} جنيه`, "success");
        renderCart();
        return true;
    } catch (error) {
        appliedCoupon = null;
        setCouponStatus(error.message || "كود الخصم غير صحيح", "error");
        renderCart();
        return false;
    } finally {
        applyCouponButton.disabled = false;
    }
}

applyCouponButton.addEventListener("click", applyCoupon);
couponCode.addEventListener("input", () => {
    if (!appliedCoupon) return;
    appliedCoupon = null;
    setCouponStatus("");
    renderCart();
});

checkoutButton.addEventListener("click", async () => {
    if (!currentUser?.email) {
        window.location.href = `signin.html?return=${encodeURIComponent("/cart.html")}`;
        return;
    }

    const total = appliedCoupon?.total ?? cart.reduce((sum, book) => sum + Number(book.price || 0), 0);
    if (total <= 0) {
        await submitFreePurchase();
        return;
    }

    manualPaymentPanel.hidden = false;
    manualPaymentPanel.scrollIntoView({ behavior: "smooth", block: "center" });
});

async function submitFreePurchase() {
    checkoutButton.disabled = true;
    cartMessage.textContent = "جارٍ تثبيت الكتب المجانية...";
    cartMessage.className = "form-message";
    try {
        const response = await fetch("/api/purchases/free", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookIds: cart.map(book => book._id), couponCode: couponCode.value.trim() })
        });
        if (!response.ok) throw new Error(await response.text());
        cart = [];
        appliedCoupon = null;
        await window.accountLibrary.save(currentUser, [], favorites);
        renderCart();
        cartMessage.textContent = "تمت إضافة الكتب المجانية إلى مكتبتك.";
        cartMessage.className = "form-message success";
        window.setTimeout(() => { window.location.href = "purchased.html"; }, 800);
    } catch (error) {
        cartMessage.textContent = error.message || "تعذر إضافة الكتب المجانية.";
        cartMessage.className = "form-message error";
        checkoutButton.disabled = false;
    }
}

submitPayment.addEventListener("click", async () => {
    if (couponCode.value.trim() && !appliedCoupon && !(await applyCoupon())) return;
    submitPayment.disabled = true;
    paymentMessage.textContent = "جارٍ تجهيز رابط الدفع...";
    paymentMessage.className = "form-message";
    try {
        const response = await fetch("/api/payments/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookIds: cart.map(book => book._id), couponCode: couponCode.value.trim() })
        });
        if (!response.ok) throw new Error(await response.text());
        const payment = await response.json();
        cartMessage.textContent = "سيتم تحويلك الآن إلى Kashier لإتمام الدفع.";
        cartMessage.className = "form-message success";
        window.accountLibrary.savePaymentRequest(currentUser, cart, payment.paymentId);
        window.location.href = payment.paymentUrl;
    } catch (error) {
        submitPayment.disabled = false;
        paymentMessage.textContent = error.message || "تعذر إرسال الإيصال.";
        paymentMessage.className = "form-message error";
    }
});

function watchPaymentStatus(paymentId, submittedBooks) {
    let attempts = 0;
    let checking = false;
    const checkPayment = async () => {
        if (checking) return;
        checking = true;
        try {
            const response = await fetch("/api/payments/mine");
            if (!response.ok) return;
            const payment = (await response.json()).find(item => item.id === paymentId);
            if (!payment || payment.status === "pending") return;
            window.accountLibrary.syncPaymentState(currentUser, [payment], submittedBooks);
            window.clearInterval(interval);
            if (payment.status === "paid") {
                cart = [];
                await window.accountLibrary.save(currentUser, [], favorites);
                renderCart();
                cartMessage.textContent = "تم الدفع بنجاح. تم فتح كتبك المشتراة.";
                cartMessage.className = "form-message success";
                window.setTimeout(() => { window.location.href = "purchased.html"; }, 700);
                return;
            }
            cart = submittedBooks;
            await window.accountLibrary.save(currentUser, cart, favorites);
            renderCart();
            showPaymentToast(`فشلت عملية الدفع. السبب: ${payment.rejectionReason || "لم يتم تأكيد العملية"}. يمكنك المحاولة مرة أخرى.`, true);
            cartMessage.textContent = "فشلت عملية الدفع، وتمت إعادة الكتب إلى السلة.";
            cartMessage.className = "form-message error";
        } catch (error) {
            // Keep the local pending state and retry on the next interval.
        } finally {
            checking = false;
        }
    };
    const interval = window.setInterval(() => {
        attempts += 1;
        if (attempts >= 40) {
            window.clearInterval(interval);
            cartMessage.textContent = "لم يصل تأكيد الدفع بعد. ستبقى الكتب في السلة حتى يصل التأكيد.";
            cartMessage.className = "form-message error";
            return;
        }
        checkPayment();
    }, 3000);
    checkPayment();
}

async function initializeCart() {
    const library = await window.accountLibrary.load(currentUser);
    cart = library.cart;
    favorites = library.favorites;
    renderCart();
    if (paymentStatus === "return" && returnedPaymentId) watchPaymentStatus(returnedPaymentId, [...cart]);
}

initializeCart();
