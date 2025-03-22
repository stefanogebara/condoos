import { WebSocket, WebSocketServer } from 'ws';
import { Server } from 'http';
import { Notification } from '../types/notification';

interface WebSocketClient extends WebSocket {
  userId?: number;
  isAlive: boolean;
}

export class WebSocketService {
  private static wss: WebSocketServer;
  private static clients: Map<number, WebSocketClient[]> = new Map();
  private static pingInterval: NodeJS.Timeout;

  static initialize(server: Server): void {
    this.wss = new WebSocketServer({ server });

    this.wss.on('connection', (ws: WebSocket) => {
      const client = ws as WebSocketClient;
      client.isAlive = true;

      client.on('pong', () => {
        client.isAlive = true;
      });

      client.on('message', (data: Buffer) => {
        try {
          const message = JSON.parse(data.toString());
          if (message.type === 'authenticate' && message.userId) {
            client.userId = message.userId;
            this.addClient(message.userId, client);
          }
        } catch (error) {
          console.error('WebSocket message error:', error);
        }
      });

      client.on('close', () => {
        if (client.userId) {
          this.removeClient(client.userId, client);
        }
      });
    });

    // Set up ping interval to keep connections alive and detect stale ones
    this.pingInterval = setInterval(() => {
      this.wss.clients.forEach((ws: WebSocket) => {
        const client = ws as WebSocketClient;
        if (!client.isAlive) {
          if (client.userId) {
            this.removeClient(client.userId, client);
          }
          return client.terminate();
        }

        client.isAlive = false;
        client.ping();
      });
    }, 30000);

    this.wss.on('close', () => {
      clearInterval(this.pingInterval);
    });
  }

  private static addClient(userId: number, ws: WebSocketClient): void {
    const userClients = this.clients.get(userId) || [];
    userClients.push(ws);
    this.clients.set(userId, userClients);
  }

  private static removeClient(userId: number, ws: WebSocketClient): void {
    const userClients = this.clients.get(userId);
    if (userClients) {
      const index = userClients.indexOf(ws);
      if (index !== -1) {
        userClients.splice(index, 1);
        if (userClients.length === 0) {
          this.clients.delete(userId);
        } else {
          this.clients.set(userId, userClients);
        }
      }
    }
  }

  static sendNotification(userId: number, notification: Notification): void {
    const userClients = this.clients.get(userId);
    if (userClients) {
      const message = JSON.stringify({
        type: 'notification',
        data: notification
      });

      userClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message);
        }
      });
    }
  }

  static cleanup(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    if (this.wss) {
      this.wss.close();
    }
  }
} 