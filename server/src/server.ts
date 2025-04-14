import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { Clerk } from '@clerk/clerk-sdk-node';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

// Configure CORS to allow requests from frontend
app.use(cors({
  origin: ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:3002', 'http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:3002'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Accept', 'Authorization'],
  credentials: true
}));

app.use(express.json());

// Log all incoming requests
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
  next();
});

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Condo Management API Server',
    status: 'running',
    endpoints: {
      health: '/api/health',
      testSetup: '/api/test/setup-test-company'
    }
  });
});

// Verify environment variables
if (!process.env.CLERK_SECRET_KEY) {
  console.error('ERROR: CLERK_SECRET_KEY is not set in .env file');
  process.exit(1);
}

// Test routes (only in development)
app.post('/api/test/setup-test-company', async (req, res) => {
  try {
    console.log('Creating test company...');
    const clerk = Clerk({ secretKey: process.env.CLERK_SECRET_KEY });
    
    // Check if test user already exists
    console.log('Checking for existing test company...');
    const existingUsers = await clerk.users.getUserList({
      emailAddress: ['test@company.com'],
    });

    if (existingUsers.length > 0) {
      console.log('Test company already exists');
      return res.json({ 
        message: 'Test company already exists',
        user: existingUsers[0]
      });
    }

    // Create test company user
    console.log('Creating new test company user...');
    const user = await clerk.users.createUser({
      emailAddress: ['test@company.com'],
      password: 'testcompany123',
      firstName: 'Test',
      lastName: 'Company',
      publicMetadata: {
        role: 'company',
        companyName: 'Test Company Inc.',
        companyRegistration: 'TEST123456',
      },
    });

    console.log('Test company created successfully');
    res.json({
      message: 'Test company created successfully',
      user
    });
  } catch (err) {
    console.error('Error creating test company:', err);
    // More detailed error response
    res.status(500).json({ 
      message: 'Failed to create test company',
      error: err instanceof Error ? {
        message: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
      } : 'Unknown error'
    });
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  console.log('Health check requested');
  res.json({ 
    status: 'ok',
    environment: process.env.NODE_ENV || 'development',
    clerkConfigured: !!process.env.CLERK_SECRET_KEY,
    port: port
  });
});

// Handle 404s
app.use((req, res) => {
  res.status(404).json({ message: `Route ${req.method} ${req.path} not found` });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    message: 'Internal server error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

app.listen(port, () => {
  console.log('=================================');
  console.log(`Server running on port ${port}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Clerk configured: ${!!process.env.CLERK_SECRET_KEY}`);
  console.log('=================================');
}); 