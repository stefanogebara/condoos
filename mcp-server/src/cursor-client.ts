import WebSocket from 'ws';
import { EventEmitter } from 'events';

interface CursorMessage {
  type: 'command' | 'response' | 'error';
  command?: string;
  content?: any;
  timestamp?: string;
}

class CursorClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private clientId: string | null = null;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private reconnectDelay = 5000;

  constructor(private url: string = 'ws://localhost:3002') {
    super();
    this.connect();
  }

  private connect() {
    this.ws = new WebSocket(this.url);

    this.ws.on('open', () => {
      console.log('Cursor client connected to MCP Server');
      this.reconnectAttempts = 0;
      this.emit('connected');
      
      // Subscribe to Cursor-specific channel
      this.subscribe('cursor');
    });

    this.ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString());
        
        if (message.type === 'welcome') {
          this.clientId = message.clientId;
          console.log(`Cursor client ID: ${this.clientId}`);
        }

        // Handle Cursor-specific messages
        if (message.channel === 'cursor') {
          this.handleCursorMessage(message);
        }

        this.emit('message', message);
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    this.ws.on('close', () => {
      console.log('Cursor client disconnected from MCP Server');
      this.handleReconnect();
    });

    this.ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      this.emit('error', error);
    });
  }

  private handleCursorMessage(message: any) {
    switch (message.content?.type) {
      case 'command':
        this.executeCommand(message.content.command, message.content.params);
        break;
      case 'response':
        this.handleResponse(message.content);
        break;
      case 'error':
        this.handleError(message.content);
        break;
    }
  }

  private executeCommand(command: string, params: any) {
    // Execute Cursor-specific commands
    switch (command) {
      case 'openFile':
        this.emit('openFile', params);
        break;
      case 'saveFile':
        this.emit('saveFile', params);
        break;
      case 'runCommand':
        this.emit('runCommand', params);
        break;
      default:
        console.log(`Unknown command: ${command}`);
    }
  }

  private handleResponse(response: any) {
    this.emit('response', response);
  }

  private handleError(error: any) {
    this.emit('error', error);
  }

  private handleReconnect() {
    if (this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
      
      setTimeout(() => {
        this.connect();
      }, this.reconnectDelay);
    } else {
      console.error('Max reconnection attempts reached');
      this.emit('maxReconnectAttemptsReached');
    }
  }

  public subscribe(channel: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'subscribe',
        channel
      }));
    }
  }

  public unsubscribe(channel: string) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe',
        channel
      }));
    }
  }

  public sendCommand(command: string, params: any = {}) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'broadcast',
        channel: 'cursor',
        content: {
          type: 'command',
          command,
          params,
          timestamp: new Date().toISOString()
        }
      }));
    }
  }

  public sendResponse(response: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'broadcast',
        channel: 'cursor',
        content: {
          type: 'response',
          ...response,
          timestamp: new Date().toISOString()
        }
      }));
    }
  }

  public isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  public getClientId(): string | null {
    return this.clientId;
  }
}

// Create a singleton instance
export const cursorClient = new CursorClient();
export default cursorClient; 