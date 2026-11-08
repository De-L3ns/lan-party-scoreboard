export function readPublicConfig(env = {}) {
  const supabaseUrl = String(env.VITE_SUPABASE_URL ?? '').trim();
  const supabasePublishableKey = String(env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
  const adminEmail = String(env.VITE_ADMIN_EMAIL ?? '').trim();
  const issues = [];

  if (Boolean(supabaseUrl) !== Boolean(supabasePublishableKey)) {
    issues.push('Set both VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY.');
  }
  if (supabaseUrl) {
    try {
      const url = new URL(supabaseUrl);
      const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
        issues.push('VITE_SUPABASE_URL must be an HTTPS project origin or a local HTTP origin.');
      }
    } catch {
      issues.push('VITE_SUPABASE_URL must be a valid project URL.');
    }
  }
  if (supabasePublishableKey && !/^sb_publishable_[A-Za-z0-9_-]+$/.test(supabasePublishableKey)) {
    issues.push('Use a Supabase publishable key (sb_publishable_...), never a secret or legacy service-role key.');
  }

  return {
    supabaseUrl,
    supabasePublishableKey,
    adminEmail,
    issues,
    isConfigured: Boolean(supabaseUrl && supabasePublishableKey && issues.length === 0),
  };
}
