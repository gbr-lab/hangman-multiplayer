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
const roomBadge = document.getElementById('room-badge');
const playersUl = document.getElementById('players-ul');
const readyBtn = document.getElementById('ready-btn');
const startMatchBtn = document.getElementById('start-match-btn');
const shareLinkBtn = document.getElementById('share-link-btn');

const skinColorMenu = document.getElementById('skin-color');
const skinColorRoom = document.getElementById('skin-color-room');
const roomCustomizationBox = document.getElementById('room-customization');

const hostSettings = document.getElementById('host-settings');
const roundsSelect = document.getElementById('rounds-select');
const difficultySelect = document.getElementById('difficulty-select');

const roundInfo = document.getElementById('round-info');
const scoresList = document.getElementById('scores-list');
const categoryDisplay = document.getElementById('category-display');
const wordDisplay = document.getElementById('word-display');
const hintsDisplay = document.getElementById('hints-display');
const roleAnnouncement = document.getElementById('role-announcement');

const wordCreatorPanel = document.getElementById('word-creator-panel');
const categorySelect = document.getElementById('category-select');
const secretWordInput = document.getElementById('secret-word-input');
const hintsInputList = document.getElementById('hints-input-list');
const addHintBtn = document.getElementById('add-hint-btn');
const submitWordBtn = document.getElementById('submit-word-btn');

const keyboardPanel = document.getElementById('keyboard-panel');
const virtualKeyboard = document.getElementById('virtual-keyboard');

const chatContainer = document.getElementById('chat-container');
const chatToggleBtn = document.getElementById('chat-toggle-btn');
const chatBadge = document.getElementById('chat-badge');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const chatSendBtn = document.getElementById('chat-send-btn');
const chatScrollBottomBtn = document.getElementById('chat-scroll-bottom-btn');

let currentRoom = null;
let isHost = false;
let myCustomization = { color: '#000000' };
let hangmanRenderer = new HangmanRenderer(document.getElementById('hangman-canvas'));
let hintInputCount = 0;

// --- Ricorda nickname e prendi eventuale codice stanza dal link condiviso ---
const savedUsername = localStorage.getItem('hangman-username');
if (savedUsername) usernameInput.value = savedUsername;

const savedColor = localStorage.getItem('hangman-color');
if (savedColor) {
  myCustomization.color = savedColor;
  skinColorMenu.value = savedColor;
  skinColorRoom.value = savedColor;
}

const urlParams = new URLSearchParams(window.location.search);
const linkedRoom = urlParams.get('room');
if (linkedRoom) {
  roomCodeInput.value = linkedRoom.toUpperCase();
  usernameInput.focus();
}

function switchScreen(screenName) {
  Object.values(screens).forEach(s => s.classList.remove('active'));
  screens[screenName].classList.add('active');
}

function setColor(value) {
  myCustomization.color = value;
  skinColorMenu.value = value;
  skinColorRoom.value = value;
  localStorage.setItem('hangman-color', value);
  sendCustomization();
}

skinColorMenu.addEventListener('input', (e) => setColor(e.target.value));
skinColorRoom.addEventListener('input', (e) => setColor(e.target.value));

function sendCustomization() {
  if (currentRoom) {
    socket.emit('update-customization', { roomCode: currentRoom, customization: myCustomization });
  }
}

// --- Creazione / accesso stanza ---
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

// --- Copia codice stanza al click ---
function copyRoomCode(el) {
  if (!currentRoom) return;
  navigator.clipboard.writeText(currentRoom).then(() => {
    const original = el.textContent;
    el.textContent = 'Copiato!';
    setTimeout(() => { el.textContent = original.includes('Copiato') ? currentRoom : original; }, 1200);
  }).catch(() => {});
}
displayRoomCode.addEventListener('click', () => copyRoomCode(displayRoomCode));
roomBadge.addEventListener('click', () => {
  navigator.clipboard.writeText(currentRoom).then(() => {
    roomBadge.classList.add('copied-flash');
    setTimeout(() => roomBadge.classList.remove('copied-flash'), 700);
  }).catch(() => {});
});

// --- Condividi link invito ---
shareLinkBtn.addEventListener('click', () => {
  if (!currentRoom) return;
  const link = `${window.location.origin}${window.location.pathname}?room=${currentRoom}`;
  navigator.clipboard.writeText(link).then(() => {
    shareLinkBtn.textContent = '✅ Link copiato!';
    setTimeout(() => { shareLinkBtn.textContent = '🔗 Condividi link invito'; }, 1500);
  }).catch(() => {
    prompt('Copia questo link:', link);
  });
});

// --- Eventi stanza ---
socket.on('room-created', ({ roomCode, isHost: host }) => {
  currentRoom = roomCode;
  isHost = host;
  displayRoomCode.textContent = roomCode;
  hudRoomCode.textContent = roomCode;
  hostSettings.classList.toggle('hidden', !isHost);
  roomCustomizationBox.classList.toggle('hidden', isHost); // l'host ha già scelto il colore nel menu
  switchScreen('room');
});

socket.on('room-joined', ({ roomCode, isHost: host }) => {
  currentRoom = roomCode;
  isHost = host;
  displayRoomCode.textContent = roomCode;
  hudRoomCode.textContent = roomCode;
  hostSettings.classList.toggle('hidden', !isHost);
  roomCustomizationBox.classList.toggle('hidden', isHost);
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

    if (p.id === socket.id) {
      isHost = p.isHost;
      hostSettings.classList.toggle('hidden', !isHost);
      roomCustomizationBox.classList.toggle('hidden', isHost);
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

// --- Partita ---
socket.on('start-game', ({ round, totalRounds, isWriter, writerName, scores }) => {
  switchScreen('game');
  roundInfo.textContent = `Round ${round}/${totalRounds}`;
  renderScores(scores);
  resetWordCreatorForm();

  categoryDisplay.classList.add('hidden');
  hintsDisplay.innerHTML = '';
  keyboardPanel.classList.add('hidden');

  hangmanRenderer.clear();
  hangmanRenderer.drawGallows();

  if (isWriter) {
    roleAnnouncement.textContent = "Tocca a te scegliere la parola!";
    wordCreatorPanel.classList.remove('hidden');
    wordDisplay.textContent = "_ _ _ _ _";
  } else {
    roleAnnouncement.textContent = `${writerName} sta scegliendo la parola...`;
    wordCreatorPanel.classList.add('hidden');
  }
});

function renderScores(scores) {
  scoresList.innerHTML = scores
    .map(s => `<span class="score-chip">${s.username}: ${s.score}</span>`)
    .join(' ');
}

// --- Form scrittura parola: categoria + fino a 3 indizi con "+" ---
function resetWordCreatorForm() {
  categorySelect.value = '';
  secretWordInput.value = '';
  hintsInputList.innerHTML = '';
  hintInputCount = 0;
  addHintBtn.classList.remove('hidden');
}

addHintBtn.addEventListener('click', () => {
  if (hintInputCount >= 3) return;
  hintInputCount++;
  const row = document.createElement('input');
  row.type = 'text';
  row.className = 'hint-input';
  row.placeholder = `Indizio ${hintInputCount}`;
  hintsInputList.appendChild(row);
  if (hintInputCount >= 3) addHintBtn.classList.add('hidden');
});

submitWordBtn.addEventListener('click', () => {
  const word = secretWordInput.value.trim().toLowerCase();
  if (!word) return alert('Inserisci una parola');
  const category = categorySelect.value;
  const hints = Array.from(hintsInputList.querySelectorAll('.hint-input')).map(i => i.value);

  socket.emit('submit-word', { roomCode: currentRoom, word, category, hints });

  wordCreatorPanel.classList.add('hidden');
  roleAnnouncement.textContent = "Aspettando che gli altri indovinino...";
});

// --- Turno di indovinare (chi scrive la parola non riceve questo evento) ---
socket.on('guess-turn-start', ({ maskedWord, category, hints }) => {
  roleAnnouncement.textContent = "Indovina la parola!";
  wordDisplay.textContent = maskedWord;

  if (category) {
    categoryDisplay.textContent = `Categoria: ${category}`;
    categoryDisplay.classList.remove('hidden');
  } else {
    categoryDisplay.classList.add('hidden');
  }

  hintsDisplay.innerHTML = (hints || [])
    .map((h, i) => `<div class="hint">Indizio ${i + 1}: ${h}</div>`)
    .join('');

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

// --- Chat ---
chatToggleBtn.addEventListener('click', () => {
  chatContainer.classList.toggle('collapsed');
  if (!chatContainer.classList.contains('collapsed')) {
    chatBadge.classList.add('hidden');
    scrollChatToBottom(false);
  }
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

function isChatScrolledToBottom() {
  return chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight < 30;
}

function scrollChatToBottom(smooth = true) {
  chatMessages.scrollTo({ top: chatMessages.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  chatScrollBottomBtn.classList.add('hidden');
}

chatMessages.addEventListener('scroll', () => {
  chatScrollBottomBtn.classList.toggle('hidden', isChatScrolledToBottom());
});

chatScrollBottomBtn.addEventListener('click', () => scrollChatToBottom(true));

socket.on('receive-chat', ({ sender, message }) => {
  const wasAtBottom = isChatScrolledToBottom();

  const div = document.createElement('div');
  const strong = document.createElement('strong');
  strong.textContent = `${sender}: `;
  div.appendChild(strong);
  div.appendChild(document.createTextNode(message));
  chatMessages.appendChild(div);

  if (chatContainer.classList.contains('collapsed')) {
    chatBadge.classList.remove('hidden');
  } else if (wasAtBottom) {
    scrollChatToBottom(true);
  } else {
    chatScrollBottomBtn.classList.remove('hidden');
  }
});
