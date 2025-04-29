import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:3002');

ws.on('open', () => {
  console.log('Connected to MCP Server');

  // Send a test broadcast message
  const testMessage = {
    type: 'broadcast',
    content: 'Hello from test client!',
    timestamp: new Date().toISOString()
  };

  ws.send(JSON.stringify(testMessage));
});

ws.on('message', (data) => {
  const message = JSON.parse(data.toString());
  console.log('Received:', message);
});

ws.on('close', () => {
  console.log('Disconnected from MCP Server');
});

ws.on('error', (error) => {
  console.error('WebSocket error:', error);
}); 