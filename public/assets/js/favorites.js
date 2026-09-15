// الحصول على العنصر الذي ستظهر داخله الكتب المفضلة.
const favoritesBooks = document.getElementById("favoritesBooks");
// الحصول على العنصر الذي يعرض عدد الكتب المفضلة.
const favoritesSummary = document.getElementById("favoritesSummary");
// قراءة بيانات المستخدم المحفوظة محليًا وتحويلها إلى كائن.
const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
// إنشاء قائمة فارغة لتخزين الكتب المفضلة.
let favorites = [];
// إنشاء قائمة فارغة لتخزين كتب السلة.
let cart = [];

// حفظ السلة والمفضلة للمستخدم المسجل دخوله.
async function saveFavorites() {
    // التأكد من وجود مستخدم مسجل قبل إرسال البيانات إلى الخادم.
    if (currentUser?.email) {
        // حفظ السلة والمفضلة من خلال مكتبة الحساب المشتركة.
        return window.accountLibrary.save(currentUser, cart, favorites);
    }
    // إرجاع فشل الحفظ إذا لم يوجد مستخدم مسجل.
    return false;
}

// إعادة رسم قائمة الكتب المفضلة على الصفحة.
function renderFavorites() {
    // تفريغ المحتوى الحالي قبل إضافة القائمة الجديدة.
    favoritesBooks.innerHTML = "";
    // عرض عدد الكتب المفضلة مع استخدام الصيغة المناسبة للمفرد والجمع.
    favoritesSummary.textContent = `${favorites.length} ${favorites.length === 1 ? "كتاب" : "كتب"}`;

    // التحقق من أن قائمة المفضلة فارغة.
    if (!favorites.length) {
        // عرض رسالة توضح أن المفضلة فارغة مع رابط لاكتشاف الكتب.
        favoritesBooks.innerHTML = `
            <div class="cart-empty">
                <strong>المفضلة فارغة</strong>
                <p>اضغط على القلب بجانب أي كتاب للاحتفاظ به هنا.</p>
                <a class="btn" href="index.html#books">اكتشف الكتب</a>
            </div>`;
        // إيقاف الدالة بعد عرض حالة القائمة الفارغة.
        return;
    }

    // المرور على كل كتاب موجود في قائمة المفضلة.
    favorites.forEach(book => {
        // إنشاء عنصر يمثل بطاقة الكتاب.
        const article = document.createElement("article");
        // تحديد تنسيق بطاقة الكتاب.
        article.className = "purchased-card";
        // بناء محتوى البطاقة باستخدام بيانات الكتاب.
        article.innerHTML = `
            <img class="purchased-cover" src="${book.image}" alt="غلاف كتاب ${book.title}">
            <div class="purchased-card-info">
                <span class="book-category">${book.category}</span>
                <h2>${book.title}</h2>
                <p>${book.author}</p>
                <div class="price-box"><strong class="price">${book.price} جنيه</strong><del>${book.originalPrice || book.price} جنيه</del><span class="discount-badge">خصم ${book.discountPercent || 0}%</span></div>
                <div class="favorite-actions">
                    <a class="btn" href="book-detail.html?id=${book._id}">عرض التفاصيل</a>
                    <button class="remove-favorite" type="button">إزالة</button>
                </div>
            </div>`;
        // إضافة حدث النقر إلى زر إزالة الكتاب من المفضلة.
        article.querySelector(".remove-favorite").addEventListener("click", async () => {
            // حذف الكتاب الذي ضغط المستخدم على زر إزالته.
            favorites = favorites.filter(item => item._id !== book._id);
            // حفظ القائمة الجديدة في حساب المستخدم.
            await saveFavorites();
            // إعادة رسم القائمة بعد الحذف.
            renderFavorites();
        });
        // إضافة بطاقة الكتاب إلى الصفحة.
        favoritesBooks.appendChild(article);
    });
}

// تحميل بيانات المفضلة عند فتح الصفحة.
async function initializeFavorites() {
    // تحميل السلة والمفضلة من التخزين المحلي أو الخادم.
    const library = await window.accountLibrary.load(currentUser);
    // تحديث قائمة السلة مع استخدام قائمة فارغة إذا لم توجد بيانات.
    cart = library?.cart || [];
    // تحديث قائمة المفضلة مع استخدام قائمة فارغة إذا لم توجد بيانات.
    favorites = library?.favorites || [];
    // عرض الكتب المفضلة بعد اكتمال التحميل.
    renderFavorites();
}

// بدء عملية تحميل وعرض المفضلة.
initializeFavorites();
