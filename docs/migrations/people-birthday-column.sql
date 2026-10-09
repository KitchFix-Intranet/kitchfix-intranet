-- Add birthday column to people table
-- Format: MM-DD (month-day only, no year - privacy-safe)
-- Source: Rippling DOB sync (future), manual entry until then
-- Applied by: Kevin in Supabase Studio

ALTER TABLE people ADD COLUMN IF NOT EXISTS birthday text;

COMMENT ON COLUMN people.birthday IS 'Month-day birthday (MM-DD format). Source: Rippling sync or manual entry. No year stored.';
