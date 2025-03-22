-- Create notification preferences table
CREATE TABLE IF NOT EXISTS notification_preferences (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL UNIQUE,
    email_notifications BOOLEAN DEFAULT true,
    push_notifications BOOLEAN DEFAULT true,
    preferences JSONB DEFAULT '{
        "status_update": {"enabled": true, "email": true, "push": true},
        "new_vote": {"enabled": true, "email": true, "push": true},
        "new_comment": {"enabled": true, "email": true, "push": true},
        "vote_threshold": {"enabled": true, "email": true, "push": true},
        "budget_update": {"enabled": true, "email": true, "push": true},
        "document_upload": {"enabled": true, "email": true, "push": true},
        "maintenance_schedule": {"enabled": true, "email": true, "push": true},
        "payment_reminder": {"enabled": true, "email": true, "push": true},
        "meeting_scheduled": {"enabled": true, "email": true, "push": true}
    }'::jsonb NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Add metadata column to notifications table
ALTER TABLE notifications
ADD COLUMN IF NOT EXISTS metadata JSONB;

-- Add index for faster preference lookups
CREATE INDEX IF NOT EXISTS idx_notification_preferences_user ON notification_preferences(user_id);

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_notification_preferences_timestamp()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_notification_preferences_timestamp
    BEFORE UPDATE ON notification_preferences
    FOR EACH ROW
    EXECUTE FUNCTION update_notification_preferences_timestamp(); 