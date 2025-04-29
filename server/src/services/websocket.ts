import { Server, Socket } from 'socket.io';
import { verifyToken } from '../utils/auth';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
}

export const setupWebSocketHandlers = (io: Server) => {
  // Authentication middleware
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth.token;
      if (!token) {
        return next(new Error('Authentication token required'));
      }

      const decoded = await verifyToken(token);
      (socket as AuthenticatedSocket).userId = decoded.userId;
      (socket as AuthenticatedSocket).userRole = decoded.role;
      next();
    } catch (error) {
      next(new Error('Invalid authentication token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const authSocket = socket as AuthenticatedSocket;
    console.log(`User connected: ${authSocket.userId}`);

    // Join user-specific room
    if (authSocket.userId) {
      socket.join(`user:${authSocket.userId}`);
    }

    // Join role-specific room
    if (authSocket.userRole) {
      socket.join(`role:${authSocket.userRole}`);
    }

    // Handle real-time notifications
    socket.on('subscribe:notifications', () => {
      if (authSocket.userId) {
        socket.join(`notifications:${authSocket.userId}`);
      }
    });

    // Handle real-time chat
    socket.on('chat:message', (data) => {
      const { roomId, message } = data;
      io.to(`chat:${roomId}`).emit('chat:message', {
        userId: authSocket.userId,
        message,
        timestamp: new Date().toISOString()
      });
    });

    // Handle disconnection
    socket.on('disconnect', () => {
      console.log(`User disconnected: ${authSocket.userId}`);
    });
  });
}; 