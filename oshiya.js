// ===============================
//  OSHIYA WHATSAPP BOT
//  SESSION ID BASE64
// ===============================

const {
  default: makeWASocket,
  DisconnectReason,
  BufferJSON
} = require("@whiskeysockets/baileys");

const Pino = require("pino");
const os = require("os");
const { SESSION_ID } = require("./session");

// ===============================
// BOT SETTINGS
// ===============================
const settings = {
  botName: "OSHIYA-BOT",
  ownerName: "Oshadha",
  prefix: "."
};

// ===============================
// LOAD SESSION FROM BASE64
// ===============================
function loadSession() {
  const decoded = Buffer.from(SESSION_ID, "base64").toString();
  return JSON.parse(decoded, BufferJSON.reviver);
}

// ===============================
// START BOT
// ===============================
async function startBot() {
  let auth;
  try {
    auth = loadSession();
  } catch (e) {
    console.log("❌ Invalid Session ID");
    process.exit(1);
  }

  const sock = makeWASocket({
    auth,
    logger: Pino({ level: "silent" }),
    browser: ["Oshiya Bot", "Chrome", "1.0"]
  });

  // ===============================
  // CONNECTION
  // ===============================
  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;

    if (connection === "open") {
      console.log("✅ WhatsApp Connected");
    }

    if (connection === "close") {
      const reason = lastDisconnect?.error?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log("♻ Reconnecting...");
        startBot();
      } else {
        console.log("❌ Session Logged Out");
      }
    }
  });

  // ===============================
  // MESSAGE HANDLER
  // ===============================
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const m = messages[0];
    if (!m?.message || m.key.fromMe) return;

    const from = m.key.remoteJid;
    const pushName = m.pushName || "User";

    const text =
      m.message.conversation ||
      m.message.extendedTextMessage?.text ||
      "";

    if (!text.startsWith(settings.prefix)) return;

    const cmd = text.slice(1).toLowerCase();

    // ===============================
    // ALIVE PLUGIN
    // ===============================
    if (cmd === "alive") {
      await sock.sendMessage(from, {
        text: `
🤖 *${settings.botName} ALIVE*

👤 User : ${pushName}
👑 Owner : ${settings.ownerName}

🕒 Time : ${new Date().toLocaleTimeString()}
📅 Date : ${new Date().toLocaleDateString()}
💻 OS : ${os.platform()}
        `
      });
    }

    // ===============================
    // MENU
    // ===============================
    if (cmd === "menu") {
      await sock.sendMessage(from, {
        text: `
📜 *${settings.botName} MENU*

.alive
.menu
.ping
        `
      });
    }

    // ===============================
    // PING
    // ===============================
    if (cmd === "ping") {
      await sock.sendMessage(from, { text: "🏓 Pong!" });
    }
  });
}

startBot();