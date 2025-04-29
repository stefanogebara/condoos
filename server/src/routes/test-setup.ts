import express from 'express';
import { Clerk } from '@clerk/clerk-sdk-node';

const router = express.Router();

// Only available in development
if (process.env.NODE_ENV === 'development') {
  router.post('/setup-test-admin', async (req, res) => {
    try {
      if (!process.env.CLERK_SECRET_KEY) {
        throw new Error('CLERK_SECRET_KEY is not configured');
      }

      const clerk = Clerk({ secretKey: process.env.CLERK_SECRET_KEY });
      
      // Check if test user already exists
      console.log('Checking for existing test admin...');
      const existingUsers = await clerk.users.getUserList({
        emailAddress: ['test@admin.com'],
      });

      if (existingUsers.length > 0) {
        console.log('Test admin already exists');
        return res.json({ 
          message: 'Test admin already exists',
          user: existingUsers[0]
        });
      }

      // Create test admin user
      console.log('Creating new test admin user...');
      const user = await clerk.users.createUser({
        emailAddress: ['test@admin.com'],
        password: 'testadmin123',
        firstName: 'Test',
        lastName: 'Admin',
        publicMetadata: {
          role: 'admin',
          isSuperAdmin: true,
        },
      });

      console.log('Test admin created successfully');
      
      res.json({
        message: 'Test admin created successfully',
        user
      });
    } catch (err) {
      console.error('Error creating test admin:', err);
      res.status(500).json({ 
        message: 'Failed to create test admin',
        error: err instanceof Error ? {
          message: err.message,
          stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
        } : 'Unknown error'
      });
    }
  });
}

export default router; 