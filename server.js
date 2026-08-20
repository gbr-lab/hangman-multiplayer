import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, 'dist')));

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/socket.io/')) return next();
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const rooms = {};
const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'à', 'è', 'é', 'ì', 'ò', 'ù']);

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function connectedPlayers(room) {
  return room.players.filter(p => p.connected);
}

function canStart(room) {
  const active = connectedPlayers(room);
  return active.length >= 2 && active.every(p => p.ready);
}

function buildMasked(word, guessedLetters, difficulty) {
  return word
    .split('')
    .map(ch => {
      if (ch === ' ') return ' ';
      if (guessedLetters.includes(ch)) return ch;
      if (difficulty !== 'hard' && VOWELS.has(ch)) return '+';
      return '_';
    })
    .join(' ');
}

function isWordComplete(word, guessedLetters) {
  return word.split('').every(ch => ch === ' ' || guessedLetters.includes(ch));
}

function updateRoomState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;
  const playersData = room.players.map(p => ({
    id: p.id,
    username: p.username,
    ready: p.ready,
    isHost: p.isHost,
    score: p.score,
    connected: p.connected
  }));
  io.to(roomCode).emit('update-room-state', {
    players: playersData,
    settings: room.settings,
    canStart: canStart(room)
  });
}

io.on('connection', (socket) => {
  socket.on('create-room', ({ username, customization }) => {
    const roomCode = generateRoomCode();
    rooms[roomCode] = {
      code: roomCode,
      settings: { rounds: 5, difficulty: 'medium' },
      players: [{
        id: socket.id,
        username,
        customization,
        isHost: true,
        ready: false,
        score: 0,
        connected: true
      }],
      gameSession: null,
      gameState: null
    };
    socket.join(roomCode);
    socket.emit('room-created', { roomCode, isHost: true });
    updateRoomState(roomCode);
  });

  socket.on('join-room', ({ roomCode, username, customization }) => {
    const room = rooms[roomCode];
    if (!room) {
      return socket.emit('error-message', 'Stanza non trovata!');
    }

    const existingPlayer = room.players.find(p => p.username === username);
    let isHost;
    if (existingPlayer) {
      existingPlayer.id = socket.id;
      existingPlayer.customization = customization;
      existingPlayer.connected = true;
      isHost = existingPlayer.isHost;
    } else {
      room.players.push({
        id: socket.id,
        username,
        customization,
        isHost: false,
        ready: false,
        score: 0,
        connected: true
      });
      isHost = false;
    }

    socket.join(roomCode);
    socket.emit('room-joined', { roomCode, isHost });
    updateRoomState(roomCode);

    if (room.gameState && room.gameState.secretWord) {
      if (socket.id !== room.gameState.writerId) {
        socket.emit('guess-turn-start', {
          maskedWord: buildMasked(room.gameState.secretWord, room.gameState.guessedLetters, room.settings.difficulty),
          category: room.gameState.category,
          hints: room.gameState.hints
        });
      }
    }
  });

  socket.on('update-customization', ({ roomCode, customization }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.customization = customization;
      updateRoomState(roomCode);
    }
  });

  socket.on('player-ready', ({ roomCode, settings }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      player.ready = !player.ready;
      if (player.isHost && settings) {
        room.settings = settings;
      }
    }
    updateRoomState(roomCode);
  });

  socket.on('start-match', ({ roomCode }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player && player.isHost && canStart(room)) {
      startNewGame(roomCode);
    }
  });

  socket.on('submit-word', ({ roomCode, word, category, hints }) => {
    const room = rooms[roomCode];
    if (!room || !room.gameState) return;
    if (room.gameState.writerId !== socket.id) return;

    const cleanWord = word.toLowerCase();
    const cleanHints = (hints || []).map(h => h.trim()).filter(Boolean).slice(0, 3);

    room.gameState.secretWord = cleanWord;
    room.gameState.category = category || '';
    room.gameState.hints = cleanHints;
    room.gameState.errors = 0;
    room.gameState.guessedLetters = [];

    const maskedWord = buildMasked(cleanWord, [], room.settings.difficulty);

    io.to(roomCode).except(socket.id).emit('guess-turn-start', {
      maskedWord,
      category: room.gameState.category,
      hints: room.gameState.hints
    });
  });

  socket.on('make-guess', ({ roomCode, letter }) => {
    const room = rooms[roomCode];
    if (!room || !room.gameState) return;
    if (room.gameState.writerId === socket.id) return;

    const state = room.gameState;
    if (state.guessedLetters.includes(letter)) return;
    state.guessedLetters.push(letter);

    const hit = state.secretWord.includes(letter);
    const maskedWord = buildMasked(state.secretWord, state.guessedLetters, room.settings.difficulty);
    state.maskedWord = maskedWord;

    const currentPlayer = room.players.find(p => p.id === socket.id);

    if (!hit) {
      state.errors++;
    } else if (currentPlayer) {
      currentPlayer.score += 5;
    }

    io.to(roomCode).emit('update-game-state', {
      maskedWord,
      errors: state.errors,
      customConfig: currentPlayer ? currentPlayer.customization : {}
    });

    if (isWordComplete(state.secretWord, state.guessedLetters)) {
      if (currentPlayer) currentPlayer.score += 15;
      endRound(roomCode, `Parola indovinata! Era: ${state.secretWord}`);
    } else if (state.errors >= 6) {
      endRound(roomCode, `Troppi errori! La parola era: ${state.secretWord}`);
    }
  });

  socket.on('send-chat', ({ roomCode, message }) => {
    const room = rooms[roomCode];
    if (!room) return;
    const player = room.players.find(p => p.id === socket.id);
    if (player) {
      io.to(roomCode).emit('receive-chat', { sender: player.username, message });
    }
  });

  socket.on('disconnect', () => {
    for (const roomCode in rooms) {
      const room = rooms[roomCode];
      const player = room.players.find(p => p.id === socket.id);
      if (!player) continue;

      player.connected = false;

      if (player.isHost) {
        const nextHost = room.players.find(p => p.connected);
        if (nextHost) {
          player.isHost = false;
          nextHost.isHost = true;
        }
      }

      if (connectedPlayers(room).length === 0) {
        delete rooms[roomCode];
      } else {
        updateRoomState(roomCode);
      }
    }
  });
});

function startNewGame(roomCode) {
  const room = rooms[roomCode];
  if (!room) return;

  const active = connectedPlayers(room);

  if (!room.gameSession) {
    room.gameSession = {
      currentRound: 1,
      maxRounds: parseInt(room.settings.rounds)
    };
  }

  const writerIndex = (room.gameSession.currentRound - 1) % active.length;
  const writer = active[writerIndex];

  room.gameState = {
    writerId: writer.id,
    secretWord: '',
    category: '',
    hints: [],
    maskedWord: '',
    errors: 0,
    guessedLetters: []
  };

  room.players.forEach(p => {
    io.to(p.id).emit('start-game', {
      round: room.gameSession.currentRound,
      totalRounds: room.gameSession.maxRounds,
      isWriter: p.id === writer.id,
      writerName: writer.username,
      scores: room.players.map(pl => ({ username: pl.username, score: pl.score }))
    });
  });
}

function endRound(roomCode, message) {
  const room = rooms[roomCode];
  if (!room) return;

  io.to(roomCode).emit('round-over', {
    message,
    scores: room.players.map(pl => ({ username: pl.username, score: pl.score }))
  });

  setTimeout(() => {
    if (!rooms[roomCode]) return;

    if (room.gameSession.currentRound < room.gameSession.maxRounds) {
      room.gameSession.currentRound++;
      startNewGame(roomCode);
    } else {
      let maxScore = -1;
      let winners = [];
      room.players.forEach(p => {
        if (p.score > maxScore) {
          maxScore = p.score;
          winners = [p.username];
        } else if (p.score === maxScore) {
          winners.push(p.username);
        }
      });

      const winnerMsg = winners.length > 1
        ? `Pareggio tra: ${winners.join(', ')}!`
        : `Vince ${winners[0]}!`;

      io.to(roomCode).emit('game-over', {
        message: winnerMsg,
        scores: room.players.map(pl => ({ username: pl.username, score: pl.score }))
      });

      room.gameSession = null;
      room.players.forEach(p => (p.ready = false));
      updateRoomState(roomCode);
    }
  }, 4000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server attivo sulla porta ${PORT}`);
});
