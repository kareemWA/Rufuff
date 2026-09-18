const readerTitle = document.getElementById("readerTitle");
const readerAuthor = document.getElementById("readerAuthor");
const readerStatus = document.getElementById("readerStatus");
const readerDownload = document.getElementById("readerDownload");
const readerFrameWrap = document.getElementById("readerFrameWrap");
const readerControls = document.getElementById("readerControls");
const pageIndicator = document.getElementById("pageIndicator");
const prevPageBtn = document.getElementById("prevPageBtn");
const nextPageBtn = document.getElementById("nextPageBtn");
const zoomOutBtn = document.getElementById("zoomOutBtn");
const zoomInBtn = document.getElementById("zoomInBtn");
const readerFrame = document.getElementById("readerFrame");
const bookId = new URLSearchParams(window.location.search).get("id");
const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");

function normalizeGoogleDrivePdfUrl(url) {
    if (!url || typeof url !== "string") return url;
    try {
        const parsed = new URL(url);
        const fileId = parsed.searchParams.get("id") || parsed.pathname.match(/\/file\/d\/([^/]+)/i)?.[1];
        if ((parsed.hostname === "drive.google.com" || parsed.hostname === "docs.google.com") && fileId) {
            return `https://drive.google.com/uc?export=view&id=${encodeURIComponent(fileId)}`;
        }
    } catch {
        // Ignore invalid URLs and keep the original value.
    }
    return url;
}

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

        if (!(book.hasPdf ?? Boolean(book.pdfFile))) {
            showError("ملف القراءة غير مرفوع لهذا الكتاب حاليًا.");
            return;
        }

        const readResponse = await fetch(`/api/books/${encodeURIComponent(bookId)}/read`, { method: "POST" });
        if (!readResponse.ok) throw new Error(await readResponse.text());

        const accessUrl = `/api/books/${encodeURIComponent(bookId)}/access`;
        const viewerUrl = /^https?:\/\//i.test(String(book.pdfFile || "")) ? normalizeGoogleDrivePdfUrl(book.pdfFile) : accessUrl;

        readerDownload.href = `${accessUrl}?download=1`;
        readerDownload.hidden = false;
        readerFrame.src = viewerUrl;
        readerFrameWrap.hidden = false;
        readerControls.hidden = true;
        readerStatus.hidden = true;
        pageIndicator.textContent = "عرض الكتاب";
    } catch (error) {
        showError(error.message || "تعذر فتح الكتاب.");
    }
}

if (prevPageBtn) prevPageBtn.addEventListener("click", () => readerFrame.contentWindow?.history?.back?.());
if (nextPageBtn) nextPageBtn.addEventListener("click", () => readerFrame.contentWindow?.history?.forward?.());
if (zoomOutBtn) zoomOutBtn.addEventListener("click", () => { if (readerFrame) readerFrame.style.transform = "scale(0.9)"; });
if (zoomInBtn) zoomInBtn.addEventListener("click", () => { if (readerFrame) readerFrame.style.transform = "scale(1.1)"; });

loadReader();
