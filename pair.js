import express from "express";
import fs from "fs";
import pino from "pino";
import pn from "awesome-phonenumber";

import {
    makeWASocket,
    useMultiFileAuthState,
    delay,
    makeCacheableSignalKeyStore,
    Browsers,
    fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";

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

    let num = req.query.number;

    if (!num) {
        return res.status(400).send({
            code: "Phone number required"
        });
    }

    let dirs = "./session_" + num;

    await removeFile(dirs);

    // clean number
    num = num.replace(/[^0-9]/g, "");

    const phone = pn("+" + num);

    if (!phone.isValid()) {
        return res.status(400).send({
            code: "Invalid phone number"
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
                markOnlineOnConnect: false,

            });

            // ============================
            // CONNECTION UPDATE
            // ============================

            KnightBot.ev.on("connection.update", async (update) => {

                const { connection, lastDisconnect, isNewLogin } = update;

                if (connection === "open") {

                    console.log("✅ WhatsApp Connected");
                    console.log("💾 Saving session to MongoDB...");

                    try {

                        const credsPath = dirs + "/creds.json";

                        // SAVE TO MONGODB
                        await upload(
                            credsPath,
                            `creds_${num}.json`
                        );

                        console.log("✅ Session saved to MongoDB");

                        // CLEAN FILES
                        await delay(1000);
                        removeFile(dirs);

                        console.log("🧹 Session folder removed");

                        await delay(2000);

                        process.exit(0);

                    } catch (err) {

                        console.log("MongoDB save error:", err);

                        removeFile(dirs);

                        process.exit(1);

                    }

                }

                if (isNewLogin) {
                    console.log("🔐 New login via pair code");
                }

                if (connection === "close") {

                    const statusCode =
                        lastDisconnect?.error?.output?.statusCode;

                    if (statusCode === 401) {

                        console.log("❌ Logged out");

                    } else {

                        console.log("🔁 Reconnecting...");
                        initiateSession();

                    }

                }

            });

            // ============================
            // REQUEST PAIR CODE
            // ============================

            if (!KnightBot.authState.creds.registered) {

                await delay(3000);

                try {

                    let code =
                        await KnightBot.requestPairingCode(num);

                    code =
                        code?.match(/.{1,4}/g)?.join("-") || code;

                    console.log("Pair code:", code);

                    return res.send({
                        code: code
                    });

                } catch (err) {

                    console.log(err);

                    return res.status(500).send({
                        code: "Pair code failed"
                    });

                }

            }

            KnightBot.ev.on("creds.update", saveCreds);

        } catch (err) {

            console.log(err);

            return res.status(500).send({
                code: "Server error"
            });

        }

    }

    await initiateSession();

});

export default router;
