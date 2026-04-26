// Public Supabase config — anon key is safe to expose in browser (protected by RLS).
//
// Auto-switches between local Supabase stack (`supabase start`) and prod based
// on hostname. The local anon JWT is the Supabase demo key (same for every
// local install) — not a secret. The prod anon key is also public-by-design.
(function () {
  const isLocal = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if (isLocal) {
    window.SUPABASE_URL      = 'http://127.0.0.1:54321';
    window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';
  } else {
    window.SUPABASE_URL      = 'https://gyixkgytywjtttcnynzn.supabase.co';
    window.SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imd5aXhrZ3l0eXdqdHR0Y255bnpuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcwNTU4MjQsImV4cCI6MjA5MjYzMTgyNH0.RzNvHECKw-sPXL_4prGH0yPMTvhMjtPfGzDi6_v32Tc';
  }
})();
