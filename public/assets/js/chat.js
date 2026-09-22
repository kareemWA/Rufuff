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
    messagesElement.innerHTML = messages.map(message => `
        <article class="chat-message${message.mine ? " mine" : ""}">
            <strong>${escapeHtml(message.userName)}</strong>
            <p>${escapeHtml(message.text)}</p>
            <time>${new Date(message.createdAt).toLocaleString("ar-EG", { dateStyle: "medium", timeStyle: "short" })}</time>
        </article>`).join("");
    messagesElement.scrollTop = messagesElement.scrollHeight;
}

async function loadMessages() {
    try {
        const conversationQuery = currentRoom === "founder" && selectedConversation
            ? `&conversationId=${encodeURIComponent(selectedConversation)}&conversation=${encodeURIComponent(selectedConversationEmail)}`
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
        chatNote.textContent = currentRoom === "public"
            ? "كل أعضاء رفوف المسجلين يستطيعون رؤية رسائل هذه الغرفة."
            : "رسائلك هنا يراها أنت ومؤسس رفوف فقط.";
    }

    roomButtons.forEach(button => button.addEventListener("click", () => {
        if (isAdmin) return;
        currentRoom = button.dataset.room;
        roomButtons.forEach(item => {
            const isActive = item === button;
            item.classList.toggle("active", isActive);
            item.setAttribute("aria-selected", String(isActive));
        });
        chatNote.textContent = currentRoom === "public"
            ? "كل أعضاء رفوف المسجلين يستطيعون رؤية رسائل هذه الغرفة."
            : "رسائلك هنا يراها أنت ومؤسس رفوف فقط.";
        showStatus("");
        loadMessages();
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