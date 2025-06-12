const fs = require("fs");
const axios = require("axios");
const { cmd } = require('../command');
const config = require('../config');
const prefix = config.PREFIX;

const dbPath = "./lib/wcg-database.json";
const timers = {};
const startTimers = {};

function loadDB() {
  if (!fs.existsSync(dbPath)) return {};
  const data = fs.readFileSync(dbPath, "utf-8");
  return JSON.parse(data || "{}");
}

function saveDB(db) {
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

async function isValidWord(word) {
  try {
    const res = await axios.get(`https://api.dictionaryapi.dev/api/v2/entries/en/${word.toLowerCase()}`);
    return Array.isArray(res.data);
  } catch {
    return false;
  }
}

function clearStartTimer(from) {
  if (startTimers[from]) {
    clearTimeout(startTimers[from]);
    delete startTimers[from];
  }
}

function clearTurnTimer(from) {
  if (timers[from]) {
    clearTimeout(timers[from]);
    delete timers[from];
  }
}

cmd({
  pattern: "wcg",
  desc: "Start a Word Chain Game",
  category: "game",
  filename: __filename
}, async (conn, mek, m, { from, reply, sender }) => {
  const db = loadDB();

  if (db[from] && !db[from].finished) {
    return reply("⚠️ A Word Chain game is already active.");
  }

  db[from] = {
    type: "wcg",
    players: [sender],
    words: [],
    turn: 0, // index of current player
    waiting: true,
    finished: false,
    wordLimit: 3
  };

  saveDB(db);

  reply(
    `🎮 *Word Chain Game Started!*\n👤 Player 1: @${sender.split("@")[0]}\n⏳ Waiting for more players (up to 20)...\nSend *join-wcg* to join.`,
    null,
    { mentions: [sender] }
  );

  // Start 40 sec timer to wait for others to join
  clearStartTimer(from);
  startTimers[from] = setTimeout(() => {
    const db = loadDB();
    if (!db[from] || db[from].finished) return;
    const game = db[from];
    if (game.waiting) {
      game.waiting = false;
      game.turn = 0; // first player start
      // Choose random first letter
      const randomLetter = String.fromCharCode(97 + Math.floor(Math.random() * 26));
      game.requiredFirstLetter = randomLetter;

      saveDB(db);

      conn.sendMessage(from, {
        text: `⏳ Time's up! Game is starting with ${game.players.length} player(s).\n🧠 *Word Chain Begins!*\n🎯 @${game.players[0].split("@")[0]} starts.\n🔤 First letter: *${randomLetter.toUpperCase()}*\n📌 Send an English word starting with *${randomLetter.toUpperCase()}* and at least *3 letters*`,
        mentions: game.players
      });

      clearStartTimer(from);

      // Start turn timer for first player
      clearTurnTimer(from);
      timers[from] = setTimeout(() => handleTimeout(conn, from), 40 * 1000);
    }
  }, 40 * 1000);
});

cmd({
  pattern: "join-wcg",
  desc: "Join a Word Chain Game",
  category: "game",
  filename: __filename
}, async (conn, mek, m, { from, sender, reply }) => {
  const db = loadDB();
  const game = db[from];

  if (!game || game.type !== "wcg") return reply("❌ No Word Chain game to join.");
  if (!game.waiting) return reply("⚠️ Game already started.");
  if (game.players.includes(sender)) return reply("⚠️ You already joined the game.");
  if (game.players.length >= 20) return reply("⚠️ Player limit reached (20).");

  game.players.push(sender);

  saveDB(db);

  // Announce join
  reply(
    `🙌 @${sender.split("@")[0]} joined the game! (${game.players.length} player(s) now)\n⏳ 40 seconds after first joiner the game will start.`,
    null,
    { mentions: game.players }
  );
});

cmd({
  on: "body"
}, async (conn, mek, m, { from, body, sender, reply }) => {
  const text = body.trim().toLowerCase();
  const db = loadDB();
  const game = db[from];
  if (!game || game.type !== "wcg" || game.finished) return;

  if (text === "join-wcg") {
    if (!game.waiting) return reply("⚠️ Game already started.");
    if (game.players.includes(sender)) return reply("⚠️ You already joined the game.");
    if (game.players.length >= 20) return reply("⚠️ Player limit reached (20).");

    game.players.push(sender);
    saveDB(db);

    return reply(
      `🙌 @${sender.split("@")[0]} joined the game! (${game.players.length} player(s) now)\n⏳ 40 seconds after first joiner the game will start.`,
      null,
      { mentions: game.players }
    );
  }

  if (game.waiting) return; // Ignore other messages while waiting

  // Validate turn
  const currentPlayer = game.players[game.turn];
  if (currentPlayer !== sender) return;

  if (!/^[a-z]{2,}$/.test(text)) return reply("⚠️ Only alphabetic English words are allowed.");
  if (text.length < game.wordLimit) return reply(`📏 Word must be at least *${game.wordLimit}* letters.`);
  if (game.words.includes(text)) return reply("♻️ Word already used!");
  if (!(await isValidWord(text))) return reply("❌ Not a valid English word!");

  if (game.words.length > 0) {
    const lastWord = game.words[game.words.length - 1];
    if (lastWord[lastWord.length - 1] !== text[0]) {
      return reply(`🔁 Word must start with *${lastWord[lastWord.length - 1].toUpperCase()}*`);
    }
  } else {
    if (text[0] !== game.requiredFirstLetter) {
      return reply(`🔤 First word must start with *${game.requiredFirstLetter.toUpperCase()}*`);
    }
  }

  game.words.push(text);

  // Advance turn cyclically
  game.turn = (game.turn + 1) % game.players.length;

  // Increase word limit but max 7 for challenge (can be changed)
  game.wordLimit = Math.min(game.wordLimit + 1, 7);

  game.lastMoveTime = Date.now();

  // Clear previous timer and set new one for next player
  clearTurnTimer(from);
  timers[from] = setTimeout(() => handleTimeout(conn, from), 40 * 1000);

  saveDB(db);

  // Check if 10 words reached -> game over
  if (game.words.length >= 10) {
    game.finished = true;

    // Score calculation - simplistic: rank by who said most words (even distribution)
    // Here just rank by number of words spoken (approximate)

    // Count words per player
    const counts = {};
    game.players.forEach(p => counts[p] = 0);
    game.words.forEach((w, i) => {
      const playerIndex = i % game.players.length;
      counts[game.players[playerIndex]]++;
    });

    // Sort players by word count desc
    const ranking = [...game.players].sort((a, b) => counts[b] - counts[a]);

    let msg = `🏁 *Game Over!*\n\n*Ranking:*\n`;
    ranking.forEach((p, i) => {
      const pos = i + 1;
      if (pos <= 3) {
        msg += `🥇🥈🥉`.charAt(i) + ` *${pos}.* @${p.split("@")[0]} — ${counts[p]} words\n`;
      } else {
        msg += `❌ *${pos}.* @${p.split("@")[0]} — ${counts[p]} words (Lost)\n`;
      }
    });

    reply(msg, null, { mentions: game.players });

    clearTurnTimer(from);
    clearStartTimer(from);

    delete db[from];
    saveDB(db);
    return;
  }

  reply(
    `✅ *${text}* accepted!\n🧮 Word *${game.words.length}* of 10.\n🔠 Next word must start with *${text[text.length - 1].toUpperCase()}*\n➡️ @${game.players[game.turn].split("@")[0]}, your turn!\n📏 Min word length: *${game.wordLimit}*\n⏳ You have *40 seconds* to respond.`,
    null,
    { mentions: game.players }
  );
});

async function handleTimeout(conn, from) {
  const db = loadDB();
  if (!db[from]) return;
  const game = db[from];
  if (game.finished) return;

  const loser = game.players[game.turn];
  // Winner(s) all others
  const winners = game.players.filter(p => p !== loser);

  await conn.sendMessage(from, {
    text: `⌛ *Timeout!*\n@${loser.split("@")[0]} took too long.\n🏆 Winner(s): ${winners.map(w => "@" + w.split("@")[0]).join(", ")}`,
    mentions: game.players
  });

  game.finished = true;
  clearTurnTimer(from);
  clearStartTimer(from);
  delete db[from];
  saveDB(db);
}
