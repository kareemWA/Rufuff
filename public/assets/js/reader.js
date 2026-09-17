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
const pdfCanvas = document.getElementById("pdfCanvas");
const bookId = new URLSearchParams(window.location.search).get("id");
const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");

if (!currentUser?.email) {
    const returnUrl = `${window.location.pathname}${window.location.search}`;
    window.location.href = `signin.html?return=${encodeURIComponent(returnUrl)}`;
}

let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let currentScale = 1.2;

async function ensurePdfJs() {
    try {
        const pdfjsLib = await import("/node_modules/pdfjs-dist/build/pdf.mjs");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/build/pdf.worker.min.mjs";
        return pdfjsLib;
    } catch (error) {
        throw new Error("تعذر تحميل مكتبة PDF.js محليًا.");
    }
}

function showError(message) {
    readerStatus.textContent = message;
    readerStatus.className = "detail-status error";
}

function updatePageCounter() {
    if (!pdfDoc) return;
    pageIndicator.textContent = `الصفحة ${pageNum} من ${pdfDoc.numPages}`;
    prevPageBtn.disabled = pageNum <= 1;
    nextPageBtn.disabled = pageNum >= pdfDoc.numPages;
}

function renderPage(num) {
    if (!pdfDoc || !pdfCanvas) return;

    pageRendering = true;
    pdfDoc.getPage(num).then(page => {
        const viewport = page.getViewport({ scale: currentScale });
        const context = pdfCanvas.getContext("2d");
        pdfCanvas.height = viewport.height;
        pdfCanvas.width = viewport.width;

        const renderContext = {
            canvasContext: context,
            viewport
        };

        const renderTask = page.render(renderContext);
        renderTask.promise.then(() => {
            pageRendering = false;
            updatePageCounter();
            if (pageNumPending !== null) {
                const queuedPage = pageNumPending;
                pageNumPending = null;
                renderPage(queuedPage);
            }
        }).catch(() => {
            pageRendering = false;
            showError("تعذر عرض الصفحة الحالية من الملف.");
        });
    }).catch(() => {
        pageRendering = false;
        showError("تعذر عرض الملف في المتصفح.");
    });
}

function queueRenderPage(num) {
    if (pageRendering) {
        pageNumPending = num;
        return;
    }
    pageNum = num;
    renderPage(num);
}

prevPageBtn.addEventListener("click", () => {
    if (pageNum <= 1) return;
    queueRenderPage(pageNum - 1);
});

nextPageBtn.addEventListener("click", () => {
    if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
    queueRenderPage(pageNum + 1);
});

zoomOutBtn.addEventListener("click", () => {
    if (currentScale <= 0.7) return;
    currentScale = Math.max(0.7, Number((currentScale - 0.25).toFixed(2)));
    queueRenderPage(pageNum);
});

zoomInBtn.addEventListener("click", () => {
    if (currentScale >= 2.5) return;
    currentScale = Math.min(2.5, Number((currentScale + 0.25).toFixed(2)));
    queueRenderPage(pageNum);
});

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
        readerDownload.href = `${accessUrl}?download=1`;
        readerDownload.hidden = false;

        const pdfResponse = await fetch(accessUrl, { headers: { Accept: "application/pdf" } });
        if (!pdfResponse.ok) throw new Error("تعذر تحميل ملف PDF.");

        const pdfjsLib = await ensurePdfJs();
        const pdfBytes = await pdfResponse.arrayBuffer();
        const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(pdfBytes) });
        pdfDoc = await loadingTask.promise;

        readerFrameWrap.hidden = false;
        readerControls.hidden = false;
        readerStatus.hidden = true;
        updatePageCounter();
        renderPage(pageNum);
    } catch (error) {
        showError(error.message || "تعذر فتح الكتاب.");
    }
}

loadReader();
