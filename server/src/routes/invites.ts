import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/pool';
import { authenticateClerkJWT } from '../middleware/auth';
import { sendInvitationEmail } from '../utils/email';

const router = express.Router();

// Create a new invitation
router.post('/', authenticateClerkJWT, async (req, res) => {
  const { email, condominiumId, role } = req.body;
  const token = uuidv4();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48); // Invitation expires in 48 hours

  try {
    // Check if the user making the request is a company and owns the condominium
    const companyCheck = await pool.query(
      'SELECT id FROM condominiums WHERE id = $1 AND company_id = $2',
      [condominiumId, req.user.id]
    );

    if (companyCheck.rows.length === 0) {
      return res.status(403).json({ message: 'Not authorized to invite administrators for this condominium' });
    }

    // Check if there's already a pending invitation for this email and condominium
    const existingInvite = await pool.query(
      'SELECT id FROM invites WHERE email = $1 AND condominium_id = $2 AND status = $3',
      [email, condominiumId, 'pending']
    );

    if (existingInvite.rows.length > 0) {
      return res.status(400).json({ message: 'An invitation has already been sent to this email' });
    }

    // Create the invitation
    const result = await pool.query(
      `INSERT INTO invites (
        token, 
        email, 
        condominium_id, 
        role, 
        status, 
        expires_at, 
        created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING *`,
      [token, email, condominiumId, role, 'pending', expiresAt]
    );

    const invite = result.rows[0];

    // Send invitation email
    const inviteUrl = `${process.env.CLIENT_URL}/admin/invite?token=${token}`;
    await sendInvitationEmail(email, inviteUrl);

    res.status(201).json({ 
      message: 'Invitation sent successfully',
      invite: {
        id: invite.id,
        email: invite.email,
        status: invite.status,
        expiresAt: invite.expires_at
      }
    });
  } catch (err) {
    console.error('Error creating invitation:', err);
    res.status(500).json({ message: 'Failed to create invitation' });
  }
});

// Verify invitation token
router.get('/verify/:token', async (req, res) => {
  const { token } = req.params;

  try {
    const result = await pool.query(
      `SELECT 
        i.id,
        i.email,
        i.condominium_id,
        i.role,
        i.status,
        i.expires_at,
        c.name as condominium_name
      FROM invites i
      JOIN condominiums c ON c.id = i.condominium_id
      WHERE i.token = $1 AND i.status = 'pending'`,
      [token]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ message: 'Invalid or expired invitation' });
    }

    const invite = result.rows[0];

    // Check if invitation has expired
    if (new Date() > new Date(invite.expires_at)) {
      await pool.query(
        'UPDATE invites SET status = $1 WHERE id = $2',
        ['expired', invite.id]
      );
      return res.status(400).json({ message: 'Invitation has expired' });
    }

    res.json({ 
      invite: {
        id: invite.id,
        email: invite.email,
        condominiumId: invite.condominium_id,
        condominiumName: invite.condominium_name,
        role: invite.role,
        expiresAt: invite.expires_at
      }
    });
  } catch (err) {
    console.error('Error verifying invitation:', err);
    res.status(500).json({ message: 'Failed to verify invitation' });
  }
});

// Accept invitation
router.post('/accept/:token', async (req, res) => {
  const { token } = req.params;
  const { userId, email } = req.body;

  try {
    // Start a transaction
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get and validate the invitation
      const inviteResult = await client.query(
        'SELECT * FROM invites WHERE token = $1 AND status = $1',
        [token, 'pending']
      );

      if (inviteResult.rows.length === 0) {
        throw new Error('Invalid or expired invitation');
      }

      const invite = inviteResult.rows[0];

      // Check if invitation has expired
      if (new Date() > new Date(invite.expires_at)) {
        await client.query(
          'UPDATE invites SET status = $1 WHERE id = $2',
          ['expired', invite.id]
        );
        throw new Error('Invitation has expired');
      }

      // Verify email matches invitation
      if (email !== invite.email) {
        throw new Error('Email does not match invitation');
      }

      // Create admin-condominium relationship
      await client.query(
        `INSERT INTO admin_condominiums (
          admin_id,
          condominium_id,
          created_at
        ) VALUES ($1, $2, NOW())`,
        [userId, invite.condominium_id]
      );

      // Update invitation status
      await client.query(
        'UPDATE invites SET status = $1, accepted_at = NOW() WHERE id = $2',
        ['accepted', invite.id]
      );

      await client.query('COMMIT');

      res.json({ 
        message: 'Invitation accepted successfully',
        condominiumId: invite.condominium_id
      });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error accepting invitation:', err);
    res.status(500).json({ 
      message: err instanceof Error ? err.message : 'Failed to accept invitation' 
    });
  }
});

export default router; 