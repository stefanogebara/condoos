import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { authenticateClerkJWT, Request } from '../middleware/auth';
import { sendInvitationEmail } from '../utils/email';
import { supabase } from '../lib/supabase';

const router = express.Router();

// Create a new invitation
router.post('/', authenticateClerkJWT, async (req: Request, res) => {
  const { email, condominiumId, role } = req.body;
  const token = uuidv4();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48); // Invitation expires in 48 hours

  try {
    // Check if the user making the request is a company and owns the condominium
    const { data: companyCheck, error: companyError } = await supabase
      .from('condominiums')
      .select('id')
      .eq('id', condominiumId)
      .eq('company_id', req.user?.id)
      .single();

    if (companyError || !companyCheck) {
      return res.status(403).json({ message: 'Not authorized to invite administrators for this condominium' });
    }

    // Check if there's already a pending invitation for this email and condominium
    const { data: existingInvite, error: inviteError } = await supabase
      .from('invites')
      .select('id')
      .eq('email', email)
      .eq('condominium_id', condominiumId)
      .eq('status', 'pending')
      .single();

    if (existingInvite) {
      return res.status(400).json({ message: 'An invitation has already been sent to this email' });
    }

    // Create the invitation
    const { data: invite, error: createError } = await supabase
      .from('invites')
      .insert({
        token,
        email,
        condominium_id: condominiumId,
        role,
        status: 'pending',
        expires_at: expiresAt,
        created_at: new Date()
      })
      .select()
      .single();

    if (createError) {
      throw createError;
    }

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
    const { data: invite, error } = await supabase
      .from('invites')
      .select(`
        id,
        email,
        condominium_id,
        role,
        status,
        expires_at,
        condominiums (
          name
        )
      `)
      .eq('token', token)
      .eq('status', 'pending')
      .single();

    if (error || !invite) {
      return res.status(404).json({ message: 'Invalid or expired invitation' });
    }

    // Check if invitation has expired
    if (new Date() > new Date(invite.expires_at)) {
      await supabase
        .from('invites')
        .update({ status: 'expired' })
        .eq('id', invite.id);
      return res.status(400).json({ message: 'Invitation has expired' });
    }

    res.json({ 
      invite: {
        id: invite.id,
        email: invite.email,
        condominiumId: invite.condominium_id,
        condominiumName: invite.condominiums[0].name,
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
    // Get and validate the invitation
    const { data: invite, error: inviteError } = await supabase
      .from('invites')
      .select('*')
      .eq('token', token)
      .eq('status', 'pending')
      .single();

    if (inviteError || !invite) {
      throw new Error('Invalid or expired invitation');
    }

    // Check if invitation has expired
    if (new Date() > new Date(invite.expires_at)) {
      await supabase
        .from('invites')
        .update({ status: 'expired' })
        .eq('id', invite.id);
      throw new Error('Invitation has expired');
    }

    // Verify email matches invitation
    if (email !== invite.email) {
      throw new Error('Email does not match invitation');
    }

    // Create admin-condominium relationship
    const { error: relationError } = await supabase
      .from('admin_condominiums')
      .insert({
        admin_id: userId,
        condominium_id: invite.condominium_id,
        created_at: new Date()
      });

    if (relationError) {
      throw relationError;
    }

    // Update invitation status
    const { error: updateError } = await supabase
      .from('invites')
      .update({ 
        status: 'accepted',
        accepted_at: new Date()
      })
      .eq('id', invite.id);

    if (updateError) {
      throw updateError;
    }

    res.json({ 
      message: 'Invitation accepted successfully',
      condominiumId: invite.condominium_id
    });
  } catch (err) {
    console.error('Error accepting invitation:', err);
    res.status(500).json({ 
      message: err instanceof Error ? err.message : 'Failed to accept invitation' 
    });
  }
});

export default router; 