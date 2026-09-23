const { app, connectDatabase } = require("../server");

module.exports = async (request, response) => {
    try {
        await connectDatabase();
        return app(request, response);
    } catch (error) {
        try {
            await connectDatabase();
            return app(request, response);
        } catch (retryError) {
            console.error("Database connection failed:", {
                name: retryError?.name || error?.name || "Error",
                code: retryError?.code || error?.code || "UNKNOWN",
                message: retryError?.message || error?.message || "Unknown database error"
            });
            return response.status(503).send("قاعدة البيانات غير متاحة حاليًا. حاول مرة أخرى بعد قليل.");
        }
    }
};
