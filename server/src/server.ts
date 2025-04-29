import express from 'express';
import cors from 'cors';
import { clerkClient } from '@clerk/clerk-sdk-node';
import invitesRouter from './routes/invites';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { setupWebSocketHandlers } from './services/websocket';
import { errorHandler } from './middleware/errorHandler';
import logger from './middleware/logger';
import { validateRequest } from './middleware/validateRequest';
import Joi from 'joi';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST']
  }
});

const port = process.env.PORT || 3001;

// Security middleware
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use('/api/', limiter);

// Performance middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Logging and monitoring
app.use(logger);

// API versioning
const apiVersion = 'v1';
const apiPrefix = `/api/${apiVersion}`;

// Root route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Welcome to the Condo Management API',
    version: '1.0.0',
    status: 'running',
    apiVersion
  });
});

// Register routes with versioning
app.use(`${apiPrefix}/invites`, invitesRouter);

// Health check route
app.get(`${apiPrefix}/health`, (req, res) => {
  res.json({ 
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Setup WebSocket handlers
setupWebSocketHandlers(io);

// Error handling
app.use(errorHandler);

// Start server
httpServer.listen(port, () => {
  console.log(`Server is running on port ${port}`);
  console.log(`API version: ${apiVersion}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
}); 