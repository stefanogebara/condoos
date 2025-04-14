-- Create invites table
CREATE TABLE IF NOT EXISTS invites (
    id SERIAL PRIMARY KEY,
    token UUID NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL,
    condominium_id INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending',
    expires_at TIMESTAMP NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMP,
    CONSTRAINT valid_status CHECK (status IN ('pending', 'accepted', 'expired', 'cancelled'))
);

-- Create index for faster token lookups
CREATE INDEX IF NOT EXISTS idx_invites_token ON invites(token);

-- Create index for checking existing invites
CREATE INDEX IF NOT EXISTS idx_invites_email_condo ON invites(email, condominium_id, status);

-- Create admin_condominiums table for managing relationships
CREATE TABLE IF NOT EXISTS admin_condominiums (
    id SERIAL PRIMARY KEY,
    admin_id VARCHAR(255) NOT NULL,
    condominium_id INTEGER NOT NULL REFERENCES condominiums(id) ON DELETE CASCADE,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    UNIQUE(admin_id, condominium_id)
); 