import { Request as ExpressRequest, Response, NextFunction } from 'express';
import { ClerkExpressRequireAuth } from '@clerk/clerk-sdk-node';
import { Webhook } from 'svix';
import { WebhookEvent } from '@clerk/backend';

// Extend Express Request type to include auth and user information
export interface Request extends ExpressRequest {
  auth?: {
    sessionId: string;
    userId: string;
    getToken: () => Promise<string>;
  };
  user?: {
    id: string;
    firstName?: string;
    lastName?: string;
    emailAddresses: Array<{ emailAddress: string }>;
    publicMetadata: Record<string, any>;
  };
  webhookEvent?: WebhookEvent;
}

// Middleware to authenticate Clerk JWT tokens
export const authenticateClerkJWT = ClerkExpressRequireAuth({
  onError: (error: any) => {
    console.error('Authentication error:', error.message);
    return { message: 'Unauthorized access', status: 401 };
  },
});

// Middleware to verify Clerk webhooks
export const verifyClerkWebhook = async (req: Request, res: Response, next: NextFunction) => {
  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  
  if (!webhookSecret) {
    console.error('Missing CLERK_WEBHOOK_SECRET environment variable');
    return res.status(500).json({ error: 'Server configuration error' });
  }

  try {
    const webhook = new Webhook(webhookSecret);
    const headers = {
      'svix-id': req.headers['svix-id'] as string,
      'svix-timestamp': req.headers['svix-timestamp'] as string,
      'svix-signature': req.headers['svix-signature'] as string,
    };

    const payload = req.body;
    const event = webhook.verify(JSON.stringify(payload), headers) as WebhookEvent;
    
    // Add the verified webhook event to the request for route handlers
    req.webhookEvent = event;
    next();
  } catch (err) {
    console.error('Webhook verification failed:', err);
    return res.status(401).json({ 
      error: 'Invalid webhook signature',
      details: err instanceof Error ? err.message : 'Unknown error'
    });
  }
}; 