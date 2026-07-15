// ===============================
// SUPABASE CLIENT
// ===============================
// This creates the Supabase client and makes it available globally.
// script.js needs window.supabaseClient to exist.

window.supabaseClient = window.supabase.createClient(
  SUPABASE_URL,
  SUPABASE_ANON_KEY
);

console.log("Supabase client loaded");