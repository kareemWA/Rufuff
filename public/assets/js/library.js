(() => {
    let saveQueue = Promise.resolve();
    let booksCache = null;

    function storageKey(name, email) {
        const normalizedEmail = (email || "guest").trim().toLowerCase();
        return `${name}:${normalizedEmail}`;
    }

    function readLocal(name, email) {
        try {
            const value = JSON.parse(localStorage.getItem(storageKey(name, email)) || "[]");
            if (name === "bookCart" || name === "favoriteBooks") {
                return Array.isArray(value)
                    ? value.map(book => typeof book === "string" ? { _id: book } : book).filter(Boolean)
                    : [];
            }
            return value;
        } catch {
            return [];
        }
    }

    function writeLocal(name, value, email) {
        const key = storageKey(name, email);
        const storedValue = name === "bookCart" || name === "favoriteBooks"
            ? value.map(book => book?._id).filter(Boolean)
            : value;
        try {
            localStorage.setItem(key, JSON.stringify(storedValue));
            return true;
        } catch (error) {
            if (error?.name === "QuotaExceededError") {
                localStorage.removeItem(key);
                console.warn(`تعذر تخزين ${key} محليًا بسبب امتلاء مساحة المتصفح`);
                return false;
            }
            throw error;
        }
    }

    function writeLocalValue(name, value) {
        try {
            localStorage.setItem(name, JSON.stringify(value));
            return true;
        } catch (error) {
            if (error?.name === "QuotaExceededError") {
                localStorage.removeItem(name);
                console.warn(`تعذر تخزين ${name} محليًا بسبب امتلاء مساحة المتصفح`);
                return false;
            }
            throw error;
        }
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

    function paymentBook(book) {
        if (!book) return book;
        const storedBook = { ...book };
        if (typeof storedBook.image === "string" && storedBook.image.length > 100000) delete storedBook.image;
        delete storedBook.pdfFile;
        return storedBook;
    }

    function savePaymentRequest(user, books, paymentId) {
        const state = readPaymentState(user);
        books.forEach(book => {
            state.records[String(book._id)] = { book: paymentBook(book), status: "pending", paymentId };
        });
        if (paymentId) {
            state.statuses[paymentId] = "pending";
            writeLocalValue("paymentStatuses", state.statuses);
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
                book: paymentBook(booksById.get(id) || previous.book),
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
        writeLocalValue("paymentStatuses", state.statuses);
        writePaymentState(user, state);
        return state;
    }

    function markPaymentRecord(user, book, status) {
        const state = readPaymentState(user);
        const id = String(book._id);
        state.records[id] = { ...(state.records[id] || {}), book: paymentBook(book), status, rejectionReason: null };
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
        localStorage.removeItem(storageKey("paymentState", email));
    }

    async function load(user, availableBooks = null) {
        const localCart = readLocal("bookCart", user?.email);
        const localFavorites = readLocal("favoriteBooks", user?.email);
        if (!user?.email) return { cart: localCart, favorites: localFavorites };

        try {
            const libraryResponse = await fetch("/api/library");
            if (!libraryResponse.ok) throw new Error("تعذر تحميل مكتبتك");

            const library = await libraryResponse.json();
            const suppliedBooks = await Promise.resolve(availableBooks);
            const books = Array.isArray(suppliedBooks) && suppliedBooks.length
                ? suppliedBooks
                : await Promise.resolve(booksCache || fetch("/api/books").then(response => {
                    if (!response.ok) throw new Error("تعذر تحميل الكتب");
                    return response.json();
                }));
            booksCache = books;
            const booksById = new Map(books.map(book => [String(book._id), book]));
            const accountCartBookIds = library.cartBookIds || [];
            const accountFavoriteBookIds = library.favoriteBookIds || [];
            const cartBookIds = accountCartBookIds.length
                ? accountCartBookIds
                : [...new Set(localCart.map(book => book._id))];
            const favoriteBookIds = accountFavoriteBookIds.length
                ? accountFavoriteBookIds
                : [...new Set(localFavorites.map(book => book._id))];
            const cart = cartBookIds.map(id => booksById.get(String(id))).filter(Boolean);
            const favorites = favoriteBookIds.map(id => booksById.get(String(id))).filter(Boolean);
            if ((!accountCartBookIds.length && localCart.length) || (!accountFavoriteBookIds.length && localFavorites.length)) {
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
        if (!user?.email) return false;

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
                return true;
            } catch (error) {
                console.warn("تعذر حفظ مكتبتك", error);
                return false;
            }
        });
        return saveQueue;
    }

    window.accountLibrary = { load, save, getBooks: () => booksCache, clearLegacyLocalData, clearUserData, readPaymentState, savePaymentRequest, syncPaymentState, markPaymentRecord };
})();
