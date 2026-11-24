import { describe, expect, it } from "vitest";
import { createLocalAuth } from "./local.js";

function memoryStorage() {
  const data = new Map();
  return { getItem: (k) => (data.has(k) ? data.get(k) : null), setItem: (k, v) => data.set(k, String(v)), removeItem: (k) => data.delete(k) };
}

function decode(token) {
  const encoded = token.slice("local.".length).replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
}

describe("local auth", () => {
  it("starts signed out", async () => {
    const auth = createLocalAuth({ emailDomain: "thapar.edu" }, memoryStorage());
    expect(await auth.getToken()).toBeNull();
  });

  it("signs in with an institute address and makes a token the local server reads", async () => {
    const auth = createLocalAuth({ emailDomain: "thapar.edu" }, memoryStorage());
    await auth.signIn({ email: " Asha_BE24@Thapar.edu ", name: "Asha", admin: true });
    const token = await auth.getToken();
    expect(token.startsWith("local.")).toBe(true);
    expect(token).not.toMatch(/[+/=]/);
    expect(decode(token)).toEqual({ email: "asha_be24@thapar.edu", name: "Asha", admin: true });
  });

  it("keeps names with non-English letters intact", async () => {
    const auth = createLocalAuth({ emailDomain: "thapar.edu" }, memoryStorage());
    await auth.signIn({ email: "a@thapar.edu", name: "आशा Verma" });
    expect(decode(await auth.getToken()).name).toBe("आशा Verma");
  });

  it("refuses another e-mail domain", async () => {
    const auth = createLocalAuth({ emailDomain: "thapar.edu" }, memoryStorage());
    await expect(auth.signIn({ email: "x@gmail.com", name: "X" })).rejects.toThrow("Use your @thapar.edu e-mail address.");
    expect(await auth.getToken()).toBeNull();
  });

  it("remembers the session across reloads and forgets it on sign-out", async () => {
    const storage = memoryStorage();
    await createLocalAuth({ emailDomain: "thapar.edu" }, storage).signIn({ email: "a@thapar.edu", name: "A" });
    const reloaded = createLocalAuth({ emailDomain: "thapar.edu" }, storage);
    expect(await reloaded.getToken()).toMatch(/^local\./);
    await reloaded.signOut();
    expect(await createLocalAuth({ emailDomain: "thapar.edu" }, storage).getToken()).toBeNull();
  });
});
