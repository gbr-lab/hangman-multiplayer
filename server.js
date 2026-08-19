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

function generateRoomCode() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
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
                score: 0
            }],
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
        if (existingPlayer) {
            existingPlayer.id = socket.id;
            existingPlayer.customization = customization;
            socket.join(roomCode);
            socket.emit('room-joined', { roomCode, isHost: existingPlayer.isHost });
            updateRoomState(roomCode);
            return;
        }

        room.players.push({
            id: socket.id,
            username,
            customization,
            isHost: false,
            ready: false,
            score: 0
        });

        socket.join(roomCode);
        socket.emit('room-joined', { roomCode, isHost: false });
        updateRoomState(roomCode);
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
            player.ready = !player.ready; // Toggle ready
            if (player.isHost && settings) {
                room.settings = settings;
            }
        }
        updateRoomState(roomCode);
    });

    // L'Host avvia manualmente la partita quando tutti sono pronti
    socket.on('start-match', ({ roomCode }) => {
        const room = rooms[roomCode];
        if (!room) return;
        const player = room.players.find(p => p.id === socket.id);
        if (player && player.isHost) {
            startNewGame(roomCode);
        }
    });

    socket.on('submit-word', ({ roomCode, word, hint }) => {
        const room = rooms[roomCode];
        if (!room || !room.gameState) return;

        room.gameState.secretWord = word;
        room.gameState.hint = hint;
        room.gameState.maskedWord = word.split('').map(() => '_').join(' ');
        room.gameState.errors = 0;
        room.gameState.guessedLetters = [];

        io.to(roomCode).emit('game-round-active', {
            maskedWord: room.gameState.maskedWord,
            hint
        });
    });

    socket.on('make-guess', ({ roomCode, letter }) => {
        const room = rooms[roomCode];
        if (!room || !room.gameState) return;

        const state = room.gameState;
        if (state.guessedLetters.includes(letter)) return;
        state.guessedLetters.push(letter);

        const word = state.secretWord;
        let hit = false;
        let newMasked = '';

        for (let i = 0; i < word.length; i++) {
            if (word[i] === letter || state.guessedLetters.includes(word[i])) {
                newMasked += word[i] + ' ';
                if (word[i] === letter) hit = true;
            } else {
                newMasked += '_ ';
            }
        }
        state.maskedWord = newMasked.trim();

        const currentPlayer = room.players.find(p => p.id === socket.id);

        if (!hit) {
            state.errors++;
        } else if (currentPlayer) {
            currentPlayer.score += 5; // Punti per lettera indovinata
        }

        io.to(roomCode).emit('update-game-state', {
            maskedWord: state.maskedWord,
            errors: state.errors,
            customConfig: currentPlayer ? currentPlayer.customization : {}
        });

        if (!state.maskedWord.includes('_')) {
            if (currentPlayer) currentPlayer.score += 15; // Bonus chiusura parola
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
            room.players = room.players.filter(p => p.id !== socket.id);
            if (room.players.length === 0) {
                delete rooms[roomCode];
            } else {
                updateRoomState(roomCode);
            }
        }
    });
});

function updateRoomState(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;
    const playersData = room.players.map(p => ({
        id: p.id,
        username: p.username,
        ready: p.ready,
        isHost: p.isHost,
        score: p.score
    }));
    io.to(roomCode).emit('update-room-state', {
        players: playersData,
        settings: room.settings
    });
}

function startNewGame(roomCode) {
    const room = rooms[roomCode];
    if (!room) return;

    if (!room.gameSession) {
        room.gameSession = {
            currentRound: 1,
            maxRounds: parseInt(room.settings.rounds)
        };
    }

    // A turno un giocatore fa lo scrittore (basato sul round)
    const writerIndex = (room.gameSession.currentRound - 1) % room.players.length;
    const writer = room.players[writerIndex];

    room.gameState = {
        writerId: writer.id,
        secretWord: '',
        hint: '',
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

            const winnerMsg = winners.length > 1 ? `Pareggio tra: ${winners.join(', ')}!` : `Vince ${winners[0]}!`;

            io.to(roomCode).emit('game-over', { message: winnerMsg });

            room.gameSession = null;
            room.players.forEach(p => p.ready = false);
            updateRoomState(roomCode);
        }
    }, 4000);
}

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server attivo sulla porta ${PORT}`);
});
