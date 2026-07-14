-- ═══════════════════════════════════════════════════════════════════
--   m-way v2.2 — Audience / Hosting migration
--   Run once in Supabase SQL editor before deploying v2.2
-- ═══════════════════════════════════════════════════════════════════

-- 1. audience table  (the "Audience" central database)
CREATE TABLE IF NOT EXISTS audience (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name         text NOT NULL,
  company      text,
  instagram    text,
  tiktok       text,
  phone        text,
  city         text,
  gender       text,                       -- 'male' | 'female' | null
  interests    text[] DEFAULT '{}',        -- ['قهوة','فن',...]
  notes        text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_audience_city      ON audience(city);
CREATE INDEX IF NOT EXISTS idx_audience_gender    ON audience(gender);
CREATE INDEX IF NOT EXISTS idx_audience_instagram ON audience(instagram);
CREATE INDEX IF NOT EXISTS idx_audience_name      ON audience(name);
ALTER TABLE audience ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "audience_all" ON audience;
CREATE POLICY "audience_all" ON audience FOR ALL USING (true) WITH CHECK (true);


-- 2. event_invitations table  (guest ↔ project link + attendance)
CREATE TABLE IF NOT EXISTS event_invitations (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL,
  audience_id  uuid NOT NULL REFERENCES audience(id) ON DELETE CASCADE,
  invited_at   timestamptz DEFAULT now(),
  attended     boolean DEFAULT false,
  attended_at  timestamptz,
  notes        text,
  UNIQUE(project_id, audience_id)
);
CREATE INDEX IF NOT EXISTS idx_event_inv_project  ON event_invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_event_inv_audience ON event_invitations(audience_id);
CREATE INDEX IF NOT EXISTS idx_event_inv_attended ON event_invitations(attended);
ALTER TABLE event_invitations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "event_invitations_all" ON event_invitations;
CREATE POLICY "event_invitations_all" ON event_invitations FOR ALL USING (true) WITH CHECK (true);


-- 3. projects: hosting toggle + event category  (used starting Session B)
ALTER TABLE projects ADD COLUMN IF NOT EXISTS hosting_enabled boolean DEFAULT false;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS event_category  text;

-- ═══════════════════════════════════════════════════════════════════
--   Done. All Session A features now have their DB backing.
-- ═══════════════════════════════════════════════════════════════════
