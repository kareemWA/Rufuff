const currentUser = JSON.parse(localStorage.getItem("currentUser") || "null");
const messagesElement = document.getElementById("chatMessages");
const chatForm = document.getElementById("chatForm");
const chatText = document.getElementById("chatText");
const chatStatus = document.getElementById("chatStatus");
const chatNote = document.getElementById("chatNote");
const roomButtons = Array.from(document.querySelectorAll(".chat-tab"));
let currentRoom = "public";

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
        const response = await fetch(`/api/chat/messages?room=${currentRoom}`);
        if (!response.ok) throw new Error(await response.text());
        renderMessages(await response.json());
    } catch (error) {
        messagesElement.innerHTML = `<p class="no">${escapeHtml(error.message || "تعذر تحميل الرسائل")}</p>`;
    }
}

if (!currentUser?.email) {
    window.location.href = "signin.html";
} else {
    document.getElementById("naMe").textContent = currentUser.name || "حسابي";
    if (currentUser.avatar) document.getElementById("photo").src = currentUser.avatar;
    document.getElementById("logout").addEventListener("click", async event => {
        event.preventDefault();
        await fetch("/logout", { method: "POST" });
        localStorage.removeItem("currentUser");
        window.location.href = "signin.html";
    });

    roomButtons.forEach(button => button.addEventListener("click", () => {
        currentRoom = button.dataset.room;
        roomButtons.forEach(item => item.classList.toggle("active", item === button));
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
                body: JSON.stringify({ room: currentRoom, text })
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
    window.setInterval(loadMessages, 5000);
}