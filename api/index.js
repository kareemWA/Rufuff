const { app, connectDatabase } = require("../server");

module.exports = async (request, response) => {
    try {
        await connectDatabase();
        return app(request, response);
    } catch (error) {
        console.error("Database connection failed:", error.message);
        return response.status(500).send("تعذر الاتصال بقاعدة البيانات");
    }
};
