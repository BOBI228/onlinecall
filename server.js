
require('dotenv').config();

const path = require('path');
const http = require('http');
const express = require('express');
const compression = require('compression');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');

const DEFAULT_ICE_SERVERS = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' }
];

function parseIceServers(value) {
  if (!value) {
    return DEFAULT_ICE_SERVERS;
  }

  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    console.warn('ICE_SERVERS must be a JSON array. Falling back to defaults.');
  } catch (error) {
    console.warn('Unable to parse ICE_SERVERS. Falling back to defaults.', error);
  }

  return DEFAULT_ICE_SERVERS;
}

function parseOrigins(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY ?? '1');
app.use(compression());

const iceServers = parseIceServers(process.env.ICE_SERVERS);
const allowedOrigins = parseOrigins(process.env.CORS_ORIGINS);

const server = http.createServer(app);
const io = new Server(
  server,
  allowedOrigins.length
    ? {
        cors: {
          origin: allowedOrigins,
          methods: ['GET', 'POST'],
          credentials: true
        }
      }
    : undefined
);

const rawPort = Number.parseInt(process.env.PORT ?? '3000', 10);
const PORT = Number.isNaN(rawPort) ? 3000 : rawPort;
const HOST = process.env.HOST || '0.0.0.0';

app.get('/healthz', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/app-config.js', (req, res) => {
  res.type('application/javascript');
  res.set('Cache-Control', 'no-store');
  res.send(`window.APP_CONFIG = ${JSON.stringify({ iceServers })};`);
});

const path = require('path');
const http = require('http');
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;


app.use(express.static(path.join(__dirname, 'public')));

app.get('/new', (req, res) => {
  res.json({ roomId: uuidv4() });
});

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'room.html'));
});

io.on('connection', (socket) => {
  socket.on('join-room', ({ roomId, name }) => {
    if (!roomId) {
      return;
    }

    socket.data.roomId = roomId;
    socket.data.name = name && name.trim() ? name.trim() : 'Guest';

    const room = io.sockets.adapter.rooms.get(roomId);
    const existingUsers = room ? Array.from(room) : [];

    socket.join(roomId);

    const participants = existingUsers.map((id) => {
      const participantSocket = io.sockets.sockets.get(id);
      return {
        id,
        name: participantSocket?.data?.name || 'Guest'
      };
    });

    socket.emit('init', {
      id: socket.id,
      participants
    });

    socket.to(roomId).emit('user-joined', {
      id: socket.id,
      name: socket.data.name
    });
  });

  socket.on('signal', (payload) => {
    const { target, description, candidate } = payload || {};
    const roomId = socket.data?.roomId;
    if (!roomId || !target) {
      return;
    }

    const targetSocket = io.sockets.sockets.get(target);
    if (!targetSocket) {
      return;
    }

    if (targetSocket.data?.roomId !== roomId) {
      return;
    }

    targetSocket.emit('signal', {
      from: socket.id,
      description,
      candidate
    });
  });

  socket.on('disconnect', () => {
    const roomId = socket.data?.roomId;
    if (roomId) {
      socket.to(roomId).emit('user-left', { id: socket.id });
    }
  });
});


server.listen(PORT, HOST, () => {
  const displayHost = HOST === '0.0.0.0' ? '0.0.0.0 (all interfaces)' : HOST;
  console.log(`Server listening on ${displayHost}:${PORT}`);
  if (allowedOrigins.length) {
    console.log(`Socket.IO CORS whitelist: ${allowedOrigins.join(', ')}`);
  }
  console.log(
    `Using ${iceServers.length} ICE server${iceServers.length === 1 ? '' : 's'} for WebRTC signalling.`
  );

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);

});
