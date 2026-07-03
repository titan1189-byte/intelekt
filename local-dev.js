require("dotenv").config({ path: ".env.local" });
const { startServer } = require("./server");

startServer();
