import { createClient } from "@supabase/supabase-js";

function message(error, fallback = "Something went wrong. Please try again.") {
  return error?.message || fallback;
}

function validateCampusEmail(email, domain) {
  if (!email.trim().toLowerCase().endsWith(`@${domain}`)) {
    throw new Error(`Use your @${domain} e-mail address.`);
  }
}

export function createSupabaseAuth(config) {
  const client = createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  return {
    mode: "supabase",
    emailDomain: config.emailDomain,
    client,
    async getToken() {
      const { data, error } = await client.auth.getSession();
      if (error) throw new Error(message(error));
      return data.session?.access_token || null;
    },
    async signIn({ email, password }) {
      validateCampusEmail(email, config.emailDomain);
      const { error } = await client.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw new Error(message(error, "Could not sign in."));
    },
    async signUp({ email, password, name }) {
      validateCampusEmail(email, config.emailDomain);
      const { data, error } = await client.auth.signUp({
        email: email.trim(),
        password,
        options: { data: { full_name: name.trim() }, emailRedirectTo: window.location.origin },
      });
      if (error) throw new Error(message(error, "Could not create the account."));
      return Boolean(data.session);
    },
    async forgotPassword({ email }) {
      validateCampusEmail(email, config.emailDomain);
      const { error } = await client.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      if (error) throw new Error(message(error, "Could not send a reset link."));
    },
    async updatePassword({ password }) {
      const { error } = await client.auth.updateUser({ password });
      if (error) throw new Error(message(error, "Could not update the password."));
    },
    async signOut() {
      const { error } = await client.auth.signOut();
      if (error) throw new Error(message(error, "Could not sign out."));
    },
  };
}
