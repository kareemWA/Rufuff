const favoritesBooks = document.getElementById("favoritesBooks");
const favoritesSummary = document.getElementById("favoritesSummary");
const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
let favorites = [];
let cart = [];

function saveFavorites() {
    if (currentUser?.email) {
        window.accountLibrary.save(currentUser, cart, favorites);
    }
}

function renderFavorites() {
    favoritesBooks.innerHTML = "";
    favoritesSummary.textContent = `${favorites.length} ${favorites.length === 1 ? "كتاب" : "كتب"}`;

    if (!favorites.length) {
        favoritesBooks.innerHTML = `
            <div class="cart-empty">
                <strong>المفضلة فارغة</strong>
                <p>اضغط على القلب بجانب أي كتاب للاحتفاظ به هنا.</p>
                <a class="btn" href="index.html#books">اكتشف الكتب</a>
            </div>`;
        return;
    }

    favorites.forEach(book => {
        const article = document.createElement("article");
        article.className = "purchased-card";
        article.innerHTML = `
            <img class="purchased-cover" src="${book.image}" alt="غلاف كتاب ${book.title}">
            <div class="purchased-card-info">
                <span class="book-category">${book.category}</span>
                <h2>${book.title}</h2>
                <p>${book.author}</p>
                <div class="price-box"><strong class="price">${book.price} جنيه</strong><del>${book.originalPrice || book.price} جنيه</del><span class="discount-badge">خصم ${book.discountPercent || 65}%</span></div>
                <div class="favorite-actions">
                    <a class="btn" href="book-detail.html?id=${book._id}">عرض التفاصيل</a>
                    <button class="remove-favorite" type="button">إزالة</button>
                </div>
            </div>`;
        article.querySelector(".remove-favorite").addEventListener("click", () => {
            favorites = favorites.filter(item => item._id !== book._id);
            saveFavorites();
            renderFavorites();
        });
        favoritesBooks.appendChild(article);
    });
}

async function initializeFavorites() {
    const library = await window.accountLibrary.load(currentUser);
    cart = library.cart;
    favorites = library.favorites;
    renderFavorites();
}

initializeFavorites();
