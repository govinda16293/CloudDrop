/**
 * Sign-in for local mode only. There is no password: the token is just the
 * e-mail and name, readable by anyone, and only local/server.py accepts it.
 * On AWS the API sits behind Cognito, which rejects this token outright.
 */
const KEY = "clouddrop.local.session";

function toBase64Url(text) {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function createLocalAuth({ emailDomain }, storage = window.localStorage) {
  function read() {
    try {
      return JSON.parse(storage.getItem(KEY));
    } catch {
      return null;
    }
  }

  return {
    mode: "local",
    emailDomain,
    async getToken() {
      const session = read();
      return session ? `local.${toBase64Url(JSON.stringify(session))}` : null;
    },
    async signIn({ email, name, admin = false }) {
      const address = String(email || "").trim().toLowerCase();
      if (!address.endsWith(`@${emailDomain}`) || address.startsWith("@")) {
        throw new Error(`Use your @${emailDomain} e-mail address.`);
      }
      const session = { email: address, name: String(name || "").trim(), admin: Boolean(admin) };
      storage.setItem(KEY, JSON.stringify(session));
    },
    async signOut() {
      storage.removeItem(KEY);
    },
  };
}
