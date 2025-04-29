import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer } from 'http';
import dotenv from 'dotenv';
import { v4 as uuidv4 } from 'uuid';
import { supabase } from './lib/supabase';

dotenv.config();

const app = express();
const port = process.env.PORT || 3002;

// Create HTTP server
const server = createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });

// Store connected clients and their subscriptions
const clients = new Map<string, WebSocket>();
const subscriptions = new Map<string, Set<string>>(); // clientId -> channels

// Message types
type MessageType = 'welcome' | 'subscribe' | 'unsubscribe' | 'broadcast' | 'notification' | 'error';

interface Message {
  type: MessageType;
  channel?: string;
  content?: any;
  timestamp?: string;
  clientId?: string;
}

// WebSocket connection handler
wss.on('connection', (ws: WebSocket) => {
  const clientId = uuidv4();
  clients.set(clientId, ws);
  subscriptions.set(clientId, new Set());

  console.log(`Client connected: ${clientId}`);

  // Send welcome message
  ws.send(JSON.stringify({
    type: 'welcome',
    clientId,
    message: 'Connected to MCP Server',
    timestamp: new Date().toISOString()
  }));

  // Handle messages from clients
  ws.on('message', async (message) => {
    try {
      const data: Message = JSON.parse(message.toString());
      console.log(`Received message from ${clientId}:`, data);

      // Handle different message types
      switch (data.type) {
        case 'subscribe':
          if (data.channel) {
            subscriptions.get(clientId)?.add(data.channel);
            ws.send(JSON.stringify({
              type: 'notification',
              content: `Subscribed to channel: ${data.channel}`,
              channel: data.channel,
              timestamp: new Date().toISOString()
            }));
          }
          break;

        case 'unsubscribe':
          if (data.channel) {
            subscriptions.get(clientId)?.delete(data.channel);
            ws.send(JSON.stringify({
              type: 'notification',
              content: `Unsubscribed from channel: ${data.channel}`,
              channel: data.channel,
              timestamp: new Date().toISOString()
            }));
          }
          break;

        case 'broadcast':
          if (data.channel) {
            // Broadcast to specific channel
            broadcastToChannel(data.channel, {
              ...data,
              clientId,
              timestamp: new Date().toISOString()
            });
          } else {
            // Broadcast to all clients
            broadcastMessage({
              ...data,
              clientId,
              timestamp: new Date().toISOString()
            });
          }
          break;

        default:
          ws.send(JSON.stringify({
            type: 'error',
            content: `Unknown message type: ${data.type}`,
            timestamp: new Date().toISOString()
          }));
      }
    } catch (error) {
      console.error('Error processing message:', error);
      ws.send(JSON.stringify({
        type: 'error',
        content: 'Invalid message format',
        timestamp: new Date().toISOString()
      }));
    }
  });

  // Handle client disconnection
  ws.on('close', () => {
    console.log(`Client disconnected: ${clientId}`);
    clients.delete(clientId);
    subscriptions.delete(clientId);
  });
});

// Broadcast message to all connected clients
function broadcastMessage(message: Message) {
  const messageStr = JSON.stringify(message);
  clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(messageStr);
    }
  });
}

// Broadcast message to specific channel
function broadcastToChannel(channel: string, message: Message) {
  const messageStr = JSON.stringify(message);
  clients.forEach((client, clientId) => {
    if (client.readyState === WebSocket.OPEN && subscriptions.get(clientId)?.has(channel)) {
      client.send(messageStr);
    }
  });
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    connectedClients: clients.size,
    activeSubscriptions: Array.from(subscriptions.entries()).reduce((acc, [clientId, channels]) => {
      acc[clientId] = Array.from(channels);
      return acc;
    }, {} as Record<string, string[]>),
    uptime: process.uptime()
  });
});

// Start server
server.listen(port, () => {
  console.log(`MCP Server running on port ${port}`);
}); 