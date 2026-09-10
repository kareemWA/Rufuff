(() => {
    const supportLabel = document.createElement("button");
    supportLabel.type = "button";
    supportLabel.className = "support-label";
    supportLabel.textContent = "هنا الدعم الفني💬";
    supportLabel.setAttribute("aria-label", "فتح الدعم الفني");
    supportLabel.addEventListener("click", () => {
        if (typeof window.Tawk_API?.toggle === "function") {
            window.Tawk_API.toggle();
        }
    });
    document.body.appendChild(supportLabel);

    const user = JSON.parse(localStorage.getItem("currentUser") || "null");
    const visitor = { name: user?.name || "زائر متجر رفوف" };
    if (user?.email) visitor.email = user.email;
    if (user?.phone) visitor.phone = user.phone;

    function configureSupport() {
        if (!window.Tawk_API || typeof window.Tawk_API.setAttributes !== "function") return false;
        window.Tawk_API.setAttributes(visitor, error => {
            if (error) console.warn("تعذر تعريف زائر الدعم الفني", error);
        });
        return true;
    }

    if (!configureSupport()) {
        window.Tawk_API = window.Tawk_API || {};
        const previousOnLoad = window.Tawk_API.onLoad;
        window.Tawk_API.onLoad = () => {
            if (typeof previousOnLoad === "function") previousOnLoad();
            configureSupport();
        };
    }

    function moveWidgetToLeft() {
        document.querySelectorAll('iframe[style*="position:fixed"]').forEach(frame => {
            const style = frame.getAttribute("style") || "";
            if (!style.includes("z-index:100000")) return;
            frame.style.setProperty("left", "20px", "important");
            frame.style.setProperty("right", "auto", "important");
        });
    }

    moveWidgetToLeft();
    new MutationObserver(moveWidgetToLeft).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["style"] });
})();
