(() => {
    let saveQueue = Promise.resolve();

    function storageKey(name, email) {
        const normalizedEmail = (email || "guest").trim().toLowerCase();
        return `${name}:${normalizedEmail}`;
    }

    function readLocal(name, email) {
        try {
            return JSON.parse(localStorage.getItem(storageKey(name, email)) || "[]");
        } catch {
            return [];
        }
    }

    function writeLocal(name, value, email) {
        localStorage.setItem(storageKey(name, email), JSON.stringify(value));
    }

    function readPaymentState(user) {
        if (!user?.email) return { records: {}, statuses: {} };
        try {
            return JSON.parse(localStorage.getItem(storageKey("paymentState", user.email)) || '{"records":{},"statuses":{}}');
        } catch {
            return { records: {}, statuses: {} };
        }
    }

    function writePaymentState(user, state) {
        if (user?.email) writeLocal("paymentState", state, user.email);
    }

    function savePaymentRequest(user, books, paymentId) {
        const state = readPaymentState(user);
        books.forEach(book => {
            state.records[String(book._id)] = { book, status: "pending", paymentId };
        });
        if (paymentId) {
            state.statuses[paymentId] = "pending";
            localStorage.setItem("paymentStatuses", JSON.stringify(state.statuses));
        }
        writePaymentState(user, state);
    }

    function syncPaymentState(user, payments, books = []) {
        const state = readPaymentState(user);
        const booksById = new Map(books.map(book => [String(book._id), book]));
        const latestPaymentsByBook = new Map();
        [...payments].sort((left, right) => new Date(left.createdAt || 0) - new Date(right.createdAt || 0)).forEach(payment => {
            state.statuses[payment.id] = payment.status;
            (payment.bookIds || []).forEach(bookId => {
                latestPaymentsByBook.set(String(bookId), payment);
            });
        });
        latestPaymentsByBook.forEach((payment, id) => {
            const previous = state.records[id] || {};
            state.records[id] = {
                ...previous,
                book: booksById.get(id) || previous.book,
                status: payment.status,
                paymentId: payment.id,
                rejectionReason: payment.rejectionReason || null
            };
        });
        if (books.length) {
            Object.keys(state.records).forEach(id => {
                if (!booksById.has(id)) delete state.records[id];
            });
        }
        localStorage.setItem("paymentStatuses", JSON.stringify(state.statuses));
        writePaymentState(user, state);
        return state;
    }

    function markPaymentRecord(user, book, status) {
        const state = readPaymentState(user);
        const id = String(book._id);
        state.records[id] = { ...(state.records[id] || {}), book, status, rejectionReason: null };
        writePaymentState(user, state);
    }

    function clearLegacyLocalData() {
        localStorage.removeItem("bookCart");
        localStorage.removeItem("favoriteBooks");
        localStorage.removeItem("currentUser");
    }

    function clearUserData(email) {
        if (!email) return;
        localStorage.removeItem(storageKey("bookCart", email));
        localStorage.removeItem(storageKey("favoriteBooks", email));
    }

    async function load(user) {
        const localCart = readLocal("bookCart", user?.email);
        const localFavorites = readLocal("favoriteBooks", user?.email);
        if (!user?.email) return { cart: localCart, favorites: localFavorites };

        try {
            const [libraryResponse, booksResponse] = await Promise.all([
                fetch("/api/library"),
                fetch("/api/books")
            ]);
            if (!libraryResponse.ok || !booksResponse.ok) throw new Error("تعذر تحميل مكتبتك");

            const library = await libraryResponse.json();
            const books = await booksResponse.json();
            const booksById = new Map(books.map(book => [String(book._id), book]));
            const accountCartBookIds = library.cartBookIds || [];
            const accountFavoriteBookIds = library.favoriteBookIds || [];
            const accountHasLibrary = accountCartBookIds.length > 0 || accountFavoriteBookIds.length > 0;
            const cartBookIds = accountHasLibrary
                ? accountCartBookIds
                : [...new Set(localCart.map(book => book._id))];
            const favoriteBookIds = accountHasLibrary
                ? accountFavoriteBookIds
                : [...new Set(localFavorites.map(book => book._id))];
            const cart = cartBookIds.map(id => booksById.get(String(id))).filter(Boolean);
            const favorites = favoriteBookIds.map(id => booksById.get(String(id))).filter(Boolean);
            if (!accountHasLibrary && (cart.length || favorites.length)) {
                await save(user, cart, favorites);
            }
            writeLocal("bookCart", cart, user.email);
            writeLocal("favoriteBooks", favorites, user.email);
            return { cart, favorites };
        } catch (error) {
            console.warn("تعذر مزامنة مكتبتك", error);
            return { cart: localCart, favorites: localFavorites };
        }
    }

    async function save(user, cart, favorites) {
        if (!user?.email) return;

        writeLocal("bookCart", cart, user.email);
        writeLocal("favoriteBooks", favorites, user.email);

        const payload = {
            cartBookIds: cart.map(book => book._id),
            favoriteBookIds: favorites.map(book => book._id)
        };
        saveQueue = saveQueue.then(async () => {
            try {
                const response = await fetch("/api/library", {
                    method: "PUT",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify(payload)
                });
                if (!response.ok) throw new Error(await response.text());
            } catch (error) {
                console.warn("تعذر حفظ مكتبتك", error);
            }
        });
        return saveQueue;
    }

    window.accountLibrary = { load, save, clearLegacyLocalData, clearUserData, readPaymentState, savePaymentRequest, syncPaymentState, markPaymentRecord };
})();
