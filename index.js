require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const TelegramBot = require("node-telegram-bot-api");

const Bot = TelegramBot.default || TelegramBot;

// ============================================================
// CONFIGURATION
// ============================================================

const MANAGER_BOT_TOKEN = process.env.MANAGER_BOT_TOKEN;
const OWNER_ID = String(process.env.OWNER_ID || "");
const MASTER_KEY_HEX = process.env.MASTER_KEY;

if (!MANAGER_BOT_TOKEN) {
    throw new Error("MANAGER_BOT_TOKEN is missing from .env");
}

if (!OWNER_ID) {
    throw new Error("OWNER_ID is missing from .env");
}

if (!MASTER_KEY_HEX || MASTER_KEY_HEX.length !== 64) {
    throw new Error(
        "MASTER_KEY must be exactly 64 hexadecimal characters."
    );
}

const MASTER_KEY = Buffer.from(MASTER_KEY_HEX, "hex");


// ============================================================
// FILES
// ============================================================

const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "database.json");

if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, {
        recursive: true
    });
}

if (!fs.existsSync(DB_FILE)) {
    fs.writeFileSync(
        DB_FILE,
        JSON.stringify(
            {
                bots: {},
                lastTicket: 0
            },
            null,
            4
        )
    );
}


// ============================================================
// DATABASE
// ============================================================

let db = loadDB();

function loadDB() {
    try {
        const data = fs.readFileSync(DB_FILE, "utf8");

        const parsed = JSON.parse(data);

        if (!parsed.bots) {
            parsed.bots = {};
        }

        if (!parsed.lastTicket) {
            parsed.lastTicket = 0;
        }

        return parsed;

    } catch (error) {

        console.error("Could not load database:", error);

        return {
            bots: {},
            lastTicket: 0
        };
    }
}


function saveDB() {

    const tempFile = `${DB_FILE}.tmp`;

    fs.writeFileSync(
        tempFile,
        JSON.stringify(db, null, 4)
    );

    fs.renameSync(
        tempFile,
        DB_FILE
    );
}


// ============================================================
// ENCRYPTION
// ============================================================

function encrypt(text) {

    const iv = crypto.randomBytes(12);

    const cipher = crypto.createCipheriv(
        "aes-256-gcm",
        MASTER_KEY,
        iv
    );

    const encrypted = Buffer.concat([
        cipher.update(text, "utf8"),
        cipher.final()
    ]);

    const authTag = cipher.getAuthTag();

    return [
        iv.toString("hex"),
        authTag.toString("hex"),
        encrypted.toString("hex")
    ].join(":");
}


function decrypt(payload) {

    const parts = payload.split(":");

    if (parts.length !== 3) {
        throw new Error("Invalid encrypted token.");
    }

    const iv = Buffer.from(parts[0], "hex");
    const authTag = Buffer.from(parts[1], "hex");
    const encrypted = Buffer.from(parts[2], "hex");

    const decipher = crypto.createDecipheriv(
        "aes-256-gcm",
        MASTER_KEY,
        iv
    );

    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
        decipher.update(encrypted),
        decipher.final()
    ]);

    return decrypted.toString("utf8");
}


// ============================================================
// MANAGER BOT
// ============================================================

const managerBot = new Bot(
    MANAGER_BOT_TOKEN,
    {
        polling: true
    }
);

managerBot.on(
    "polling_error",
    (error) => {
        console.error(
            "Manager polling error:",
            error.message || error
        );
    }
);

console.log("=================================");
console.log("Telegram Support Manager Started");
console.log("=================================");


// ============================================================
// RUNTIME STORAGE
// ============================================================

// Every running support bot lives here.
//
// Example:
//
// 123456789
//      -> TelegramBot instance
//
// 987654321
//      -> TelegramBot instance

const runningBots = new Map();


// Manager states.
// Used when the manager is waiting for a bot token.

const managerState = new Map();


// ============================================================
// HELPERS
// ============================================================

function isOwner(msg) {

    return String(msg.from.id) === OWNER_ID;
}


function botKey(botId) {

    return String(botId);
}


function getBotRecord(botId) {

    return db.bots[botKey(botId)];
}


function getAgentIds(botRecord) {

    if (!botRecord.agents) {
        botRecord.agents = [];
    }

    return botRecord.agents.map(String);
}


function isAgent(botRecord, userId) {

    return getAgentIds(botRecord).includes(
        String(userId)
    );
}


function userLabel(user) {

    const name =
        user.first_name ||
        "Unknown User";

    const username =
        user.username
            ? `@${user.username}`
            : "No username";

    return `${name} (${username})`;
}


function ticketKeyboard(ticketId) {

    return {
        reply_markup: {
            inline_keyboard: [
                [
                    {
                        text: "💬 Reply",
                        callback_data: `reply_${ticketId}`
                    },
                    {
                        text: "🔒 Close",
                        callback_data: `close_${ticketId}`
                    }
                ]
            ]
        }
    };
}


// ============================================================
// /START MANAGER
// ============================================================

managerBot.onText(
    /^\/start$/,
    async (msg) => {

        if (!isOwner(msg)) {

            await managerBot.sendMessage(
                msg.chat.id,
                "❌ Access Denied.\n\nYou are not authorized to use this manager."
            );

            return;
        }

        await showManagerMenu(
            msg.chat.id
        );
    }
);


// ============================================================
// MANAGER MENU
// ============================================================

async function showManagerMenu(chatId) {

    await managerBot.sendMessage(
        chatId,

        `👋 Welcome to Support Manager.

This bot allows you to register and manage your private Telegram support bots.

Choose an option below:`,

        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "➕ Register Support Bot",
                            callback_data: "register_bot"
                        }
                    ],
                    [
                        {
                            text: "🤖 My Support Bots",
                            callback_data: "my_bots"
                        }
                    ],
                    [
                        {
                            text: "🆔 My Telegram ID",
                            callback_data: "my_id"
                        }
                    ]
                ]
            }
        }
    );
}


// ============================================================
// MANAGER CALLBACKS
// ============================================================

managerBot.on(
    "callback_query",
    async (query) => {

        try {

            if (String(query.from.id) !== OWNER_ID) {

                await managerBot.answerCallbackQuery(
                    query.id,
                    {
                        text: "Access denied."
                    }
                );

                return;
            }

            const data = query.data || "";

            // --------------------------------------------
            // REGISTER BOT
            // --------------------------------------------

            if (data === "register_bot") {

                managerState.set(
                    String(query.from.id),
                    {
                        type: "WAITING_FOR_TOKEN"
                    }
                );

                await managerBot.answerCallbackQuery(
                    query.id
                );

                await managerBot.sendMessage(
                    query.message.chat.id,

                    `🔑 Send your bot token from @BotFather.

Example:

123456789:ABCxxxxxxxxxxxxxxxxxxxxxxxx

⚠️ Do not send a token that belongs to your Manager Bot.

Send /cancel to stop.`
                );

                return;
            }


            // --------------------------------------------
            // MY BOTS
            // --------------------------------------------

            if (data === "my_bots") {

                await managerBot.answerCallbackQuery(
                    query.id
                );

                await showMyBots(
                    query.message.chat.id
                );

                return;
            }


            // --------------------------------------------
            // MY ID
            // --------------------------------------------

            if (data === "my_id") {

                await managerBot.answerCallbackQuery(
                    query.id
                );

                await managerBot.sendMessage(
                    query.message.chat.id,

                    `🆔 Your Telegram ID:

${query.from.id}`
                );

                return;
            }


            // --------------------------------------------
            // BOT MENU
            // --------------------------------------------

            if (data.startsWith("botmenu_")) {

                const botId =
                    data.replace(
                        "botmenu_",
                        ""
                    );

                await managerBot.answerCallbackQuery(
                    query.id
                );

                await showBotMenu(
                    query.message.chat.id,
                    botId
                );

                return;
            }


            // --------------------------------------------
            // SET WELCOME MESSAGE
            // --------------------------------------------

            if (data.startsWith("welcome_")) {

                const botId =
                    data.replace(
                        "welcome_",
                        ""
                    );

                const record =
                    getBotRecord(botId);

                if (!record) {

                    await managerBot.answerCallbackQuery(
                        query.id,
                        {
                            text: "Bot not found."
                        }
                    );

                    return;
                }

                managerState.set(
                    String(query.from.id),
                    {
                        type: "WAITING_FOR_WELCOME",
                        botId: botId
                    }
                );

                await managerBot.answerCallbackQuery(
                    query.id
                );

                await managerBot.sendMessage(
                    query.message.chat.id,

                    `💬 Send the new welcome message for @${record.username}.

Send /cancel to stop.`
                );

                return;
            }


            // --------------------------------------------
            // ADD AGENT
            // --------------------------------------------

            if (data.startsWith("addagent_")) {

                const botId =
                    data.replace(
                        "addagent_",
                        ""
                    );

                const record =
                    getBotRecord(botId);

                if (!record) {

                    await managerBot.answerCallbackQuery(
                        query.id,
                        {
                            text: "Bot not found."
                        }
                    );

                    return;
                }

                managerState.set(
                    String(query.from.id),
                    {
                        type: "WAITING_FOR_AGENT",
                        botId: botId
                    }
                );

                await managerBot.answerCallbackQuery(
                    query.id
                );

                await managerBot.sendMessage(
                    query.message.chat.id,

                    `👨‍💼 Send the Telegram user ID of the support agent.

Example:

123456789

The agent must also open @${record.username} and press Start.

Send /cancel to stop.`
                );

                return;
            }


            // --------------------------------------------
            // LIST AGENTS
            // --------------------------------------------

            if (data.startsWith("agents_")) {

                const botId =
                    data.replace(
                        "agents_",
                        ""
                    );

                const record =
                    getBotRecord(botId);

                if (!record) {

                    await managerBot.answerCallbackQuery(
                        query.id,
                        {
                            text: "Bot not found."
                        }
                    );

                    return;
                }

                await managerBot.answerCallbackQuery(
                    query.id
                );

                const agents =
                    getAgentIds(record);

                const text =
                    agents.length === 0

                        ? "👨‍💼 No support agents configured."

                        : `👨‍💼 Support agents:

${agents.map(
    (id, index) =>
        `${index + 1}. ${id}`
).join("\n")}`;

                await managerBot.sendMessage(
                    query.message.chat.id,
                    text
                );

                return;
            }


            // --------------------------------------------
            // STOP BOT
            // --------------------------------------------

            if (data.startsWith("stop_")) {

                const botId =
                    data.replace(
                        "stop_",
                        ""
                    );

                await managerBot.answerCallbackQuery(
                    query.id
                );

                await stopSupportBot(
                    botId
                );

                await managerBot.sendMessage(
                    query.message.chat.id,
                    `🛑 Support bot #${botId} stopped.`
                );

                return;
            }


            // --------------------------------------------
            // START BOT
            // --------------------------------------------

            if (data.startsWith("start_")) {

                const botId =
                    data.replace(
                        "start_",
                        ""
                    );

                await managerBot.answerCallbackQuery(
                    query.id
                );

                await startSupportBot(
                    botId
                );

                await managerBot.sendMessage(
                    query.message.chat.id,
                    `▶️ Support bot #${botId} started.`
                );

                return;
            }

        } catch (error) {

            console.error(
                "Manager callback error:",
                error
            );

            try {

                await managerBot.answerCallbackQuery(
                    query.id,
                    {
                        text: "Something went wrong."
                    }
                );

            } catch (_) {}

        }
    }
);


// ============================================================
// MANAGER MESSAGE HANDLER
// ============================================================

managerBot.on(
    "message",
    async (msg) => {

        try {

            if (!isOwner(msg)) {
                return;
            }

            if (!msg.text) {
                return;
            }

            const userId =
                String(msg.from.id);

            const state =
                managerState.get(userId);

            if (!state) {
                return;
            }

            // --------------------------------------------
            // CANCEL
            // --------------------------------------------

            if (
                msg.text.trim().toLowerCase() ===
                "/cancel"
            ) {

                managerState.delete(
                    userId
                );

                await managerBot.sendMessage(
                    msg.chat.id,
                    "❌ Cancelled."
                );

                return;
            }


            // --------------------------------------------
            // WAITING FOR BOT TOKEN
            // --------------------------------------------

            if (
                state.type ===
                "WAITING_FOR_TOKEN"
            ) {

                const token =
                    msg.text.trim();

                managerState.delete(
                    userId
                );

                await registerSupportBot(
                    msg.chat.id,
                    token
                );

                return;
            }


            // --------------------------------------------
            // WAITING FOR WELCOME
            // --------------------------------------------

            if (
                state.type ===
                "WAITING_FOR_WELCOME"
            ) {

                const record =
                    getBotRecord(
                        state.botId
                    );

                if (!record) {

                    managerState.delete(
                        userId
                    );

                    await managerBot.sendMessage(
                        msg.chat.id,
                        "❌ Bot not found."
                    );

                    return;
                }

                record.welcomeMessage =
                    msg.text;

                saveDB();

                managerState.delete(
                    userId
                );

                await managerBot.sendMessage(
                    msg.chat.id,

                    `✅ Welcome message updated for @${record.username}.`
                );

                return;
            }


            // --------------------------------------------
            // WAITING FOR AGENT
            // --------------------------------------------

            if (
                state.type ===
                "WAITING_FOR_AGENT"
            ) {

                const agentId =
                    msg.text.trim();

                if (!/^\d+$/.test(agentId)) {

                    await managerBot.sendMessage(
                        msg.chat.id,
                        "❌ Invalid Telegram user ID.\n\nIt should contain numbers only."
                    );

                    return;
                }

                const record =
                    getBotRecord(
                        state.botId
                    );

                if (!record) {

                    managerState.delete(
                        userId
                    );

                    await managerBot.sendMessage(
                        msg.chat.id,
                        "❌ Bot not found."
                    );

                    return;
                }

                if (!record.agents) {
                    record.agents = [];
                }

                if (
                    !record.agents
                        .map(String)
                        .includes(agentId)
                ) {

                    record.agents.push(
                        Number(agentId)
                    );
                }

                saveDB();

                managerState.delete(
                    userId
                );

                await managerBot.sendMessage(
                    msg.chat.id,

                    `✅ Agent ${agentId} added to @${record.username}.

⚠️ The agent must now open @${record.username} and press Start before the bot can send tickets to that private chat.`
                );

                return;
            }

        } catch (error) {

            console.error(
                "Manager message error:",
                error
            );

        }
    }
);


// ============================================================
// SHOW MY BOTS
// ============================================================

async function showMyBots(chatId) {

    const records =
        Object.values(db.bots);

    if (records.length === 0) {

        await managerBot.sendMessage(
            chatId,

            `🤖 You don't have any registered support bots yet.

Click "Register Support Bot" to add one.`,

            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "➕ Register Support Bot",
                                callback_data: "register_bot"
                            }
                        ]
                    ]
                }
            }
        );

        return;
    }

    for (const record of records) {

        const running =
            runningBots.has(
                String(record.id)
            );

        await managerBot.sendMessage(
            chatId,

            `🤖 ${record.name}

📛 @${record.username}

🆔 ${record.id}

Status:
${running ? "🟢 Running" : "🔴 Stopped"}`,

            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "⚙️ Manage",
                                callback_data:
                                    `botmenu_${record.id}`
                            }
                        ]
                    ]
                }
            }
        );
    }
}


// ============================================================
// BOT MANAGEMENT MENU
// ============================================================

async function showBotMenu(
    chatId,
    botId
) {

    const record =
        getBotRecord(botId);

    if (!record) {

        await managerBot.sendMessage(
            chatId,
            "❌ Bot not found."
        );

        return;
    }

    const running =
        runningBots.has(
            String(botId)
        );

    await managerBot.sendMessage(
        chatId,

        `⚙️ Manage Support Bot

🤖 ${record.name}
📛 @${record.username}
🆔 ${record.id}

Status:
${running ? "🟢 Running" : "🔴 Stopped"}`,

        {
            reply_markup: {
                inline_keyboard: [
                    [
                        {
                            text: "💬 Welcome Message",
                            callback_data:
                                `welcome_${botId}`
                        }
                    ],
                    [
                        {
                            text: "👨‍💼 Add Agent",
                            callback_data:
                                `addagent_${botId}`
                        },
                        {
                            text: "👥 View Agents",
                            callback_data:
                                `agents_${botId}`
                        }
                    ],
                    [
                        {
                            text: running
                                ? "🛑 Stop Bot"
                                : "▶️ Start Bot",

                            callback_data: running
                                ? `stop_${botId}`
                                : `start_${botId}`
                        }
                    ]
                ]
            }
        }
    );
}


// ============================================================
// REGISTER SUPPORT BOT
// ============================================================

async function registerSupportBot(
    adminChatId,
    token
) {

    // Don't allow the manager token to be registered
    // as a support bot.

    if (token === MANAGER_BOT_TOKEN) {

        await managerBot.sendMessage(
            adminChatId,

            "❌ You cannot register the Manager Bot as a support bot."
        );

        return;
    }

    let supportBot = null;

    try {

        await managerBot.sendMessage(
            adminChatId,
            "🔎 Verifying your bot token..."
        );

        supportBot = new Bot(
            token,
            {
                polling: true
            }
        );

        supportBot.on(
            "polling_error",
            (error) => {

                console.error(
                    "Support bot polling error:",
                    error.message || error
                );

            }
        );

        const botInfo =
            await supportBot.getMe();

        console.log(
            `Verified bot @${botInfo.username}`
        );

        const botId =
            String(botInfo.id);

        // Check if already registered

        if (db.bots[botId]) {

            try {
                await supportBot.stopPolling();
            } catch (_) {}

            await managerBot.sendMessage(
                adminChatId,

                `⚠️ This bot is already registered.

🤖 ${botInfo.first_name}
📛 @${botInfo.username}`
            );

            return;
        }

        // Store encrypted token

        db.bots[botId] = {

            id: Number(botInfo.id),

            name:
                botInfo.first_name ||
                "Support Bot",

            username:
                botInfo.username ||
                "",

            token:
                encrypt(token),

            welcomeMessage:
                `👋 Welcome to ${botInfo.first_name || "Support"}.

What can this bot do? 🔍

Lodge your complaint below and send it to open a support ticket.`,

            agents: [
                Number(OWNER_ID)
            ],

            created:
                new Date().toISOString(),

            tickets: {}

        };

        saveDB();

        runningBots.set(
            botId,
            supportBot
        );

        attachSupportBotHandlers(
            supportBot,
            db.bots[botId]
        );

        await managerBot.sendMessage(
            adminChatId,

            `✅ Bot registered successfully!

🤖 ${botInfo.first_name}
📛 @${botInfo.username}
🆔 ${botInfo.id}

🟢 Support bot is now running.

The default support agent is your OWNER_ID.

⚠️ Open @${botInfo.username} and press Start from your support/admin account so the bot can send tickets to you.`,

            {
                reply_markup: {
                    inline_keyboard: [
                        [
                            {
                                text: "⚙️ Manage Bot",
                                callback_data:
                                    `botmenu_${botId}`
                            }
                        ]
                    ]
                }
            }
        );

    } catch (error) {

        console.error(
            "Register bot error:",
            error
        );

        if (supportBot) {

            try {
                await supportBot.stopPolling();
            } catch (_) {}

        }

        await managerBot.sendMessage(
            adminChatId,

            `❌ Could not register this bot.

Telegram returned:

${error.message || error}

Please check that the token came from @BotFather and try again.`
        );
    }
}


// ============================================================
// START A SAVED SUPPORT BOT
// ============================================================

async function startSupportBot(
    botId
) {

    botId = String(botId);

    if (runningBots.has(botId)) {
        return;
    }

    const record =
        getBotRecord(botId);

    if (!record) {
        throw new Error(
            "Support bot does not exist."
        );
    }

    const token =
        decrypt(record.token);

    const supportBot =
        new Bot(
            token,
            {
                polling: true
            }
        );

    supportBot.on(
        "polling_error",
        (error) => {

            console.error(
                `Polling error for @${record.username}:`,
                error.message || error
            );

        }
    );

    // Verify token before registering handlers

    await supportBot.getMe();

    runningBots.set(
        botId,
        supportBot
    );

    attachSupportBotHandlers(
        supportBot,
        record
    );

    console.log(
        `Started support bot @${record.username}`
    );
}


// ============================================================
// STOP SUPPORT BOT
// ============================================================

async function stopSupportBot(
    botId
) {

    botId = String(botId);

    const supportBot =
        runningBots.get(botId);

    if (!supportBot) {
        return;
    }

    try {

        await supportBot.stopPolling();

    } catch (error) {

        console.error(
            "Error stopping bot:",
            error
        );

    }

    runningBots.delete(
        botId
    );

    console.log(
        `Stopped support bot #${botId}`
    );
}


// ============================================================
// FIND OR CREATE TICKET
// ============================================================

function findOpenTicket(
    record,
    userId
) {

    const tickets =
        Object.values(
            record.tickets || {}
        );

    return tickets.find(
        ticket =>
            String(ticket.userId) ===
            String(userId) &&
            ticket.status === "OPEN"
    );
}


function createTicket(
    record,
    msg
) {

    db.lastTicket++;

    const ticketId =
        db.lastTicket;

    if (!record.tickets) {
        record.tickets = {};
    }

    const ticket = {

        id: ticketId,

        userId:
            msg.chat.id,

        name:
            msg.from.first_name ||
            "Unknown",

        username:
            msg.from.username ||
            "",

        status:
            "OPEN",

        created:
            new Date().toISOString(),

        messages: []

    };

    record.tickets[ticketId] =
        ticket;

    saveDB();

    return ticket;
}


// ============================================================
// SAVE CUSTOMER MESSAGE
// ============================================================

function saveCustomerMessage(
    ticket,
    msg
) {

    let type = "unknown";
    let content = null;

    if (msg.text) {

        type = "text";

        content =
            msg.text;

    } else if (msg.photo) {

        type = "photo";

        content =
            msg.photo[
                msg.photo.length - 1
            ].file_id;

    } else if (msg.document) {

        type = "document";

        content =
            msg.document.file_id;

    } else if (msg.video) {

        type = "video";

        content =
            msg.video.file_id;

    } else if (msg.audio) {

        type = "audio";

        content =
            msg.audio.file_id;

    } else if (msg.voice) {

        type = "voice";

        content =
            msg.voice.file_id;

    } else if (msg.sticker) {

        type = "sticker";

        content =
            msg.sticker.file_id;
    }

    ticket.messages.push({

        from: "user",

        type,

        content,

        date:
            new Date().toISOString()

    });

    saveDB();
}


// ============================================================
// SAVE ADMIN MESSAGE
// ============================================================

function saveAdminMessage(
    ticket,
    msg
) {

    let type = "unknown";
    let content = null;

    if (msg.text) {

        type = "text";

        content =
            msg.text;

    } else if (msg.photo) {

        type = "photo";

        content =
            msg.photo[
                msg.photo.length - 1
            ].file_id;

    } else if (msg.document) {

        type = "document";

        content =
            msg.document.file_id;

    } else if (msg.video) {

        type = "video";

        content =
            msg.video.file_id;

    } else if (msg.audio) {

        type = "audio";

        content =
            msg.audio.file_id;

    } else if (msg.voice) {

        type = "voice";

        content =
            msg.voice.file_id;

    } else if (msg.sticker) {

        type = "sticker";

        content =
            msg.sticker.file_id;
    }

    ticket.messages.push({

        from: "admin",

        type,

        content,

        date:
            new Date().toISOString()

    });

    saveDB();
}


// ============================================================
// SEND TICKET HEADER TO AGENT
// ============================================================

async function sendTicketHeader(
    supportBot,
    agentId,
    ticket,
    msg
) {

    const username =
        msg.from.username
            ? `@${msg.from.username}`
            : "No username";

    await supportBot.sendMessage(

        agentId,

        `🎫 SUPPORT TICKET #${ticket.id}

🤖 Support Bot:
@${(await supportBot.getMe()).username}

👤 Customer:
${msg.from.first_name || "Unknown"}

📛 Username:
${username}

🆔 Customer ID:
${msg.chat.id}

Status:
🟢 OPEN`,

        ticketKeyboard(
            ticket.id
        )
    );
}


// ============================================================
// FORWARD CUSTOMER MESSAGE TO AGENTS
// ============================================================

async function forwardCustomerMessage(
    supportBot,
    record,
    ticket,
    msg
) {

    const agents =
        getAgentIds(record);

    if (agents.length === 0) {

        console.warn(
            `No agents configured for @${record.username}`
        );

        return;
    }

    // New ticket gets a header first

    const isFirstMessage =
        ticket.messages.length === 1;

    for (const agentId of agents) {

        try {

            if (isFirstMessage) {

                await sendTicketHeader(
                    supportBot,
                    agentId,
                    ticket,
                    msg
                );
            }

            // ----------------------------------------
            // TEXT
            // ----------------------------------------

            if (msg.text) {

                await supportBot.sendMessage(
                    agentId,

                    `💬 Customer message:

${msg.text}`,

                    ticketKeyboard(
                        ticket.id
                    )
                );

                continue;
            }


            // ----------------------------------------
            // PHOTO
            // ----------------------------------------

            if (msg.photo) {

                const fileId =
                    msg.photo[
                        msg.photo.length - 1
                    ].file_id;

                await supportBot.sendPhoto(
                    agentId,
                    fileId,
                    {
                        caption:
                            `📷 Customer sent a photo.\n\n🎫 Ticket #${ticket.id}`,

                        reply_markup:
                            ticketKeyboard(
                                ticket.id
                            ).reply_markup
                    }
                );

                continue;
            }


            // ----------------------------------------
            // DOCUMENT
            // ----------------------------------------

            if (msg.document) {

                await supportBot.sendDocument(
                    agentId,
                    msg.document.file_id,
                    {
                        caption:
                            `📄 Customer sent a document.\n\n🎫 Ticket #${ticket.id}`,

                        reply_markup:
                            ticketKeyboard(
                                ticket.id
                            ).reply_markup
                    }
                );

                continue;
            }


            // ----------------------------------------
            // VIDEO
            // ----------------------------------------

            if (msg.video) {

                await supportBot.sendVideo(
                    agentId,
                    msg.video.file_id,
                    {
                        caption:
                            `🎥 Customer sent a video.\n\n🎫 Ticket #${ticket.id}`,

                        reply_markup:
                            ticketKeyboard(
                                ticket.id
                            ).reply_markup
                    }
                );

                continue;
            }


            // ----------------------------------------
            // AUDIO
            // ----------------------------------------

            if (msg.audio) {

                await supportBot.sendAudio(
                    agentId,
                    msg.audio.file_id,
                    {
                        caption:
                            `🎵 Customer sent audio.\n\n🎫 Ticket #${ticket.id}`,

                        reply_markup:
                            ticketKeyboard(
                                ticket.id
                            ).reply_markup
                    }
                );

                continue;
            }


            // ----------------------------------------
            // VOICE
            // ----------------------------------------

            if (msg.voice) {

                await supportBot.sendVoice(
                    agentId,
                    msg.voice.file_id,
                    {
                        caption:
                            `🎤 Customer sent a voice message.\n\n🎫 Ticket #${ticket.id}`,

                        reply_markup:
                            ticketKeyboard(
                                ticket.id
                            ).reply_markup
                    }
                );

                continue;
            }


            // ----------------------------------------
            // STICKER
            // ----------------------------------------

            if (msg.sticker) {

                await supportBot.sendSticker(
                    agentId,
                    msg.sticker.file_id
                );

                await supportBot.sendMessage(
                    agentId,
                    `🎫 Ticket #${ticket.id}`,

                    ticketKeyboard(
                        ticket.id
                    )
                );

            }

        } catch (error) {

            console.error(
                `Could not send ticket #${ticket.id} to agent ${agentId}:`,
                error.message || error
            );

        }
    }
}


// ============================================================
// SUPPORT BOT HANDLERS
// ============================================================

function attachSupportBotHandlers(
    supportBot,
    record
) {

    // --------------------------------------------------------
    // STATE FOR AGENT REPLIES
    // --------------------------------------------------------

    const replying = {};


    // --------------------------------------------------------
    // /START
    // --------------------------------------------------------

    supportBot.onText(
        /^\/start$/,
        async (msg) => {

            try {

                await supportBot.sendMessage(
                    msg.chat.id,
                    record.welcomeMessage
                );

            } catch (error) {

                console.error(
                    "Welcome message error:",
                    error
                );

            }
        }
    );


    // --------------------------------------------------------
    // /MYID
    // --------------------------------------------------------

    supportBot.onText(
        /^\/myid$/,
        async (msg) => {

            await supportBot.sendMessage(
                msg.chat.id,

                `🆔 Your Telegram ID:

${msg.from.id}`
            );
        }
    );


    // --------------------------------------------------------
    // /CANCEL
    // --------------------------------------------------------

    supportBot.onText(
        /^\/cancel$/,
        async (msg) => {

            if (
                msg.chat.type !==
                "private"
            ) {
                return;
            }

            const agentId =
                String(msg.from.id);

            if (
                replying[agentId]
            ) {

                delete replying[agentId];

                await supportBot.sendMessage(
                    msg.chat.id,
                    "❌ Reply cancelled."
                );

                return;
            }

            await supportBot.sendMessage(
                msg.chat.id,
                "There is no active reply."
            );
        }
    );


    // --------------------------------------------------------
    // CALLBACK QUERIES
    // --------------------------------------------------------

    supportBot.on(
        "callback_query",
        async (query) => {

            try {

                const agentId =
                    String(query.from.id);

                if (
                    !isAgent(
                        record,
                        agentId
                    )
                ) {

                    await supportBot.answerCallbackQuery(
                        query.id,
                        {
                            text:
                                "You are not a support agent."
                        }
                    );

                    return;
                }

                const data =
                    query.data || "";


                // ==========================================
                // REPLY
                // ==========================================

                if (
                    data.startsWith(
                        "reply_"
                    )
                ) {

                    const ticketId =
                        Number(
                            data.replace(
                                "reply_",
                                ""
                            )
                        );

                    const ticket =
                        record.tickets[
                            ticketId
                        ];

                    if (!ticket) {

                        await supportBot.answerCallbackQuery(
                            query.id,
                            {
                                text:
                                    "Ticket not found."
                            }
                        );

                        return;
                    }

                    if (
                        ticket.status !==
                        "OPEN"
                    ) {

                        await supportBot.answerCallbackQuery(
                            query.id,
                            {
                                text:
                                    "This ticket is already closed."
                            }
                        );

                        return;
                    }

                    replying[agentId] =
                        ticketId;

                    await supportBot.answerCallbackQuery(
                        query.id
                    );

                    await supportBot.sendMessage(

                        query.message.chat.id,

                        `✏️ Replying to ticket #${ticketId}.

Send your message now.

You can send:
• Text
• Photo
• Document
• Video
• Audio
• Voice
• Sticker

Send /cancel to stop.`
                    );

                    return;
                }


                // ==========================================
                // CLOSE
                // ==========================================

                if (
                    data.startsWith(
                        "close_"
                    )
                ) {

                    const ticketId =
                        Number(
                            data.replace(
                                "close_",
                                ""
                            )
                        );

                    const ticket =
                        record.tickets[
                            ticketId
                        ];

                    if (!ticket) {

                        await supportBot.answerCallbackQuery(
                            query.id,
                            {
                                text:
                                    "Ticket not found."
                            }
                        );

                        return;
                    }

                    ticket.status =
                        "CLOSED";

                    ticket.closedAt =
                        new Date().toISOString();

                    ticket.closedBy =
                        Number(agentId);

                    saveDB();

                    delete replying[
                        agentId
                    ];

                    await supportBot.sendMessage(

                        ticket.userId,

                        `✅ Your support ticket has been closed.

🎫 Ticket ID: #${ticket.id}

Thank you for contacting ${record.name}.

If you need further assistance, simply send a new message.`
                    );

                    await supportBot.editMessageReplyMarkup(

                        {
                            inline_keyboard: []
                        },

                        {
                            chat_id:
                                query.message.chat.id,

                            message_id:
                                query.message.message_id
                        }
                    );

                    await supportBot.answerCallbackQuery(
                        query.id,
                        {
                            text:
                                "Ticket closed."
                        }
                    );

                    return;
                }

            } catch (error) {

                console.error(
                    "Support callback error:",
                    error
                );

                try {

                    await supportBot.answerCallbackQuery(
                        query.id,
                        {
                            text:
                                "Something went wrong."
                        }
                    );

                } catch (_) {}
            }
        }
    );


    // --------------------------------------------------------
    // ALL MESSAGES
    // --------------------------------------------------------

    supportBot.on(
        "message",
        async (msg) => {

            try {

                if (
                    msg.chat.type !==
                    "private"
                ) {
                    return;
                }

                const userId =
                    String(msg.from.id);

                // ==========================================
                // IGNORE COMMANDS
                // ==========================================

                if (
                    msg.text &&
                    msg.text.startsWith("/")
                ) {

                    // /start, /cancel and /myid
                    // are handled above.

                    return;
                }


                // ==========================================
                // AGENT REPLY
                // ==========================================

                if (
                    isAgent(
                        record,
                        userId
                    ) &&
                    replying[userId]
                ) {

                    const ticketId =
                        replying[userId];

                    const ticket =
                        record.tickets[
                            ticketId
                        ];

                    if (!ticket) {

                        delete replying[
                            userId
                        ];

                        await supportBot.sendMessage(
                            msg.chat.id,
                            "❌ Ticket no longer exists."
                        );

                        return;
                    }

                    if (
                        ticket.status !==
                        "OPEN"
                    ) {

                        delete replying[
                            userId
                        ];

                        await supportBot.sendMessage(
                            msg.chat.id,
                            "❌ This ticket is already closed."
                        );

                        return;
                    }

                    // Send admin message to customer

                    await sendAdminMessageToCustomer(
                        supportBot,
                        record,
                        ticket,
                        msg
                    );

                    saveAdminMessage(
                        ticket,
                        msg
                    );

                    await supportBot.sendMessage(
                        msg.chat.id,

                        `✅ Reply sent to ticket #${ticketId}.`,

                        ticketKeyboard(
                            ticketId
                        )
                    );

                    return;
                }


                // ==========================================
                // AGENT MESSAGE WITHOUT REPLY MODE
                // ==========================================

                if (
                    isAgent(
                        record,
                        userId
                    )
                ) {

                    return;
                }


                // ==========================================
                // CUSTOMER MESSAGE
                // ==========================================

                let ticket =
                    findOpenTicket(
                        record,
                        msg.chat.id
                    );

                let newTicket = false;

                if (!ticket) {

                    ticket =
                        createTicket(
                            record,
                            msg
                        );

                    newTicket = true;
                }

                saveCustomerMessage(
                    ticket,
                    msg
                );


                // Tell customer only once

                if (newTicket) {

                    await supportBot.sendMessage(

                        msg.chat.id,

                        `🎫 Your support ticket has been created.

🎫 Ticket ID: #${ticket.id}

Our support team will reply as soon as possible.

Please keep this Ticket ID for future reference.`
                    );
                }


                // Forward to agents

                await forwardCustomerMessage(
                    supportBot,
                    record,
                    ticket,
                    msg
                );

            } catch (error) {

                console.error(
                    `Support message error for @${record.username}:`,
                    error
                );

            }
        }
    );
}


// ============================================================
// SEND ADMIN MESSAGE TO CUSTOMER
// ============================================================

async function sendAdminMessageToCustomer(
    supportBot,
    record,
    ticket,
    msg
) {

    const customerId =
        ticket.userId;


    // --------------------------------------------
    // TEXT
    // --------------------------------------------

    if (msg.text) {

        await supportBot.sendMessage(

            customerId,

            `💬 ${record.name}

${msg.text}`
        );

        return;
    }


    // --------------------------------------------
    // PHOTO
    // --------------------------------------------

    if (msg.photo) {

        const fileId =
            msg.photo[
                msg.photo.length - 1
            ].file_id;

        await supportBot.sendPhoto(
            customerId,
            fileId,
            {
                caption:
                    `💬 ${record.name}`
            }
        );

        return;
    }


    // --------------------------------------------
    // DOCUMENT
    // --------------------------------------------

    if (msg.document) {

        await supportBot.sendDocument(
            customerId,
            msg.document.file_id,
            {
                caption:
                    `💬 ${record.name}`
            }
        );

        return;
    }


    // --------------------------------------------
    // VIDEO
    // --------------------------------------------

    if (msg.video) {

        await supportBot.sendVideo(
            customerId,
            msg.video.file_id,
            {
                caption:
                    `💬 ${record.name}`
            }
        );

        return;
    }


    // --------------------------------------------
    // AUDIO
    // --------------------------------------------

    if (msg.audio) {

        await supportBot.sendAudio(
            customerId,
            msg.audio.file_id,
            {
                caption:
                    `💬 ${record.name}`
            }
        );

        return;
    }


    // --------------------------------------------
    // VOICE
    // --------------------------------------------

    if (msg.voice) {

        await supportBot.sendVoice(
            customerId,
            msg.voice.file_id,
            {
                caption:
                    `💬 ${record.name}`
            }
        );

        return;
    }


    // --------------------------------------------
    // STICKER
    // --------------------------------------------

    if (msg.sticker) {

        await supportBot.sendSticker(
            customerId,
            msg.sticker.file_id
        );

        return;
    }


    await supportBot.sendMessage(

        customerId,

        `💬 ${record.name}

Your support agent sent a message that this bot cannot display yet.`
    );
}


// ============================================================
// LOAD ALL SAVED BOTS ON STARTUP
// ============================================================

async function restoreBots() {

    const records =
        Object.values(db.bots);

    if (records.length === 0) {

        console.log(
            "No saved support bots."
        );

        return;
    }

    console.log(
        `Restoring ${records.length} support bot(s)...`
    );

    for (const record of records) {

        try {

            await startSupportBot(
                record.id
            );

        } catch (error) {

            console.error(
                `Could not restore @${record.username}:`,
                error.message || error
            );

        }
    }
}


// ============================================================
// START EVERYTHING
// ============================================================

restoreBots()
    .then(() => {

        console.log(
            "All support bots restored."
        );

    })
    .catch((error) => {

        console.error(
            "Startup error:",
            error
        );

    });


// ============================================================
// PROCESS ERRORS
// ============================================================

process.on(
    "unhandledRejection",
    (error) => {

        console.error(
            "Unhandled rejection:",
            error
        );

    }
);


process.on(
    "uncaughtException",
    (error) => {

        console.error(
            "Uncaught exception:",
            error
        );

    }
);