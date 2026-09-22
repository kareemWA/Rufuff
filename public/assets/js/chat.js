const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
const messagesElement = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatText = document.getElementById("chatText");
const chatStatus = document.getElementById("chatStatus");
const chatNote = document.getElementById("chatNote");
const roomButtons = Array.from(document.querySelectorAll(".chat-card"));
const roomPicker = document.querySelector(".chat-cards");
const chatHero = document.getElementById("chatHero");
const founderInbox = document.getElementById("founderInbox");
const conversationList = document.getElementById("conversationList");
const isAdmin = currentUser?.role === "admin";
const requestedRoom = new URLSearchParams(window.location.search).get("room");
let currentRoom = "founder";
let selectedConversation = "";
let selectedConversationEmail = "";

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));
}

function showStatus(message, type = "") {
    chatStatus.textContent = message;
    chatStatus.className = `form-message ${type}`;
}

function renderMessages(messages) {
    if (!messages.length) {
        messagesElement.innerHTML = '<p class="no">لا توجد رسائل بعد. كن أول من يبدأ الحديث.</p>';
        return;
    }

    messagesElement.innerHTML = messages.map(message => {
        const avatarUrl = message.userAvatar || (message.mine ? currentUser?.avatar : null);
        const avatarMarkup = avatarUrl
            ? `<img src="${escapeHtml(avatarUrl)}" alt="${escapeHtml(message.userName || "مستخدم")}" class="chat-message-avatar">`
            : `<span class="chat-message-avatar chat-message-avatar-fallback">${escapeHtml((message.userName || "م").charAt(0))}</span>`;

        return `
            <article class="chat-message${message.mine ? " mine" : ""}">
                ${avatarMarkup}
                <div class="chat-message-body">
                    <strong>${escapeHtml(message.userName)}</strong>
                    <p>${escapeHtml(message.text)}</p>
                    <time>${new Date(message.createdAt).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}</time>
                </div>
            </article>`;
    }).join("");
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
        if (!text) return;
        showStatus("جارٍ إرسال الرسالة...");
        try {
            const response = await fetch("/api/chat/messages", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ room: currentRoom, text, recipientId: selectedConversation, recipientEmail: selectedConversationEmail })
            });
            if (!response.ok) throw new Error(await response.text());
            chatText.value = "";
            showStatus("تم إرسال الرسالة.", "success");
            await loadMessages();
        } catch (error) {
            showStatus(error.message || "تعذر إرسال الرسالة.", "error");
        }
    });

    loadMessages();
    window.setInterval(() => {
        loadMessages();
        loadConversations();
    }, 5000);
}