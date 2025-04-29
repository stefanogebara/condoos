import { cursorClient } from './cursor-client';

// Listen for connection events
cursorClient.on('connected', () => {
  console.log('Cursor client connected to MCP Server');
});

// Listen for file operations
cursorClient.on('openFile', (params) => {
  console.log('Open file request:', params);
  // Simulate file opening
  cursorClient.sendResponse({
    type: 'response',
    command: 'openFile',
    success: true,
    filePath: params.filePath
  });
});

cursorClient.on('saveFile', (params) => {
  console.log('Save file request:', params);
  // Simulate file saving
  cursorClient.sendResponse({
    type: 'response',
    command: 'saveFile',
    success: true,
    filePath: params.filePath
  });
});

cursorClient.on('runCommand', (params) => {
  console.log('Run command request:', params);
  // Simulate command execution
  cursorClient.sendResponse({
    type: 'response',
    command: 'runCommand',
    success: true,
    output: `Executed command: ${params.command}`
  });
});

// Listen for responses
cursorClient.on('response', (response) => {
  console.log('Received response:', response);
});

// Listen for errors
cursorClient.on('error', (error) => {
  console.error('Error:', error);
});

// Test sending commands
setTimeout(() => {
  if (cursorClient.isConnected()) {
    console.log('Sending test commands...');
    
    // Test opening a file
    cursorClient.sendCommand('openFile', {
      filePath: 'test.txt'
    });

    // Test saving a file
    cursorClient.sendCommand('saveFile', {
      filePath: 'test.txt',
      content: 'Hello, World!'
    });

    // Test running a command
    cursorClient.sendCommand('runCommand', {
      command: 'echo "Hello, World!"'
    });
  } else {
    console.error('Cursor client is not connected');
  }
}, 2000); 