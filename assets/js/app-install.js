const installAppButton = document.getElementById("installAppButton");
let installPrompt;

if (installAppButton) {
    window.addEventListener("beforeinstallprompt", event => {
        event.preventDefault();
        installPrompt = event;
        installAppButton.hidden = false;
    });

    installAppButton.addEventListener("click", async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        await installPrompt.userChoice;
        installPrompt = null;
        installAppButton.hidden = true;
    });

    window.addEventListener("appinstalled", () => {
        installPrompt = null;
        installAppButton.hidden = true;
    });
}

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(error => {
        console.warn("تعذر تجهيز التطبيق للتثبيت", error);
    });
}
