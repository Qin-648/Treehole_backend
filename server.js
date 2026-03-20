const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());

// 创建 HTTP 服务器
const server = http.createServer(app);

// 配置 Socket.io
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// 存储在线用户 { phone: socketId }
const onlineUsers = new Map();

// 存储通话状态
const activeCalls = new Map();

io.on('connection', (socket) => {
  console.log('用户连接:', socket.id);

  // 用户登录
  socket.on('user:login', (data) => {
    const { phone, avatar, gender } = data;
    onlineUsers.set(phone, socket.id);

    // 保存用户信息到 socket
    socket.userPhone = phone;
    socket.userAvatar = avatar;
    socket.userGender = gender;

    // 通知所有用户有新用户上线
    io.emit('user:online', {
      phone,
      avatar,
      gender
    });

    console.log('用户上线:', phone, '当前在线人数:', onlineUsers.size);
  });

  // 发起通话
  socket.on('call:start', (data) => {
    const { to, type, fromAvatar, fromGender, fromPhone } = data;
    const receiverSocketId = onlineUsers.get(to);

    if (receiverSocketId) {
      const callId = Date.now().toString();
      const callData = {
        callId,
        caller: fromPhone,
        receiver: to,
        type, // 'video' 或 'voice'
        callerAvatar: fromAvatar,
        callerGender: fromGender,
        status: 'ringing',
        timestamp: Date.now()
      };

      activeCalls.set(callId, callData);

      // 发送给接收方
      io.to(receiverSocketId).emit('call:incoming', callData);

      // 告知发送方已发起
      socket.emit('call:started', { callId });
    } else {
      // 用户不在线
      socket.emit('call:error', { message: '对方不在线' });
    }
  });

  // 接听通话
  socket.on('call:answer', (data) => {
    const { callId, offer } = data;
    const call = activeCalls.get(callId);

    if (call) {
      call.status = 'connected';
      const callerSocketId = onlineUsers.get(call.caller);

      if (callerSocketId) {
        io.to(callerSocketId).emit('call:answered', {
          callId,
          answer: offer
        });
      }
    }
  });

  // WebRTC 信令 - Offer
  socket.on('webrtc:offer', (data) => {
    const { to, offer, callId } = data;
    const receiverSocketId = onlineUsers.get(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit('webrtc:offer', {
        from: socket.userPhone,
        offer,
        callId
      });
    }
  });

  // WebRTC 信令 - Answer
  socket.on('webrtc:answer', (data) => {
    const { to, answer, callId } = data;
    const receiverSocketId = onlineUsers.get(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit('webrtc:answer', {
        from: socket.userPhone,
        answer,
        callId
      });
    }
  });

  // WebRTC 信令 - ICE Candidate
  socket.on('webrtc:ice', (data) => {
    const { to, candidate, callId } = data;
    const receiverSocketId = onlineUsers.get(to);

    if (receiverSocketId) {
      io.to(receiverSocketId).emit('webrtc:ice', {
        from: socket.userPhone,
        candidate,
        callId
      });
    }
  });

  // 拒绝通话
  socket.on('call:reject', (data) => {
    const { callId } = data;
    const call = activeCalls.get(callId);

    if (call) {
      call.status = 'rejected';
      const callerSocketId = onlineUsers.get(call.caller);

      if (callerSocketId) {
        io.to(callerSocketId).emit('call:rejected', { callId });
      }

      activeCalls.delete(callId);
    }
  });

  // 结束通话
  socket.on('call:end', (data) => {
    const { callId } = data;
    const call = activeCalls.get(callId);

    if (call) {
      call.status = 'ended';

      // 通知对方
      const otherPhone = call.caller === socket.userPhone ? call.receiver : call.caller;
      const otherSocketId = onlineUsers.get(otherPhone);

      if (otherSocketId) {
        io.to(otherSocketId).emit('call:ended', { callId });
      }

      activeCalls.delete(callId);
    }
  });

  // 用户断开连接
  socket.on('disconnect', () => {
    console.log('用户断开:', socket.id);

    if (socket.userPhone) {
      onlineUsers.delete(socket.userPhone);
      io.emit('user:offline', {
        phone: socket.userPhone
      });
      console.log('用户下线:', socket.userPhone, '当前在线人数:', onlineUsers.size);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`服务器运行在端口 ${PORT}`);
});
