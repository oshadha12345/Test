import express from "express";
import fs from "fs";
import pino from "pino";

import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

import QRCode from "qrcode";
import { upload } from "./mongodb.js";

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error("Error removing file:", e);
    }
}

router.get("/", async (req, res) => {
    const sessionId =
        Date.now().toString() + Math.random().toString(36).substr(2, 9);

    const dirs = `./qr_sessions/session_${sessionId}`;

    if (!fs.existsSync("./qr_sessions")) {
        fs.mkdirSync("./qr_sessions", { recursive: true });
    }

    await removeFile(dirs);

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();
            let responseSent = false;

            const KnightBot = makeWASocket({
                version,
                auth: {
                    creds: state.creds,
                    keys: makeCacheableSignalKeyStore(
                        state.keys,
                        pino({ level: "fatal" })
                    ),
                },
                printQRInTerminal: false,
                logger: pino({ level: "fatal" }),
                browser: Browsers.windows("Chrome"),
                markOnlineOnConnect: false,
            });

            KnightBot.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect, qr } = update;

                // ======================
                // QR SEND TO CLIENT
                // ======================
                if (qr && !responseSent) {
                    try {
                        const qrDataURL = await QRCode.toDataURL(qr);

                        responseSent = true;

                        res.send({
                            qr: qrDataURL,
                            message: "Scan QR with WhatsApp",
                            instructions: [
                                "Open WhatsApp",
                                "Go to Linked Devices",
                                "Tap Link a Device",
                                "Scan this QR",
                            ],
                        });

                        console.log("🟢 QR sent to client");
                    } catch (err) {
                        console.error("QR error:", err);
                        if (!responseSent) {
                            responseSent = true;
                            res.status(500).send({ error: "QR generation failed" });
                        }
                    }
                }

                // ======================
                // ON SUCCESS LOGIN
                // ======================
                if (connection === "open") {
                    console.log("✅ Connected successfully!");
                    console.log("💾 Saving session to MongoDB...");

                    try {
                        const credsPath = dirs + "/creds.json";

                        // Save session to MongoDB
                        await upload(credsPath, `creds_${sessionId}.json`);

                        console.log("✅ Session saved to MongoDB");

                        // Clean local files
                        await delay(1000);
                        removeFile(dirs);

                        console.log("🧹 Session folder cleaned");
                        console.log("🎉 Done!");

                        await delay(2000);
                        process.exit(0);

                    } catch (error) {
                        console.error("MongoDB save error:", error);
                        removeFile(dirs);
                        await delay(2000);
                        process.exit(1);
                    }
                }

                // ======================
                // HANDLE DISCONNECT
                // ======================
                if (connection === "close") {
                    const statusCode =
                        lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out. Need new QR.");
                    } else {
                        console.log("🔁 Restarting session...");
                        initiateSession();
                    }
                }
            });

            KnightBot.ev.on("creds.update", saveCreds);

            // ======================
            // QR Timeout
            // ======================
            setTimeout(() => {
                if (!responseSent) {
                    responseSent = true;
                    res.status(408).send({ error: "QR timeout" });
                    removeFile(dirs);
                    setTimeout(() => process.exit(1), 2000);
                }
            }, 30000);

        } catch (err) {
            console.error("Initialization error:", err);
            if (!res.headersSent) {
                res.status(503).send({ error: "Service Unavailable" });
            }
            removeFile(dirs);
            setTimeout(() => process.exit(1), 2000);
        }
    }

    await initiateSession();
});

// Global error protection
process.on("uncaughtException", (err) => {
    console.log("Caught exception:", err);
    process.exit(1);
});

export default router;
