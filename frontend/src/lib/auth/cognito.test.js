import { describe, expect, it } from "vitest";
import { createCognitoAuth } from "./cognito.js";

// A stand-in for amazon-cognito-identity-js. Local mode never runs the real
// library, so these tests pin down how we call it.
function fakeLibrary(script = {}) {
  const log = [];
  const session = { getIdToken: () => ({ getJwtToken: () => "ID.TOKEN" }), getAccessToken: () => ({ getJwtToken: () => "ACCESS.TOKEN" }) };

  class CognitoUserPool {
    constructor(data) {
      log.push(["pool", data]);
    }
    signUp(username, password, attributes, validation, callback) {
      log.push(["signUp", username, password, attributes.map((a) => [a.Name, a.Value])]);
      callback(script.signUpError || null, { userConfirmed: false });
    }
    getCurrentUser() {
      return script.noCurrentUser ? null : new CognitoUser({ Username: "current" });
    }
  }
  class CognitoUser {
    constructor(data) {
      this.username = data.Username;
    }
    authenticateUser(details, callbacks) {
      log.push(["authenticate", this.username, details.data]);
      if (script.authError) callbacks.onFailure(script.authError);
      else if (script.newPasswordRequired) callbacks.newPasswordRequired({}, []);
      else callbacks.onSuccess(session);
    }
    confirmRegistration(code, force, callback) {
      log.push(["confirm", this.username, code, force]);
      callback(script.confirmError || null, "SUCCESS");
    }
    resendConfirmationCode(callback) {
      log.push(["resend", this.username]);
      callback(null, {});
    }
    forgotPassword(callbacks) {
      log.push(["forgot", this.username]);
      callbacks.onSuccess({});
    }
    confirmPassword(code, password, callbacks) {
      log.push(["confirmPassword", this.username, code, password]);
      callbacks.onSuccess("SUCCESS");
    }
    getSession(callback) {
      callback(script.sessionError || null, script.sessionError ? null : session);
    }
    signOut() {
      log.push(["signOut", this.username]);
    }
  }
  class AuthenticationDetails {
    constructor(data) {
      this.data = data;
    }
  }
  class CognitoUserAttribute {
    constructor(data) {
      Object.assign(this, data);
    }
  }
  return { log, library: { CognitoUserPool, CognitoUser, AuthenticationDetails, CognitoUserAttribute } };
}

const config = { userPoolId: "ap-south-1_AbC", userPoolClientId: "client1", emailDomain: "thapar.edu" };

describe("cognito auth", () => {
  it("opens the configured user pool", () => {
    const { log, library } = fakeLibrary();
    createCognitoAuth(config, library);
    expect(log[0]).toEqual(["pool", { UserPoolId: "ap-south-1_AbC", ClientId: "client1" }]);
  });

  it("sends the ID token, which is the one API Gateway's authorizer checks", async () => {
    const { library } = fakeLibrary();
    expect(await createCognitoAuth(config, library).getToken()).toBe("ID.TOKEN");
  });

  it("has no token when nobody is signed in or the session can not refresh", async () => {
    expect(await createCognitoAuth(config, fakeLibrary({ noCurrentUser: true }).library).getToken()).toBeNull();
    expect(await createCognitoAuth(config, fakeLibrary({ sessionError: new Error("expired") }).library).getToken()).toBeNull();
  });

  it("does not treat a network failure during token refresh as being signed out", async () => {
    // The stored session is still good; dropping to the sign-in screen would
    // throw away whatever the user was doing.
    const offline = Object.assign(new Error("Network error"), { code: "NetworkError" });
    const { library } = fakeLibrary({ sessionError: offline });
    await expect(createCognitoAuth(config, library).getToken()).rejects.toThrow(
      "Can't reach the sign-in service. Check your connection.",
    );
  });

  it("signs up with lower-cased e-mail and the name attribute", async () => {
    const { log, library } = fakeLibrary();
    await createCognitoAuth(config, library).signUp({ email: " Asha@Thapar.edu ", password: "Passw0rd!", name: " Asha " });
    expect(log).toContainEqual(["signUp", "asha@thapar.edu", "Passw0rd!", [["email", "asha@thapar.edu"], ["name", "Asha"]]]);
  });

  it("refuses another domain before calling Cognito", async () => {
    const { log, library } = fakeLibrary();
    await expect(createCognitoAuth(config, library).signUp({ email: "x@gmail.com", password: "p", name: "X" })).rejects.toThrow(
      "Use your @thapar.edu e-mail address.",
    );
    expect(log.some(([kind]) => kind === "signUp")).toBe(false);
  });

  it("shows the reason from the pre sign-up trigger without Cognito's prefix", async () => {
    const error = Object.assign(new Error("PreSignUp failed with error Only @thapar.edu e-mail addresses can sign up."), {
      code: "UserLambdaValidationException",
    });
    const { library } = fakeLibrary({ signUpError: error });
    await expect(createCognitoAuth(config, library).signUp({ email: "a@thapar.edu", password: "p", name: "A" })).rejects.toThrow(
      /^Only @thapar.edu e-mail addresses can sign up\.$/,
    );
  });

  it("signs in with e-mail and password", async () => {
    const { log, library } = fakeLibrary();
    await createCognitoAuth(config, library).signIn({ email: "Asha@thapar.edu", password: "Passw0rd!" });
    expect(log).toContainEqual(["authenticate", "asha@thapar.edu", { Username: "asha@thapar.edu", Password: "Passw0rd!" }]);
  });

  it.each([
    ["NotAuthorizedException", "Wrong e-mail or password."],
    ["UserNotFoundException", "Wrong e-mail or password."],
    ["UserNotConfirmedException", "Confirm your e-mail first. Enter the code we sent you."],
    ["CodeMismatchException", "That code is not right. Check it and try again."],
    ["ExpiredCodeException", "That code has expired. Ask for a new one."],
    ["UsernameExistsException", "An account with this e-mail already exists. Sign in instead."],
    ["InvalidPasswordException", "Password needs 8+ characters with upper case, lower case and a number."],
    ["LimitExceededException", "Too many attempts. Wait a few minutes and try again."],
  ])("explains %s in plain words", async (code, message) => {
    const { library } = fakeLibrary({ authError: Object.assign(new Error("raw"), { code }) });
    const failure = await createCognitoAuth(config, library).signIn({ email: "a@thapar.edu", password: "p" }).catch((e) => e);
    expect(failure.message).toBe(message);
    expect(failure.code).toBe(code);
  });

  it("explains an admin-created account that still needs its first password", async () => {
    const { library } = fakeLibrary({ newPasswordRequired: true });
    await expect(createCognitoAuth(config, library).signIn({ email: "a@thapar.edu", password: "p" })).rejects.toThrow(
      /needs a new password/,
    );
  });

  it("confirms, resends, resets and signs out through the library", async () => {
    const { log, library } = fakeLibrary();
    const auth = createCognitoAuth(config, library);
    await auth.confirmSignUp({ email: "A@thapar.edu", code: " 123456 " });
    await auth.resendCode({ email: "a@thapar.edu" });
    await auth.forgotPassword({ email: "a@thapar.edu" });
    await auth.confirmNewPassword({ email: "a@thapar.edu", code: "654321", password: "NewPassw0rd" });
    await auth.signOut();
    expect(log.slice(1)).toEqual([
      ["confirm", "a@thapar.edu", "123456", true],
      ["resend", "a@thapar.edu"],
      ["forgot", "a@thapar.edu"],
      ["confirmPassword", "a@thapar.edu", "654321", "NewPassw0rd"],
      ["signOut", "current"],
    ]);
  });
});
