import { createClient } from '@supabase/supabase-js';

let client;

export function getSupabaseClient(config) {
  if (!config.isConfigured) return null;
  let storage;
  try { storage = window.sessionStorage; }
  catch {
    const memory = new Map();
    storage = { getItem: (key) => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: (key) => memory.delete(key) };
  }
  client ??= createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {
      storage,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}
