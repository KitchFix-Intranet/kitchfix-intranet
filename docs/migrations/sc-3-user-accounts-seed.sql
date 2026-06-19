-- ═══════════════════════════════════════════════════════════════════
-- sc-3-user-accounts-seed.sql
-- Service Calendar - user_accounts seed (email -> default account)
--
-- Populates user_accounts from the canonical contacts table so the SC
-- frontend can auto-select an account on login. Every contact with an
-- email + team_key gets a row. Operators with multiple roles on multiple
-- accounts get multiple rows; the route's lookup returns the first
-- match (.limit(1)).
--
-- Apply in Supabase Studio. Re-running is safe IFF a UNIQUE constraint
-- on (email, account) was added separately; without one, this script
-- creates duplicates on re-run.
-- ═══════════════════════════════════════════════════════════════════

-- Bulk insert from contacts. LOWER(email) normalizes to the same
-- form the route uses (session.user.email is already lowercased).
INSERT INTO user_accounts (email, account)
SELECT LOWER(email), team_key
FROM contacts
WHERE email IS NOT NULL AND email != '';

-- Manual add: TXR-TX-V Exec Chef is listed as j.rodgers@kitchfix.com
-- in contacts, but invoice submissions come from j.rogers@kitchfix.com
-- (no 'd'). Add both spellings so whichever one is the real Google
-- login on file matches.
INSERT INTO user_accounts (email, account) VALUES
('j.rogers@kitchfix.com', 'TXR - TX - V');

-- Verification probe:
-- SELECT account, COUNT(*) AS mappings FROM user_accounts
-- GROUP BY account ORDER BY account;
