import { Request, Response, NextFunction } from 'express';
import { Webhook } from 'svix';
import { ClerkExpressRequireAuth } from '@clerk/clerk-sdk-node';

// Extend Express Request type to include user and auth
declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionClaims?: {
          metadata?: {
            role?: string;
          };
          email?: string;
        };
      };
      user?: {
        id: string;
        role?: string;
        email?: string;
      };
    }
  }
}

// Middleware to authenticate Clerk JWT and extract user info
export const authenticateClerkJWT = [
  ClerkExpressRequireAuth(),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!req.auth?.userId) {
        return res.status(401).json({ message: 'Unauthorized' });
      }

      // Add user info to request
      req.user = {
        id: req.auth.userId,
        role: req.auth.sessionClaims?.metadata?.role,
        email: req.auth.sessionClaims?.email,
      };

      next();
    } catch (err) {
      console.error('Auth middleware error:', err);
      res.status(401).json({ message: 'Authentication failed' });
    }
  }
];

// Webhook secret for Clerk webhooks
const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;

// Middleware to verify Clerk webhooks
export const verifyClerkWebhook = async (req: Request, res: Response, next: NextFunction) => {
  if (!webhookSecret) {
    console.error('Missing Clerk webhook secret');
    return res.status(500).json({ message: 'Server configuration error' });
  }

  try {
    const svix = new Webhook(webhookSecret);
    const payload = req.body;
    const headers = {
      'svix-id': req.headers['svix-id'] as string,
      'svix-timestamp': req.headers['svix-timestamp'] as string,
      'svix-signature': req.headers['svix-signature'] as string,
    };

    svix.verify(JSON.stringify(payload), headers);
    next();
  } catch (err) {
    console.error('Webhook verification failed:', err);
    res.status(401).json({ message: 'Invalid webhook signature' });
  }
}; 