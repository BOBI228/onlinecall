const createButton = document.getElementById('create-meeting');
const joinButton = document.getElementById('join-meeting');
const roomInput = document.getElementById('room-code');
const errorElement = document.getElementById('error');

function setError(message) {
  if (!errorElement) return;
  errorElement.textContent = message || '';
  errorElement.style.visibility = message ? 'visible' : 'hidden';
}

async function createMeeting() {
  try {
    if (createButton) {
      createButton.disabled = true;
    }
    setError('');
    const response = await fetch('/new');
    if (!response.ok) {
      throw new Error('Не удалось создать комнату');
    }
    const data = await response.json();
    if (!data.roomId) {
      throw new Error('Сервер не вернул идентификатор комнаты');
    }
    window.location.href = `/room/${data.roomId}`;
  } catch (error) {
    console.error(error);
    setError('Что-то пошло не так. Попробуйте ещё раз.');
  } finally {
    if (createButton) {
      createButton.disabled = false;
    }
  }
}

function extractRoomId(value) {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/room\/([\w-]+)/i);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

function joinMeeting() {
  const roomValue = roomInput ? roomInput.value : '';
  const roomId = extractRoomId(roomValue);
  if (!roomId) {
    setError('Введите код комнаты или ссылку.');
    return;
  }
  window.location.href = `/room/${roomId}`;
}

if (createButton) {
  createButton.addEventListener('click', (event) => {
    event.preventDefault();
    createMeeting();
  });
}

if (joinButton) {
  joinButton.addEventListener('click', (event) => {
    event.preventDefault();
    joinMeeting();
  });
}

if (roomInput) {
  roomInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      joinMeeting();
    }
  });
}

setError('');
