import io from 'socket.io-client';
import { HangmanRenderer } from './game.js';

const socket = io();

const screens = {
  menu: document.getElementById('menu-screen'),
  room: document.getElementById('room-screen'),
  game: document.getElementById('game-screen')
};

const usernameInput = document.getElementById('username-input');
const roomCodeInput = document.getElementById('room-code-input');
const displayRoomCode = document.getElementById('display-room-code');
const hudRoomCode = document.getElementById('hud-room-code');
const playersUl = document.getElementById('players-ul');
const readyBtn = document.getElementById('ready-btn');
const startMatchBtn = document.getElementById('start-match-btn');

const skinColorInput = document.getElementById('skin-color');
const accessorySelect = document.getElementById('accessory-select');
const avatarCanvas = document.getElementById('avatar-canvas');

const hostSettings = document.getElementById('host-settings');
const roundsSelect = document.getElementById('rounds-select');
const difficultySelect = document.getElementById('difficulty-select');

const roundInfo = document.getElementById('round-info');
const scoresList = document.getElementById('scores-list');
const wordDisplay = document.getElementById('word-display');
const hintDisplay = document.getElementById('hint-display');
const roleAnnouncement = document.getElementById('role-announcement');
const wordCreatorPanel = document.getElementById('word-creator-panel');
const secretWordInput = document.getElementById('secret-word-input');
const secretHintInput = document.getElementById('secret-hint-input');
const submitWordBtn = document.getElementById('submit-word-btn');
const keyboardPanel = document.getElementById('keyboard-panel');
const virtualKeyboard = document.getElementById('virtual-keyboard');

const chatContainer = document.getElementById('chat-container');
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');

let currentRoom = null;
let isHost = false;
let myCustomization = { color: '#000000', accessory: 'none' };
let hangmanRenderer = new HangmanRenderer(document.getElementById('hangman-canvas'));
let avatarRenderer = new HangmanRenderer(avatarCanvas);

// Ricorda nickname e stanza per facilitare il rientro dopo una disconnessione accidentale
const savedUsername = localStorage.getItem('hangman-username');
if (savedUsername) usernameInput.value = savedUsername;

function switchScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenName].classList.add('active');
}

function updateAvatarPreview() {
  avatarRenderer.clear();
  avatarRenderer.drawStickman(1, myCustomization);
}

skinColorInput.addEventListener('input', (e) => {
  myCustomization.color = e.target.value;
  updateAvatarPreview();
  sendCustomization();
});

accessorySelect.addEventListener('change', (e) => {
  myCustomization.accessory = e.target.value;
  updateAvatarPreview();
  sendCustomization();
});

function sendCustomization() {
  if (currentRoom) {
    socket.emit('update-customization', { roomCode: currentRoom, customization: myCustomization });
  }
}

updateAvatarPreview();

document.getElementById('create-room-btn').addEventListener('click', () => {
  const username = usernameInput.value.trim() || 'Giocatore';
  localStorage.setItem('hangman-username', username);
  socket.emit('create-room', { username, customization: myCustomization });
});

document.getElementById('join-room-btn').addEventListener('click', () => {
  const username = usernameInput.value.trim() || 'Giocatore';
  const code = roomCodeInput.value.trim().toUpperCase();
  if (!code) return alert('Inserisci un codice stanza valido');
  localStorage.setItem('hangman-username', username);
  socket.emit('join-room', { roomCode: code, username, customization: myCustomization });
});

readyBtn.addEventListener('click', () => {
  const settings = {
    rounds: roundsSelect.value,
    difficulty: difficultySelect.value
  };
  socket.emit('player-ready', { roomCode: currentRoom, settings });
});

startMatchBtn.addEventListener('click', () => {
  socket.emit('start-match', { roomCode: currentRoom });
});

socket.on('room-created', ({ roomCode, isHost: host }) => {
  currentRoom = roomCode;
  isHost = host;
  displayRoomCode.textContent = roomCode;
  hudRoomCode.textContent = roomCode;
  hostSettings.classList.toggle('hidden', !isHost);
  switchScreen('room');
});

socket.on('room-joined', ({ roomCode, isHost: host }) => {
  currentRoom = roomCode;
  isHost = host;
  displayRoomCode.textContent = roomCode;
  hudRoomCode.textContent = roomCode;
  hostSettings.classList.toggle('hidden', !isHost);
  switchScreen('room');
});

socket.on('error-message', (msg) => {
  alert(msg);
});

socket.on('update-room-state', ({ players, settings, canStart }) => {
  playersUl.innerHTML = '';
  players.forEach(p => {
    const li = document.createElement('li');
    const statusIcon = !p.connected ? '🔌' : (p.ready ? '✅' : '⏳');
    li.textContent = `${p.username} ${statusIcon} ${p.isHost ? '👑' : ''}`;
    if (!p.connected) li.classList.add('disconnected');
    playersUl.appendChild(li);

    // Aggiorna il mio stato host in caso l'host precedente si sia disconnesso
    if (p.id === socket.id) {
      isHost = p.isHost;
      hostSettings.classList.toggle('hidden', !isHost);
    }
  });

  const me = players.find(p => p.id === socket.id);
  if (me) {
    readyBtn.textContent = me.ready ? "Annulla Pronto" : "Pronto";
  }

  if (settings) {
    roundsSelect.value = settings.rounds;
    difficultySelect.value = settings.difficulty;
  }

  startMatchBtn.classList.toggle('hidden', !(isHost && canStart));
});

socket.on('start-game', ({ round, totalRounds, isWriter, writerName, scores }) => {
  switchScreen('game');
  roundInfo.textContent = `Round ${round}/${totalRounds}`;
  renderScores(scores);

  hangmanRenderer.clear();
  hangmanRenderer.drawGallows();

  if (isWriter) {
    roleAnnouncement.textContent = "Tocca a te scegliere la parola!";
    wordCreatorPanel.classList.remove('hidden');
    keyboardPanel.classList.add('hidden');
    wordDisplay.textContent = "_ _ _ _ _";
    hintDisplay.textContent = "Indizio: -";
  } else {
    roleAnnouncement.textContent = `${writerName} sta scegliendo la parola...`;
    wordCreatorPanel.classList.add('hidden');
    keyboardPanel.classList.add('hidden');
  }
});

function renderScores(scores) {
  scoresList.innerHTML = scores
    .map(s => `<span class="score-chip">${s.username}: ${s.score}</span>`)
    .join(' ');
}

submitWordBtn.addEventListener('click', () => {
  const word = secretWordInput.value.trim().toLowerCase();
  const hint = secretHintInput.value.trim();
  if (!word) return alert('Inserisci una parola');
  socket.emit('submit-word', { roomCode: currentRoom, word, hint });
  secretWordInput.value = '';
  secretHintInput.value = '';
  wordCreatorPanel.classList.add('hidden');
  roleAnnouncement.textContent = "Aspettando che gli altri indovinino...";
});

socket.on('guess-turn-start', ({ maskedWord, hint }) => {
  roleAnnouncement.textContent = "Indovina la parola!";
  wordDisplay.textContent = maskedWord;
  hintDisplay.textContent = `Indizio: ${hint}`;
  keyboardPanel.classList.remove('hidden');
  buildKeyboard();
});

function buildKeyboard() {
  virtualKeyboard.innerHTML = '';
  const letters = 'abcdefghijklmnopqrstuvwxyz'.split('');
  letters.forEach(letter => {
    const btn = document.createElement('button');
    btn.textContent = letter.toUpperCase();
    btn.className = 'key-btn';
    btn.addEventListener('click', () => {
      btn.disabled = true;
      socket.emit('make-guess', { roomCode: currentRoom, letter });
    });
    virtualKeyboard.appendChild(btn);
  });
}

socket.on('update-game-state', ({ maskedWord, errors, customConfig }) => {
  wordDisplay.textContent = maskedWord;
  hangmanRenderer.clear();
  hangmanRenderer.drawStickman(errors, customConfig);
});

socket.on('round-over', ({ message, scores }) => {
  roleAnnouncement.textContent = message;
  renderScores(scores);
  keyboardPanel.classList.add('hidden');
  wordCreatorPanel.classList.add('hidden');
});

socket.on('game-over', ({ message, scores }) => {
  roleAnnouncement.textContent = `Partita Finita! ${message}`;
  renderScores(scores);
  setTimeout(() => {
    switchScreen('room');
  }, 4000);
});

chatToggleBtn.addEventListener('click', () => {
  chatContainer.classList.toggle('collapsed');
});

chatSendBtn.addEventListener('click', sendChatMessage);
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') sendChatMessage();
});

function sendChatMessage() {
  const text = chatInput.value.trim();
  if (!text || !currentRoom) return;
  socket.emit('send-chat', { roomCode: currentRoom, message: text });
  chatInput.value = '';
}

socket.on('receive-chat', ({ sender, message }) => {
  const div = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = `${sender}: `;
  div.appendChild(strong);
  div.appendChild(document.createTextNode(message));
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
});
