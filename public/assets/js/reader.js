const readerTitle = document.getElementById("readerTitle");
const readerAuthor = document.getElementById("readerAuthor");
const readerStatus = document.getElementById("readerStatus");
const readerDownload = document.getElementById("readerDownload");
const readerFrameWrap = document.getElementById("readerFrameWrap");
const readerFrame = document.getElementById("readerFrame");
const bookId = new URLSearchParams(window.location.search).get("id");
const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");

if (!currentUser?.email) {
    const returnUrl = `${window.location.pathname}${window.location.search}`;
    window.location.href = `signin.html?return=${encodeURIComponent(returnUrl)}`;
}

function showError(message) {
    readerStatus.textContent = message;
    readerStatus.className = "detail-status error";
}

async function loadReader() {
    if (!bookId) {
        showError("رابط الكتاب غير صحيح.");
        return;
    }

    try {
        const bookResponse = await fetch(`/api/books/${encodeURIComponent(bookId)}`);
        if (!bookResponse.ok) throw new Error("الكتاب غير موجود.");
        const book = await bookResponse.json();
        readerTitle.textContent = book.title;
        readerAuthor.textContent = `تأليف ${book.author}`;
        document.title = `${book.title} | قارئ رفوف`;

        if (!book.pdfFile) {
            showError("ملف القراءة غير مرفوع لهذا الكتاب حاليًا.");
            return;
        }

        const readResponse = await fetch(`/api/books/${encodeURIComponent(bookId)}/read`, { method: "POST" });
        if (!readResponse.ok) throw new Error(await readResponse.text());

        const accessUrl = `/api/books/${encodeURIComponent(bookId)}/access`;
        readerFrame.src = accessUrl;
        readerDownload.href = `${accessUrl}?download=1`;
        readerDownload.hidden = false;
        readerFrameWrap.hidden = false;
        readerStatus.hidden = true;
    } catch (error) {
        showError(error.message || "تعذر فتح الكتاب.");
    }
}

loadReader();
