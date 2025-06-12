const fs = require("fs");
const { cmd } = require('../command');
const config = require('../config');
const prefix = config.PREFIX;

const dbPath = "./lib/ttt-database.json";
const timers = {}; // تایمرهای نوبت

function loadDB() {
  if (!fs.existsSync(dbPath)) return {};
  const data = fs.readFileSync(dbPath, "utf-8");
  return JSON.parse(data || "{}");
}

function saveDB(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function renderBoard(board) {
  const emojis = [" ", "❌", "⭕"];
  const lines = [];
  for (let i = 0; i < 3; i++) {
    const row = board.slice(i * 3, i * 3 + 3)
      .map((v, idx) => v ? emojis[v] : `${i * 3 + idx + 1}️⃣`).join(" ┃ ");
    lines.push("┃ " + row + " ┃");
  }
  const sep = "┄┄┄┄┄┄┄┄┄┄┄";
  return `┄┄┄┄┄┄┄┄┄┄┄\n${lines.join("\n" + sep + "\n")}\n┄┄┄┄┄┄┄┄┄┄┄`;
}

function checkWin(board, player) {
  const wins = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6]
  ];
  return wins.some(line => line.every(i => board[i] === player));
}

function checkDraw(board) {
  return board.every(c => c !== 0);
}

function gameMessage(game, mention1, mention2) {
  return `🎮 *TIC-TAC-TOE* 🎮\n\nGame between ${mention1} (❌) and ${mention2} (⭕)\n\n${renderBoard(game.board)}\n\n${game.turn === 1 ? mention1 : mention2}'s turn (${game.turn === 1 ? "❌" : "⭕"})\n\nSend a number (1-9) to make your move.`;
}

// شروع بازی
cmd({
  pattern: "ttt",
  desc: "Start a Tic-Tac-Toe game",
  category: "game",
  filename: __filename
}, async (conn, mek, m, { from, reply, sender }) => {
  let db = loadDB();

  if (db[from] && !db[from].finished && !db[from].waiting) {
    return reply("⚠️ A game is already active here. Finish it before starting a new one.");
  }

  if (db[from] && db[from].waiting) {
    return reply("⚠️ A game is already waiting for the second player. Send 'join-ttt' to join the game.");
  }

  db[from] = {
    waiting: true,
    players: [sender],
    board: Array(9).fill(0),
    turn: 1,
    finished: false
  };
  saveDB(db);

  reply(`🎮 *Tic-Tac-Toe* game started!\n\n👤 Player 1: @${sender.split("@")[0]}\n⏳ Waiting for player 2 to join...\n\n✉️ Send *join-ttt* to join the game!\n\nor send cancel for cancel game and leave for leave game`, null, { mentions: [sender] });
});

// خروج از بازی
cmd({
  pattern: "leave-ttt",
  desc: "Leave the current Tic-Tac-Toe game",
  category: "game",
  filename: __filename
}, async (conn, mek, m, { from, reply, sender }) => {
  const db = loadDB();

  if (!db[from]) return reply("⚠️ No active game to leave.");

  const game = db[from];

  if (!game.players.includes(sender)) return reply("⚠️ You are not part of the game.");

  const other = game.players.find(p => p !== sender);
  const senderTag = `@${sender.split("@")[0]}`;

  if (timers[from]) {
    clearTimeout(timers[from]);
    delete timers[from];
  }

  delete db[from];
  saveDB(db);

  return reply(`🚪 ${senderTag} left the game. Game cancelled.`, null, { mentions: [sender, other].filter(Boolean) });
});

// لغو بازی در حالت انتظار
cmd({
  pattern: "cancel-ttt",
  desc: "Cancel an ongoing Tic-Tac-Toe game",
  category: "game",
  filename: __filename
}, async (conn, mek, m, { from, reply, sender }) => {
  const db = loadDB();

  if (!db[from]) {
    return reply("⚠️ No ongoing Tic-Tac-Toe game to cancel.");
  }

  // فقط سازنده بازی می‌تونه کنسل کنه
  if (db[from].players[0] !== sender) {
    return reply("⚠️ Only the game starter can cancel the game.");
  }

  if (timers[from]) {
    clearTimeout(timers[from]);
    delete timers[from];
  }

  delete db[from];
  saveDB(db);

  return reply("❌ Game cancelled successfully.");
});


const waitingIntervals = {};
const waitingTimeouts = {};


cmd({
  on: "body"
}, async (conn, mek, m, { from, body, pushname: _0x1279c5, sender, reply }) => {
  const db = loadDB();
  const text = body.trim().toLowerCase();

  // ساخت بازی (مثال ساده)
  if (text === "ttt") {
    if (db[from] && !db[from].finished) {
      return reply("⚠️ A game is already running here.");
    }

    db[from] = {
      players: [sender],
      waiting: true,
      finished: false,
      board: Array(9).fill(0),
      turn: 1
    };
    saveDB(db);

    // پیام شروع بازی و انتظار برای جوین
    await reply(`🎮 *Tic-Tac-Toe* game started!\n\n👤 Player 1: @${_0x1279c5 || "User"} \n⏳ Waiting for player 2 to join...\n\n✉️ Send *join-ttt* to join the game!`, null, { mentions: [sender] });

    // پاک کردن تایمرهای قبلی اگر بود
    if (waitingIntervals[from]) clearInterval(waitingIntervals[from]);
    if (waitingTimeouts[from]) clearTimeout(waitingTimeouts[from]);

    // تایمر پیام یادآوری هر 1 دقیقه
    waitingIntervals[from] = setInterval(() => {
      conn.sendMessage(from, { text: "⏳ Waiting for player 2 to join... Send 'join-ttt' to join the game." });
    }, 60 * 1000);

    // تایمر حذف بازی پس از 10 دقیقه اگر جوین نشد
    waitingTimeouts[from] = setTimeout(() => {
      let db = loadDB();
      if (db[from] && db[from].waiting) {
        conn.sendMessage(from, { text: "⌛️ Game cancelled due to no player 2 joining in 10 minutes." });
        delete db[from];
        saveDB(db);

        clearInterval(waitingIntervals[from]);
        clearTimeout(waitingTimeouts[from]);
        delete waitingIntervals[from];
        delete waitingTimeouts[from];
      }
    }, 10 * 60 * 1000);

    return;
  }

  // جوین به بازی
  if (text === "join-ttt") {
    if (!db[from] || !db[from].waiting) {
      return reply("⚠️ No Tic-Tac-Toe game is waiting for players here. Start a game with '.ttt'.");
    }

    if (db[from].players.includes(sender)) {
      return reply("⚠️ You are already in the game.");
    }

    db[from].players.push(sender);
    db[from].waiting = false;
    saveDB(db);

    // پاک کردن تایمرهای waiting چون بازی شروع شد
    if (waitingIntervals[from]) {
      clearInterval(waitingIntervals[from]);
      delete waitingIntervals[from];
    }
    if (waitingTimeouts[from]) {
      clearTimeout(waitingTimeouts[from]);
      delete waitingTimeouts[from];
    }

    // تایمر حرکت بازی (10 دقیقه برای هر حرکت)
    if (timers[from]) clearTimeout(timers[from]);
    timers[from] = setTimeout(() => {
      let db = loadDB();
      if (db[from] && !db[from].finished) {
        const mention1 = `@${db[from].players[0].split("@")[0]}`;
        const mention2 = `@${db[from].players[1].split("@")[0]}`;
        conn.sendMessage(from, { text: `⌛️ *Game timed out!*\nNo move was made within 10 minutes.\nGame between ${mention1} and ${mention2} cancelled.`, mentions: db[from].players });
        delete db[from];
        saveDB(db);
        delete timers[from];
      }
    }, 10 * 60 * 1000);

    const player1 = db[from].players[0];
    const player2 = db[from].players[1];

    return reply(`🎮 Player 2 @${sender.split("@")[0]} joined the game!\n\n${gameMessage(db[from], `@${player1.split("@")[0]}`, `@${player2.split("@")[0]}`)}`, null, { mentions: [player1, player2] });
  }

  // ادامه بازی (حرکت‌ها)
  const game = db[from];
  if (!game || game.waiting || game.finished) return;
  if (!game.players.includes(sender)) return;

  if (sender !== game.players[game.turn - 1]) {
    return reply("⛔️ It is not your turn.");
  }

  const move = parseInt(body);
  if (!move || move < 1 || move > 9) return;

  if (game.board[move - 1] !== 0) {
    return reply("⚠️ This cell is already taken. Choose another one.");
  }

  game.board[move - 1] = game.turn;

  if (checkWin(game.board, game.turn)) {
    const winnerMention = `@${game.players[game.turn - 1].split("@")[0]}`;
    await reply(
      `🏆 *TIC-TAC-TOE RESULT* 🏆\n\n🎉 Congratulations ${winnerMention}!\nYou won the game playing as ${game.turn === 1 ? "❌" : "⭕"}.\n\n${renderBoard(game.board)}`,
      null,
      { mentions: game.players }
    );
    delete db[from];
    saveDB(db);
    if (timers[from]) {
      clearTimeout(timers[from]);
      delete timers[from];
    }
    return;
  }

  if (checkDraw(game.board)) {
    await reply(`🤝 The game ended in a draw.\n\n${renderBoard(game.board)}`, null, { mentions: game.players });
    delete db[from];
    saveDB(db);
    if (timers[from]) {
      clearTimeout(timers[from]);
      delete timers[from];
    }
    return;
  }

  // تغییر نوبت
  game.turn = game.turn === 1 ? 2 : 1;

  // ریست تایمر حرکت بعدی
  if (timers[from]) clearTimeout(timers[from]);
  timers[from] = setTimeout(() => {
    let db = loadDB();
    if (db[from] && !db[from].finished) {
      const mention1 = `@${db[from].players[0].split("@")[0]}`;
      const mention2 = `@${db[from].players[1].split("@")[0]}`;
      conn.sendMessage(from, { text: `⌛️ *Game timed out!*\nNo move was made within 10 minutes.\nGame between ${mention1} and ${mention2} cancelled.`, mentions: db[from].players });
      delete db[from];
      saveDB(db);
      delete timers[from];
    }
  }, 10 * 60 * 1000);

  saveDB(db);

  const mention1 = `@${game.players[0].split("@")[0]}`;
  const mention2 = `@${game.players[1].split("@")[0]}`;
  await reply(gameMessage(game, mention1, mention2), null, { mentions: game.players });
});
