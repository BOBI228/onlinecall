const roomId = window.location.pathname.split('/').filter(Boolean).pop();
const meetingLink = `${window.location.origin}/room/${roomId}`;

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

const configuredIceServers = Array.isArray(window.APP_CONFIG?.iceServers)
  ? window.APP_CONFIG.iceServers.filter((entry) => entry && entry.urls)
  : [];

const ICE_SERVERS = configuredIceServers.length ? configuredIceServers : DEFAULT_ICE_SERVERS;

const socket = io({ autoConnect: false });

const statusElement = document.getElementById('status');
const meetingIdElement = document.getElementById('meeting-id');
const meetingLinkElement = document.getElementById('meeting-link');
const participantsListElement = document.getElementById('participants-list');
const participantsCountElement = document.getElementById('participants-count');
const toggleMicButton = document.getElementById('toggle-mic');
const copyLinkButton = document.getElementById('copy-link');
const leaveButton = document.getElementById('leave-call');
const audioGridElement = document.getElementById('audio-grid');
const localAudioElement = document.getElementById('local-audio');
const localNameElement = document.getElementById('local-name');
const localLabelElement = document.querySelector('.audio-tile--local .audio-tile__label');

let localStream = null;
let microphoneEnabled = true;
let ownSocketId = null;
let joinedRoomOnce = false;
let baseStatus = 'Подключение...';
let flashTimeout;

const peers = new Map();
const remoteTiles = new Map();
const participantNames = new Map();
const remoteMuteStatus = new Map();

function getStoredName() {
  try {
    return window.localStorage.getItem('onlinecall:name');
  } catch (error) {
    return null;
  }
}

function storeName(name) {
  try {
    window.localStorage.setItem('onlinecall:name', name);
  } catch (error) {
    // Ignore storage errors (e.g. private mode)
  }
}

function askDisplayName() {
  const stored = getStoredName();
  const fallback = stored || `Гость ${Math.floor(100 + Math.random() * 900)}`;
  let name = window.prompt('Введите ваше имя для встречи', fallback);
  if (!name || !name.trim()) {
    name = fallback;
  }
  const trimmed = name.trim();
  storeName(trimmed);
  return trimmed;
}

const displayName = askDisplayName();

function setBaseStatus(message) {
  baseStatus = message;
  if (statusElement) {
    statusElement.textContent = message;
  }
}

function flashStatus(message, duration = 3200) {
  if (!statusElement) return;
  statusElement.textContent = message;
  clearTimeout(flashTimeout);
  flashTimeout = setTimeout(() => {
    statusElement.textContent = baseStatus;
  }, duration);
}

function updateLocalMuteLabel() {
  if (!localLabelElement) return;
  localLabelElement.textContent = microphoneEnabled
    ? 'Ваш микрофон'
    : 'Микрофон выключен';
}

function updateParticipantsList() {
  if (!participantsListElement || !participantsCountElement) {
    return;
  }

  participantsListElement.innerHTML = '';
  const entries = Array.from(participantNames.entries());
  participantsCountElement.textContent = String(entries.length);

  entries.forEach(([id, name]) => {
    const li = document.createElement('li');
    const nameNode = document.createElement('strong');
    nameNode.textContent = id === ownSocketId ? `${name} (вы)` : name;
    li.appendChild(nameNode);

    const statusNode = document.createElement('span');
    let muted;
    if (id === ownSocketId) {
      muted = !microphoneEnabled;
    } else if (remoteMuteStatus.has(id)) {
      muted = remoteMuteStatus.get(id);
    } else {
      muted = null;
    }

    if (muted === null) {
      statusNode.textContent = '…';
      statusNode.title = 'Ожидание аудио';
    } else if (muted) {
      statusNode.textContent = '🔇';
      statusNode.title = 'Микрофон выключен';
    } else {
      statusNode.textContent = '🔊';
      statusNode.title = 'В эфире';
    }

    li.appendChild(statusNode);
    participantsListElement.appendChild(li);
  });
}

function ensureRemoteTile(id) {
  if (id === ownSocketId) {
    return null;
  }
  if (!audioGridElement) {
    return null;
  }
  if (remoteTiles.has(id)) {
    const existing = remoteTiles.get(id);
    if (existing && existing.nameElement) {
      existing.nameElement.textContent = participantNames.get(id) || 'Гость';
    }
    return existing;
  }

  const tile = document.createElement('div');
  tile.className = 'audio-tile audio-tile--remote';
  tile.dataset.participant = id;

  const header = document.createElement('div');
  header.className = 'audio-tile__header';

  const nameElement = document.createElement('span');
  nameElement.className = 'audio-tile__name';
  nameElement.textContent = participantNames.get(id) || 'Гость';

  const labelElement = document.createElement('span');
  labelElement.className = 'audio-tile__label';
  labelElement.textContent = 'Ожидаем аудио';

  header.appendChild(nameElement);
  header.appendChild(labelElement);

  const audioElement = document.createElement('audio');
  audioElement.autoplay = true;
  audioElement.playsInline = true;

  tile.appendChild(header);
  tile.appendChild(audioElement);
  audioGridElement.appendChild(tile);

  const tileData = {
    tile,
    audioElement,
    nameElement,
    labelElement
  };
  remoteTiles.set(id, tileData);
  return tileData;
}

function setRemoteMuted(id, muted) {
  const normalized = Boolean(muted);
  remoteMuteStatus.set(id, normalized);
  const tile = remoteTiles.get(id);
  if (tile) {
    tile.tile.classList.toggle('muted', normalized);
    if (tile.labelElement) {
      tile.labelElement.textContent = normalized ? 'Микрофон выключен' : 'В эфире';
    }
  }
  updateParticipantsList();
}

function removeRemoteTile(id) {
  if (remoteTiles.has(id)) {
    const tile = remoteTiles.get(id);
    if (tile?.audioElement) {
      tile.audioElement.srcObject = null;
    }
    tile?.tile?.remove();
    remoteTiles.delete(id);
  }
  remoteMuteStatus.delete(id);
}

async function createPeerConnection(peerId, initiator = false) {
  if (peers.has(peerId)) {
    return peers.get(peerId);
  }

  const configuration = {
    iceServers: ICE_SERVERS
  };

  const peerConnection = new RTCPeerConnection(configuration);
  peers.set(peerId, peerConnection);

  if (localStream) {
    localStream.getTracks().forEach((track) => {
      peerConnection.addTrack(track, localStream);
    });
  }

  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('signal', {
        target: peerId,
        candidate: event.candidate
      });
    }
  };

  peerConnection.ontrack = (event) => {
    const [stream] = event.streams;
    if (!stream) {
      return;
    }
    const tile = ensureRemoteTile(peerId);
    if (tile?.audioElement) {
      tile.audioElement.srcObject = stream;
      tile.audioElement
        .play()
        .catch((error) => console.warn('Автовоспроизведение отклонено', error));
    }

    const [audioTrack] = stream.getAudioTracks();
    if (audioTrack) {
      setRemoteMuted(peerId, audioTrack.muted);
      audioTrack.onmute = () => setRemoteMuted(peerId, true);
      audioTrack.onunmute = () => setRemoteMuted(peerId, false);
      audioTrack.onended = () => setRemoteMuted(peerId, true);
    } else {
      setRemoteMuted(peerId, true);
    }
  };

  peerConnection.onconnectionstatechange = () => {
    if (
      peerConnection.connectionState === 'failed' ||
      peerConnection.connectionState === 'disconnected'
    ) {
      flashStatus('Потеряно соединение с одним из участников');
    }
    if (peerConnection.connectionState === 'closed') {
      peers.delete(peerId);
    }
  };

  if (initiator) {
    try {
      const offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      socket.emit('signal', {
        target: peerId,
        description: peerConnection.localDescription
      });
    } catch (error) {
      console.error('Не удалось создать предложение для участника', error);
    }
  }

  return peerConnection;
}

function closePeer(peerId) {
  if (peers.has(peerId)) {
    try {
      peers.get(peerId).close();
    } catch (error) {
      console.warn('Ошибка при закрытии соединения', error);
    }
    peers.delete(peerId);
  }
  removeRemoteTile(peerId);
}

function cleanupRemotePeers() {
  Array.from(peers.keys()).forEach(closePeer);
  remoteTiles.forEach((tile, id) => {
    if (tile?.audioElement) {
      tile.audioElement.srcObject = null;
    }
    tile?.tile?.remove();
  });
  peers.clear();
  remoteTiles.clear();
  remoteMuteStatus.clear();
}

async function handleSignal({ from, description, candidate }) {
  try {
    const peerConnection = await createPeerConnection(from, false);
    if (description) {
      if (description.type === 'offer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        socket.emit('signal', {
          target: from,
          description: peerConnection.localDescription
        });
      } else if (description.type === 'answer') {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(description));
      }
    }

    if (candidate) {
      await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    }
  } catch (error) {
    console.error('Ошибка обработки сигнала WebRTC', error);
  }
}

function copyMeetingLink() {
  if (!meetingLink) return;
  if (navigator.clipboard?.writeText) {
    navigator.clipboard
      .writeText(meetingLink)
      .then(() => flashStatus('Ссылка скопирована в буфер обмена'))
      .catch((error) => {
        console.warn('Не удалось скопировать через clipboard API', error);
        legacyCopy(meetingLink);
      });
  } else {
    legacyCopy(meetingLink);
  }
}

function legacyCopy(text) {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'absolute';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  try {
    document.execCommand('copy');
    flashStatus('Ссылка скопирована в буфер обмена');
  } catch (error) {
    console.warn('Не удалось скопировать ссылку', error);
  }
  document.body.removeChild(textarea);
}

function toggleMicrophone() {
  if (!localStream) {
    return;
  }
  microphoneEnabled = !microphoneEnabled;
  localStream.getAudioTracks().forEach((track) => {
    track.enabled = microphoneEnabled;
  });
  if (toggleMicButton) {
    toggleMicButton.textContent = microphoneEnabled
      ? 'Выключить микрофон'
      : 'Включить микрофон';
    toggleMicButton.classList.toggle('button--primary', microphoneEnabled);
  }
  if (localAudioElement) {
    localAudioElement.muted = true;
  }
  updateLocalMuteLabel();
  updateParticipantsList();
}

function leaveMeeting() {
  if (socket.connected) {
    socket.disconnect();
  }
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }
  window.location.href = '/';
}

function handleUserJoined({ id, name }) {
  if (!id) return;
  const participantName = name && name.trim() ? name.trim() : 'Гость';
  participantNames.set(id, participantName);
  ensureRemoteTile(id);
  updateParticipantsList();
  flashStatus(`${participantName} присоединился к встрече`);
}

function handleUserLeft({ id }) {
  if (!id) return;
  const name = participantNames.get(id) || 'Участник';
  participantNames.delete(id);
  closePeer(id);
  updateParticipantsList();
  flashStatus(`${name} покинул встречу`);
}

function setupSocketListeners() {
  socket.on('init', async ({ id, participants }) => {
    ownSocketId = id;
    joinedRoomOnce = true;

    cleanupRemotePeers();
    participantNames.clear();
    participantNames.set(id, displayName);
    updateParticipantsList();

    if (localNameElement) {
      localNameElement.textContent = `${displayName} (вы)`;
    }

    if (Array.isArray(participants)) {
      for (const participant of participants) {
        if (!participant || !participant.id) continue;
        const participantName = participant.name || 'Гость';
        participantNames.set(participant.id, participantName);
        ensureRemoteTile(participant.id);
        await createPeerConnection(participant.id, true);
      }
    }

    updateParticipantsList();
    if (participants && participants.length > 0) {
      setBaseStatus('Вы подключены к встрече. Идёт настройка аудио.');
    } else {
      setBaseStatus('Вы в комнате. Поделитесь ссылкой, чтобы пригласить других.');
    }
  });

  socket.on('user-joined', handleUserJoined);
  socket.on('user-left', handleUserLeft);
  socket.on('signal', handleSignal);

  socket.on('disconnect', () => {
    if (!joinedRoomOnce) {
      return;
    }
    setBaseStatus('Связь с сервером потеряна. Переподключение...');
  });

  socket.io.on('reconnect', () => {
    setBaseStatus('Переподключение выполнено. Восстанавливаем встречу...');
    if (localStream) {
      socket.emit('join-room', { roomId, name: displayName });
    }
  });

  socket.on('connect_error', () => {
    if (!joinedRoomOnce) {
      setBaseStatus('Не удаётся подключиться к серверу. Попробуйте обновить страницу.');
    }
  });
}

async function init() {
  if (meetingIdElement) {
    meetingIdElement.textContent = roomId;
  }
  if (meetingLinkElement) {
    meetingLinkElement.textContent = meetingLink;
  }
  if (localNameElement) {
    localNameElement.textContent = `${displayName} (вы)`;
  }
  updateLocalMuteLabel();
  updateParticipantsList();

  try {
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (localAudioElement) {
      localAudioElement.srcObject = localStream;
    }
    setBaseStatus('Вы в комнате. Поделитесь ссылкой, чтобы пригласить других.');
  } catch (error) {
    console.error('Не удалось получить доступ к микрофону', error);
    setBaseStatus('Не удалось получить доступ к микрофону. Проверьте разрешения в браузере.');
    if (toggleMicButton) {
      toggleMicButton.disabled = true;
    }
    return;
  }

  setupSocketListeners();
  socket.connect();
  socket.emit('join-room', { roomId, name: displayName });
}

if (copyLinkButton) {
  copyLinkButton.addEventListener('click', (event) => {
    event.preventDefault();
    copyMeetingLink();
  });
}

if (toggleMicButton) {
  toggleMicButton.addEventListener('click', (event) => {
    event.preventDefault();
    toggleMicrophone();
  });
}

if (leaveButton) {
  leaveButton.addEventListener('click', (event) => {
    event.preventDefault();
    leaveMeeting();
  });
}

window.addEventListener('beforeunload', () => {
  if (socket.connected) {
    socket.disconnect();
  }
  if (localStream) {
    localStream.getTracks().forEach((track) => track.stop());
  }
});

init();
