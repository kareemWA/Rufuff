const cartItems = document.getElementById("cartItems");
const cartSummary = document.getElementById("cartSummary");
const cartTotal = document.getElementById("cartTotal");
const checkoutButton = document.getElementById("checkoutButton");
const cartMessage = document.getElementById("cartMessage");
const manualPaymentPanel = document.getElementById("manualPaymentPanel");
const paymentAmount = document.getElementById("paymentAmount");
const receiptInput = document.getElementById("receiptInput");
const submitPayment = document.getElementById("submitPayment");
const paymentMessage = document.getElementById("paymentMessage");
const couponCode = document.getElementById("couponCode");
const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
let cart = [];
let favorites = [];

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
if (paymentStatus === "paid") {
    cartMessage.textContent = "تم الدفع بنجاح. سيتم تحديث كتبك المشتراة.";
    cartMessage.className = "form-message success";
} else if (paymentStatus === "failed") {
    cartMessage.textContent = "لم يكتمل الدفع، والكتب ما زالت في السلة.";
    cartMessage.className = "form-message error";
}

function saveCart() {
    if (currentUser?.email) {
        window.accountLibrary.save(currentUser, cart, favorites);
    }
}

function renderCart() {
    cartItems.innerHTML = "";
    const total = cart.reduce((sum, book) => sum + Number(book.price || 0), 0);
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

checkoutButton.addEventListener("click", async () => {
    if (!currentUser?.email) {
        window.location.href = `logIn.html?return=${encodeURIComponent("/cart.html")}`;
        return;
    }

    manualPaymentPanel.hidden = false;
    manualPaymentPanel.scrollIntoView({ behavior: "smooth", block: "center" });
});

submitPayment.addEventListener("click", async () => {
    const file = receiptInput.files[0];
    if (!file) {
        paymentMessage.textContent = "اختر صورة الإيصال أولًا.";
        paymentMessage.className = "form-message error";
        return;
    }
    if (!file.type.startsWith("image/") || file.size > 7 * 1024 * 1024) {
        paymentMessage.textContent = "اختر صورة PNG أو JPG أو WEBP أقل من 7 ميجابايت.";
        paymentMessage.className = "form-message error";
        return;
    }
    submitPayment.disabled = true;
    const submittedBooks = [...cart];
    paymentMessage.textContent = "جارٍ إرسال الإيصال للمراجعة...";
    paymentMessage.className = "form-message";
    try {
        const receiptImage = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error("تعذر قراءة صورة الإيصال"));
            reader.readAsDataURL(file);
        });
        const response = await fetch("/api/purchases", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ bookIds: cart.map(book => book._id), receiptImage, couponCode: couponCode.value.trim() })
        });
        if (!response.ok) throw new Error(await response.text());
        const payment = await response.json();
        window.accountLibrary.savePaymentRequest(currentUser, cart, payment.paymentId);
        await window.accountLibrary.save(currentUser, [], favorites);
        cart = [];
        manualPaymentPanel.hidden = true;
        renderCart();
        cartMessage.textContent = "تم إرسال الإيصال. الكتاب محفوظ محليًا وقيد مراجعة الدفع، وسيتم تحديث حالته تلقائيًا دون إعادة تحميل.";
        cartMessage.className = "form-message success";
        submitPayment.disabled = false;
        receiptInput.value = "";
        showPaymentToast("تم إرسال إيصال التحويل بنجاح. تم حفظ طلبك، وسيتم تحويلك إلى كتبي المشتراة لمتابعة التأكيد.");
        window.setTimeout(() => { window.location.href = "purchased.html?pending=1"; }, 1800);
        watchPaymentStatus(payment.paymentId, submittedBooks);
    } catch (error) {
        submitPayment.disabled = false;
        paymentMessage.textContent = error.message || "تعذر إرسال الإيصال.";
        paymentMessage.className = "form-message error";
    }
});

function watchPaymentStatus(paymentId, submittedBooks) {
    const interval = window.setInterval(async () => {
        try {
            const response = await fetch("/api/payments/mine");
            if (!response.ok) return;
            const payment = (await response.json()).find(item => item.id === paymentId);
            if (!payment || payment.status === "pending") return;
            window.accountLibrary.syncPaymentState(currentUser, [payment], submittedBooks);
            window.clearInterval(interval);
            if (payment.status === "paid") {
                cartMessage.textContent = "تم تأكيد دفع الكتب. أصبحت كتبك متاحة الآن دون إعادة تحميل.";
                cartMessage.className = "form-message success";
                return;
            }
            cart = submittedBooks;
            await window.accountLibrary.save(currentUser, cart, favorites);
            renderCart();
            showPaymentToast(`تم رفض الدفع. السبب: ${payment.rejectionReason || "الإيصال غير صحيح أو لم يتم تحويل المبلغ المحدد"}. يمكنك إعادة المحاولة.`, true);
            cartMessage.textContent = "تمت إعادة الكتاب إلى السلة ويمكنك إعادة المحاولة.";
            cartMessage.className = "form-message error";
        } catch (error) {
            // Keep the local pending state and retry on the next interval.
        }
    }, 15000);
}

async function initializeCart() {
    const library = await window.accountLibrary.load(currentUser);
    cart = library.cart;
    favorites = library.favorites;
    renderCart();
}

initializeCart();
