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
const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
let cart = [];
let favorites = [];

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
                <div class="price-box"><strong class="price">${book.price} جنيه</strong><del>${book.originalPrice || book.price} جنيه</del><span class="discount-badge">خصم ${book.discountPercent || 65}%</span></div>
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
            body: JSON.stringify({ bookIds: cart.map(book => book._id), receiptImage })
        });
        if (!response.ok) throw new Error(await response.text());
        await window.accountLibrary.save(currentUser, [], favorites);
        cart = [];
        window.location.href = "purchased.html?pending=1";
    } catch (error) {
        submitPayment.disabled = false;
        paymentMessage.textContent = error.message || "تعذر إرسال الإيصال.";
        paymentMessage.className = "form-message error";
    }
});

async function initializeCart() {
    const library = await window.accountLibrary.load(currentUser);
    cart = library.cart;
    favorites = library.favorites;
    renderCart();
}

initializeCart();
