/* ═══════════════════════════════════════════════════════════
   config.js  —  DASHBOARD SETTINGS

   1) SUPABASE_URL + SUPABASE_KEY — your live database connection.
      The dashboard reads your 'revenue' table from here.
      (The publishable key is safe in the browser because Row Level
      Security is on and only read access is allowed.)

   2) PASSWORD — the shared password for the view gate.
      Change it whenever you're ready.

   If SUPABASE_URL is left empty, the dashboard falls back to the
   built-in demo data.
═══════════════════════════════════════════════════════════ */

const CONFIG = {
  SUPABASE_URL: 'https://ebcgfaiabbabvzjjsmjg.supabase.co',
  SUPABASE_KEY: 'sb_publishable_m5FtIBK2ahTRif1rwCDUqQ_Q3QPqf7s',
  TABLE: 'revenue',

  SHEETS_CSV_URL: '',        // optional legacy CSV source (unused when Supabase is set)
  PASSWORD: 'changeme',
  BRAND: 'DASHBOARD',
};
