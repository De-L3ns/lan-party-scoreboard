import { createClient } from '@supabase/supabase-js';

let client;

export function getSupabaseClient(config) {
  if (!config.isConfigured) return null;
  client ??= createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      storage: window.sessionStorage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
