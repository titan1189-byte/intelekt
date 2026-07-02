const { onRequest } = require("firebase-functions/v2/https");
const { requestHandler } = require("./server");

exports.app = onRequest(
  {
    region: process.env.FIREBASE_FUNCTION_REGION || "europe-west1",
    timeoutSeconds: 120,
    memory: "512MiB"
  },
  requestHandler
);
