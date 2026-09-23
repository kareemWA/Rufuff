const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
const messagesElement = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatText = document.getElementById("chatText");
const chatStatus = document.getElementById("chatStatus");
const chatImage = document.getElementById("chatImage");
const chatImagePreview = document.getElementById("chatImagePreview");
const chatImagePreviewImage = document.getElementById("chatImagePreviewImage");
const chatImageRemove = document.getElementById("chatImageRemove");
const chatNote = document.getElementById("chatNote");
const roomButtons = Array.from(document.querySelectorAll(".chat-card"));
const roomPicker = document.querySelector(".chat-cards");
const chatHero = document.getElementById("chatHero");
const founderInbox = document.getElementById("founderInbox");
const conversationList = document.getElementById("conversationList");
const imageViewer = document.getElementById("imageViewer");
const imageViewerImage = document.getElementById("imageViewerImage");
const imageViewerClose = document.getElementById("imageViewerClose");
const isAdmin = currentUser?.role === "admin";
const requestedRoom = new URLSearchParams(window.location.search).get("room");
let currentRoom = "founder";
let selectedConversation = "";
let selectedConversationEmail = "";

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function linkifyText(value) {
    return escapeHtml(value).replace(/(https?:\/\/[^\s<]+)/gi, url => {
        const cleanUrl = url.replace(/[),.!؟،]+$/g, "");
        const trailing = url.slice(cleanUrl.length);
        return `<a href="${cleanUrl}" target="_blank" rel="noopener noreferrer">${cleanUrl}</a>${trailing}`;
    });
}

function showStatus(message, type = "") {
    chatStatus.textContent = message;
    chatStatus.className = `form-message ${type}`;
}

function openImageViewer(src, alt = "") {
    if (!imageViewer || !imageViewerImage || !src) return;
    imageViewerImage.src = src;
    imageViewerImage.alt = alt;
    imageViewer.classList.remove("hidden");
    imageViewer.setAttribute("aria-hidden", "false");
}

function closeImageViewer() {
    if (!imageViewer || !imageViewerImage) return;
    imageViewer.classList.add("hidden");
    imageViewer.setAttribute("aria-hidden", "true");
    imageViewerImage.src = "";
    imageViewerImage.alt = "عرض صورة كبيرة";
}

function clearSelectedImage() {
    chatImage.value = "";
    chatImagePreview.hidden = true;
    chatImagePreviewImage.removeAttribute("src");
}

function renderMessages(messages) {
    if (!messages.length) {
        messagesElement.innerHTML = '<p class="no">لا توجد رسائل بعد. كن أول من يبدأ الحديث.</p>';
        return;
    }

    messagesElement.innerHTML = messages.map(message => {
        const messageText = typeof message.text === "string" ? message.text : "";
        const avatarUrl = message.userAvatar || (message.mine ? currentUser?.avatar : null);
        const avatarMarkup = avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(message.userName || "مستخدم")}" class="chat-message-avatar" data-src="${escapeHtml(avatarUrl)}">`
            : `<span class="chat-message-avatar chat-message-avatar-fallback">${escapeHtml((message.userName || "م").charAt(0))}</span>`;

        return `
            <article class="chat-message${message.mine ? " mine" : ""}">
                <div class="chat-message-actions">
                    <button class="chat-message-menu-button" type="button" aria-label="خيارات الرسالة" aria-expanded="false">⋮</button>
                    <div class="chat-message-menu" hidden>
                        <button class="chat-message-copy" type="button" data-copy-value="${escapeHtml(messageText || message.imageUrl || "")}">نسخ</button>
                        ${message.mine ? `<button class="chat-message-delete" type="button" data-message-id="${escapeHtml(message.id)}">حذف الرسالة</button>` : ""}
                    </div>
                </div>
                ${avatarMarkup}
                <div class="chat-message-body">
                    <strong>${escapeHtml(message.userName)}</strong>
                    ${message.imageUrl ? `<img class="chat-message-image" src="${escapeHtml(message.imageUrl)}" alt="صورة مرفقة" data-src="${escapeHtml(message.imageUrl)}">` : ""}
                    ${messageText ? `<p class="${messageText.length > 240 ? "is-collapsed" : ""}">${linkifyText(messageText)}</p>${messageText.length > 240 ? '<button class="chat-message-more" type="button">مشاهدة باقي الرسالة</button>' : ""}` : ""}
                    <time>${new Date(message.createdAt).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}</time>
                </div>
            </article>`;
    }).join("");

    messagesElement.querySelectorAll(".chat-message-avatar[data-src]").forEach(image => {
        image.style.cursor = "pointer";
        image.addEventListener("click", () => openImageViewer(image.dataset.src, image.alt));
    });
    messagesElement.querySelectorAll(".chat-message-image[data-src]").forEach(image => {
        image.addEventListener("click", () => openImageViewer(image.dataset.src, image.alt));
    });
    messagesElement.querySelectorAll(".chat-message-more").forEach(button => {
        button.addEventListener("click", () => {
            const text = button.previousElementSibling;
            text.classList.remove("is-collapsed");
            button.remove();
        });
    });
    messagesElement.querySelectorAll(".chat-message-menu-button").forEach(button => {
        button.addEventListener("click", () => {
            const menu = button.nextElementSibling;
            const willOpen = menu.hidden;
            messagesElement.querySelectorAll(".chat-message-menu").forEach(item => { item.hidden = true; });
            messagesElement.querySelectorAll(".chat-message-menu-button").forEach(item => item.setAttribute("aria-expanded", "false"));
            menu.hidden = !willOpen;
            button.setAttribute("aria-expanded", String(willOpen));
        });
    });
    messagesElement.querySelectorAll(".chat-message-delete").forEach(button => {
        button.addEventListener("click", async () => {
            if (!window.confirm("هل تريد حذف هذه الرسالة؟")) return;
            button.disabled = true;
            try {
                const response = await fetch(`/api/chat/messages/${encodeURIComponent(button.dataset.messageId)}`, { method: "DELETE" });
                if (!response.ok) throw new Error(await response.text());
                await loadMessages();
            } catch (error) {
                button.disabled = false;
                showStatus(error.message || "تعذر حذف الرسالة.", "error");
            }
        });
    });
    messagesElement.querySelectorAll(".chat-message-copy").forEach(button => {
        button.addEventListener("click", async () => {
            const value = button.dataset.copyValue || "";
            try {
                await navigator.clipboard.writeText(value);
                showStatus("تم نسخ الرسالة.", "success");
            } catch {
                showStatus("تعذر نسخ الرسالة.", "error");
            }
            button.closest(".chat-message-menu").hidden = true;
        });
    });

    messagesElement.scrollTop = messagesElement.scrollHeight;
}

function activateRoom(roomName) {
    currentRoom = roomName;
    roomButtons.forEach(button => {
        const isActive = button.dataset.room === roomName;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", String(isActive));
    });
    if (currentRoom === "public") {
        chatNote.textContent = "كل أعضاء رفوف المسجلين يستطيعون رؤية رسائل هذه الغرفة.";
    } else {
        chatNote.textContent = "رسائلك هنا يراها أنت ومؤسس رفوف فقط.";
    }
    showStatus("");
    loadMessages();
}

function hasValidConversationId(value) {
    return typeof value === "string" && value.trim() && /^[a-fA-F0-9]{24}$/.test(value.trim());
}

async function loadMessages() {
    try {
        const safeConversationId = hasValidConversationId(selectedConversation) ? selectedConversation : "";
        const conversationQuery = currentRoom === "founder" && selectedConversation
            ? `&conversationId=${encodeURIComponent(safeConversationId)}&conversation=${encodeURIComponent(selectedConversationEmail)}`
            : "";
        const response = await fetch(`/api/chat/messages?room=${currentRoom}${conversationQuery}`);
        if (!response.ok) throw new Error(await response.text());
        renderMessages(await response.json());
    } catch (error) {
        messagesElement.innerHTML = `<p class="no">${escapeHtml(error.message || "تعذر تحميل الرسائل")}</p>`;
    }
}

function renderConversations(conversations) {
    if (!conversations.length) {
        conversationList.innerHTML = '<p class="no">لا توجد رسائل خاصة حتى الآن.</p>';
        return;
    }
    conversationList.innerHTML = conversations.map(conversation => `
        <button class="conversation-item${conversation.id === selectedConversation ? " active" : ""}" type="button" data-id="${escapeHtml(conversation.id)}" data-email="${escapeHtml(conversation.email)}">
            ${conversation.avatar ? `<img src="${escapeHtml(conversation.avatar)}" alt="">` : '<span class="conversation-avatar">✉</span>'}
            <span><strong>${escapeHtml(conversation.name)}</strong><small>${escapeHtml(conversation.lastMessage)}</small></span>
        </button>`).join("");
    conversationList.querySelectorAll(".conversation-item").forEach(button => button.addEventListener("click", () => {
        selectedConversation = button.dataset.id;
        selectedConversationEmail = button.dataset.email;
        conversationList.querySelectorAll(".conversation-item").forEach(item => item.classList.toggle("active", item === button));
        chatNote.textContent = `محادثة خاصة مع ${button.querySelector("strong").textContent}`;
        loadMessages();
    }));
}

async function loadConversations() {
    if (!isAdmin) return;
    try {
        const response = await fetch("/api/chat/conversations");
        if (!response.ok) throw new Error(await response.text());
        const conversations = await response.json();
        renderConversations(conversations);
        if (!selectedConversation && conversations[0]) {
            selectedConversation = conversations[0].id;
            selectedConversationEmail = conversations[0].email;
            conversationList.querySelector(".conversation-item")?.click();
        }
    } catch (error) {
        conversationList.innerHTML = `<p class="no">${escapeHtml(error.message || "تعذر تحميل المحادثات")}</p>`;
    }
}

if (imageViewerClose) {
    imageViewerClose.addEventListener("click", closeImageViewer);
}

if (imageViewer) {
    imageViewer.addEventListener("click", event => {
        if (event.target === imageViewer) closeImageViewer();
    });
}

chatImage.addEventListener("change", () => {
    const file = chatImage.files[0];
    if (!file) return clearSelectedImage();
    if (!file.type.startsWith("image/") || file.size > 5 * 1024 * 1024) {
        clearSelectedImage();
        showStatus("اختر صورة صالحة لا تتجاوز 5 ميجابايت.", "error");
        return;
    }
    chatImagePreviewImage.src = URL.createObjectURL(file);
    chatImagePreview.hidden = false;
    showStatus("تم اختيار الصورة. اضغط إرسال الرسالة لنشرها.");
});

chatImageRemove.addEventListener("click", clearSelectedImage);

if (!currentUser?.email) {
    window.location.href = "index.html?auth=login&return=/chat.html";
} else {
    document.getElementById("naMe").textContent = currentUser.name || "حسابي";
    if (currentUser.avatar) document.getElementById("photo").src = currentUser.avatar;
    document.getElementById("logout").addEventListener("click", async event => {
        event.preventDefault();
        await fetch("/logout", { method: "POST" });
        localStorage.removeItem("currentUser");
        window.location.href = "index.html";
    });

    if (isAdmin) {
        founderInbox.hidden = false;
        roomButtons.forEach(button => button.hidden = true);
        chatNote.textContent = "اختر عضوًا من القائمة لعرض رسائله والرد عليه.";
        loadConversations();
    } else if (["founder", "public"].includes(requestedRoom)) {
        currentRoom = requestedRoom;
        roomPicker.hidden = true;
        chatHero.querySelector("h1").textContent = currentRoom === "founder" ? "الدردشة الخاصة" : "دردشة المجتمع";
        chatHero.querySelector("p").textContent = currentRoom === "founder"
            ? "رسائلك هنا يراها أنت ومؤسس رفوف فقط."
            : "شارك أفكارك مع أعضاء رفوف في مساحة المجتمع.";
        activateRoom(currentRoom);
    }

    roomButtons.forEach(button => button.addEventListener("click", () => {
        if (isAdmin) return;
        activateRoom(button.dataset.room);
    }));

    chatForm.addEventListener("submit", async event => {
        event.preventDefault();
        const text = chatText.value.trim();
        if (!text && !chatImage.files.length) return;
        showStatus("جارٍ إرسال الرسالة...");
        try {
            let imageUrl = "";
            if (chatImage.files.length) {
                const uploadData = new FormData();
                uploadData.append("image", chatImage.files[0]);
                const uploadResponse = await fetch("/api/chat/uploads", { method: "POST", body: uploadData });
                if (!uploadResponse.ok) throw new Error(await uploadResponse.text());
                imageUrl = (await uploadResponse.json()).imageUrl;
            }
            const response = await fetch("/api/chat/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room: currentRoom, text, imageUrl, recipientId: selectedConversation, recipientEmail: selectedConversationEmail })
            });
            if (!response.ok) throw new Error(await response.text());
            chatText.value = "";
            clearSelectedImage();
            showStatus("تم إرسال الرسالة.", "success");
            await loadMessages();
        } catch (error) {
            showStatus(error.message || "تعذر إرسال الرسالة. تأكد من إعدادات التخزين.", "error");
        }
    });

    loadMessages();
    window.setInterval(() => {
        loadMessages();
        loadConversations();
    }, 5000);
}