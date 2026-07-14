-- ═══════════════════════════════════════════════════════════════════
--   m-way v2.2 — Survey feature (Session D)
--   Public survey form + response tracking
-- ═══════════════════════════════════════════════════════════════════

-- 1. survey_questions  (customizable per project)
CREATE TABLE IF NOT EXISTS survey_questions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   uuid NOT NULL,
  order_num    integer NOT NULL DEFAULT 0,
  q_type       text NOT NULL,                -- 'rating' | 'yes_no' | 'choice' | 'text' | 'scale'
  question     text NOT NULL,
  options      jsonb DEFAULT '[]'::jsonb,    -- for 'choice' type: ["opt1","opt2",...]
  required     boolean DEFAULT false,
  created_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_survey_questions_project ON survey_questions(project_id, order_num);
ALTER TABLE survey_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "survey_questions_all" ON survey_questions;
CREATE POLICY "survey_questions_all" ON survey_questions FOR ALL USING (true) WITH CHECK (true);


-- 2. survey_responses  (one row per respondent)
CREATE TABLE IF NOT EXISTS survey_responses (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     uuid NOT NULL,
  audience_id    uuid REFERENCES audience(id) ON DELETE SET NULL,   -- null if anonymous
  respondent_name    text,        -- if identified
  respondent_phone   text,        -- if identified (raw)
  phone_normalized   text,        -- canonical form (last 9 digits) — used for dedup
  is_anonymous       boolean NOT NULL DEFAULT false,
  answers            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- {question_id: value, ...}
  submitted_at       timestamptz DEFAULT now(),
  UNIQUE(project_id, phone_normalized)   -- prevents same phone answering twice per project
);
CREATE INDEX IF NOT EXISTS idx_survey_resp_project     ON survey_responses(project_id);
CREATE INDEX IF NOT EXISTS idx_survey_resp_audience    ON survey_responses(audience_id);
CREATE INDEX IF NOT EXISTS idx_survey_resp_anonymous   ON survey_responses(is_anonymous);
ALTER TABLE survey_responses ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "survey_responses_all" ON survey_responses;
CREATE POLICY "survey_responses_all" ON survey_responses FOR ALL USING (true) WITH CHECK (true);

-- ═══════════════════════════════════════════════════════════════════
--   Done.
-- ═══════════════════════════════════════════════════════════════════
