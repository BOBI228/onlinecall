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

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
