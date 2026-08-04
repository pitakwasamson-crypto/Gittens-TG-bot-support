require("dotenv").config();

const fs = require("fs");

const TelegramBot = require("node-telegram-bot-api");
const Bot = TelegramBot.default || TelegramBot;

const bot1 = new Bot(process.env.BOT_TOKEN_1, {
    polling: true,
});

const bot2 = new Bot(process.env.BOT_TOKEN_2, {
    polling: true,
});

const bot3 = new Bot(process.env.BOT_TOKEN_3, {
    polling: true,
});

const bot4 = new Bot(process.env.BOT_TOKEN_4, {
    polling: true,
});

// const bot5 = new Bot(process.env.BOT_TOKEN_5, {
//     polling: true,
// });

// const bot6 = new Bot(process.env.BOT_TOKEN_6, {
//     polling: true,
// });

bot1.on("polling_error", console.log);
bot2.on("polling_error", console.log);
bot3.on("polling_error", console.log);
bot4.on("polling_error", console.log);
// bot5.on("polling_error", console.log);
// bot6.on("polling_error", console.log);


console.log("Bot started");

setupBot(bot1, "Vanar Support");
console.log("Vanar Support started");

setupBot(bot2, "COLDCARD Support");
console.log("COLDCARD Support started");

setupBot(bot3, "Opal Exchange Support");
console.log("Opal Exchange Support started");

setupBot(bot4, "Rose Bot Support");
console.log("Rose Bot Support started");

// setupBot(bot5, "Polygon Support");
// console.log("Polygon Support started");

// setupBot(bot6, "Solana Support");
// console.log("Solana Support started");


function setupBot(bot, supportName) {

const replying = {};
const db = JSON.parse(
    fs.readFileSync("./data/tickets.json", "utf8")
);
function saveDB() {
    fs.writeFileSync(
        "./data/tickets.json",
        JSON.stringify(db, null, 4)
    );
}
// ======================
// START COMMAND
// ======================

bot.onText(/\/start/, async (msg) => {

    await bot.sendMessage(
        msg.chat.id,
        `👋 Welcome to ${supportName}.

What can this bot do? 🔍
Lodge your complaint below and send it to open a ticket.`
    );

});

// ======================
// FORWARD USER MESSAGES
// ======================
bot.on("message", async (msg) => {

    // Ignore group messages
    if (msg.chat.type !== "private") return;

    // Ignore /start
    if (msg.text === "/start") return;

    const username = msg.from.username
        ? `@${msg.from.username}`
        : "No username";

    // --------------------
    // TEXT
    // --------------------
// 1. Find existing ticket
let ticket = Object.values(db.tickets).find(
    t => t.userId === msg.chat.id && t.status === "OPEN"
);

// 2. Declare other variables
let ticketId;
let isNewTicket = false;

// 3. Then check if ticket exists
if (!ticket) {
    isNewTicket = true;

    db.lastTicket++;
    ticketId = db.lastTicket;

    ticket = {
        id: ticketId,
        userId: msg.chat.id,
        name: msg.from.first_name,
        username: msg.from.username || "",
        status: "OPEN",
        created: new Date().toISOString(),
        messages: []
    };

    db.tickets[ticketId] = ticket;
    saveDB();
} else {
    ticketId = ticket.id;
}



// Save message
if (msg.text) {

    ticket.messages.push({
        from: "user",
        text: msg.text,
        date: new Date().toISOString()
    });

    saveDB();

    // Tell customer ONLY when ticket is first created

if (isNewTicket) {

    await bot.sendMessage(
        msg.chat.id,
        `🎫 Your support ticket has been created.

🎫 Ticket ID: #${ticketId}
Our support team will reply as soon as possible.
Please keep this Ticket ID for future reference.`
    );
}

    // Forward to support group
    await bot.sendMessage(
        process.env.GROUP_ID,
        `🤖 ${supportName}

        🎫 Ticket #${ticketId}

Status: 🟢 OPEN

👤 ${msg.from.first_name}

📛 ${username}

🆔 ${msg.chat.id}

Message:

${msg.text}`,
        {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: "💬 Reply",
                        callback_data: `reply_${ticketId}`
                    }
                ]]
            }
        }
    );

    return;
}
    // --------------------
    // PHOTO
    // --------------------
    if (msg.photo) {

        const fileId = msg.photo[msg.photo.length - 1].file_id;

        bot.sendPhoto(
            process.env.GROUP_ID,
            fileId,
            {
                caption:
`📷 Photo

👤 ${msg.from.first_name}

📛 ${username}

🆔 ${msg.chat.id}`,

                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: "💬 Reply",
                            callback_data: `reply_${ticketId}`
                        }
                    ]]
                }
            }
        );

        return;
    }

    // --------------------
    // DOCUMENT
    // --------------------
    if (msg.document) {

        bot.sendDocument(
            process.env.GROUP_ID,
            msg.document.file_id,
            {
                caption:
`📄 Document

👤 ${msg.from.first_name}

🆔 ${msg.chat.id}`,

                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: "💬 Reply",
                            callback_data: `reply_${ticketId}`
                        }
                    ]]
                }
            }
        );

        return;
    }

    // --------------------
    // STICKER
    // --------------------
    if (msg.sticker) {

        bot.sendSticker(
            process.env.GROUP_ID,
            msg.sticker.file_id
        );

        bot.sendMessage(
            process.env.GROUP_ID,
            `👤 ${msg.from.first_name}\n🆔 ${msg.chat.id}`,
            {
                reply_markup: {
                    inline_keyboard: [[
                        {
                            text: "💬 Reply",
                            callback_data: `reply_${ticketId}`
                        }
                    ]]
                }
            }
        );
    }

});

// ======================
// CALLBACKS
// ======================
bot.on("callback_query", (query) => {

    const data = query.data;

    // Reply button
    if (data.startsWith("reply_")) {

        const ticketId = Number(data.replace("reply_", ""));
        const ticket = db.tickets[ticketId];

        if (!ticket) {
            return bot.answerCallbackQuery(query.id, {
                text: "Ticket not found."
            });
        }

        replying[query.from.id] = ticketId;

        bot.sendMessage(
            query.message.chat.id,
            `✏️ Replying to user ${ticket.userId}

Send your message now.
Send /cancel to stop.`
        );

        return bot.answerCallbackQuery(query.id);
    }

    // Close button
    if (data.startsWith("close_")) {

        const ticketId = Number(data.replace("close_", ""));
        const ticket = db.tickets[ticketId];

        if (!ticket) {
            return bot.answerCallbackQuery(query.id, {
                text: "Ticket not found."
            });
        }

        ticket.status = "CLOSED";
        saveDB();

        bot.sendMessage(
            ticket.userId,
            `✅ Your support ticket has been closed.

🎫 Ticket ID: #${ticket.id}
Thank you for contacting ${supportName}.`
        );

        bot.editMessageReplyMarkup(
            { inline_keyboard: [] },
            {
                chat_id: query.message.chat.id,
                message_id: query.message.message_id
            }
        );

        bot.answerCallbackQuery(query.id, {
            text: "Ticket closed."
        });
    }

});


// ======================
// ADMIN REPLY
// ======================
bot.on("message", (msg) => {

    // Only messages from support group
    if (msg.chat.id.toString() !== process.env.GROUP_ID) return;

    const ticketId = replying[msg.from.id];

if (!ticketId)
    return;

const ticket = db.tickets[ticketId];

const userId = ticket.userId;

    if (!userId) return;

    if (msg.text && msg.text.startsWith("/cancel")) {

    const ticketId = replying[msg.from.id];

    if (ticketId && db.tickets[ticketId]) {

        db.tickets[ticketId].status = "CLOSED";
        saveDB();

        // Notify the customer
        bot.sendMessage(
            db.tickets[ticketId].userId,

`✅ Your support ticket has been closed.
🎫 Ticket ID: #${ticketId}
Thank you for contacting ${supportName}. If you need further assistance, simply send a new message to open another ticket.\n\n Send /start if you need me again.`
        );
    }

    delete replying[msg.from.id];

    bot.sendMessage(
        msg.chat.id,
        `🔒 Ticket #${ticketId} has been closed.`
    );

    return;
}

    bot.sendMessage(
        userId,

    `💬 ${supportName}
    ${msg.text}`
    );
    ticket.messages.push({

    from: "admin",

    text: msg.text,

    date: new Date().toISOString()

});

saveDB();

    bot.sendMessage(
        msg.chat.id,
        "✅ Reply sent.",
        {
            reply_markup: {
                inline_keyboard: [[
                    {
                        text: "💬 Continue Conversation",
                        callback_data: `reply_${ticketId}`
                    }
                ]]
            }
        }
    );

});
}
