import express from 'express';
import { Clerk } from '@clerk/clerk-sdk-node';

const router = express.Router();

// Only available in development
if (process.env.NODE_ENV === 'development') {
  router.post('/setup-test-company', async (req, res) => {
    try {
      const clerk = Clerk({ secretKey: process.env.CLERK_SECRET_KEY });
      
      // Check if test user already exists
      const existingUsers = await clerk.users.getUserList({
        emailAddress: ['test@company.com'],
      });

      if (existingUsers.length > 0) {
        return res.json({ 
          message: 'Test company already exists',
          user: existingUsers[0]
        });
      }

      // Create test company user
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

      // Create test condominiums in your database
      // This is just an example - adjust according to your database schema
      const testCondominiums = [
        {
          name: 'Sunset Towers',
          address: '123 Sunset Blvd',
          companyId: user.id
        },
        {
          name: 'Ocean View Residences',
          address: '456 Beach Road',
          companyId: user.id
        }
      ];

      // Here you would typically save these to your database
      // For now, we'll just return them
      
      res.json({
        message: 'Test company created successfully',
        user,
        condominiums: testCondominiums
      });
    } catch (err) {
      console.error('Error creating test company:', err);
      res.status(500).json({ 
        message: 'Failed to create test company',
        error: err instanceof Error ? err.message : 'Unknown error'
      });
    }
  });
}

export default router; 