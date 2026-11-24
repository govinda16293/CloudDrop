/**
 * Sign-in with Amazon Cognito. The password is checked with SRP, so it never
 * leaves the browser, and the app stores no password anywhere.
 *
 * `library` is amazon-cognito-identity-js; it is passed in so tests can
 * replace it.
 */
const MESSAGES = {
  NotAuthorizedException: "Wrong e-mail or password.",
  UserNotFoundException: "Wrong e-mail or password.",
  UserNotConfirmedException: "Confirm your e-mail first. Enter the code we sent you.",
  CodeMismatchException: "That code is not right. Check it and try again.",
  ExpiredCodeException: "That code has expired. Ask for a new one.",
  UsernameExistsException: "An account with this e-mail already exists. Sign in instead.",
  InvalidPasswordException: "Password needs 8+ characters with upper case, lower case and a number.",
  LimitExceededException: "Too many attempts. Wait a few minutes and try again.",
  TooManyRequestsException: "Too many attempts. Wait a few minutes and try again.",
};

function explain(error) {
  const code = error?.code || error?.name || "Error";
  let message = MESSAGES[code];
  if (!message) {
    // The pre sign-up Lambda's own message arrives behind this prefix.
    message = String(error?.message || "Something went wrong. Try again.").replace(/^PreSignUp failed with error\s*/, "");
  }
  return Object.assign(new Error(message), { code });
}

export function createCognitoAuth({ userPoolId, userPoolClientId, emailDomain }, library) {
  const { CognitoUserPool, CognitoUser, AuthenticationDetails, CognitoUserAttribute } = library;
  const pool = new CognitoUserPool({ UserPoolId: userPoolId, ClientId: userPoolClientId });

  const clean = (email) => String(email || "").trim().toLowerCase();
  const userFor = (email) => new CognitoUser({ Username: clean(email), Pool: pool });
  const settle = (resolve, reject) => (error, result) => (error ? reject(explain(error)) : resolve(result));

  return {
    mode: "cognito",
    emailDomain,

    /** The ID token: it carries e-mail, name and groups, and is what the API authorizer checks. */
    getToken() {
      const user = pool.getCurrentUser();
      if (!user) return Promise.resolve(null);
      return new Promise((resolve, reject) => {
        user.getSession((error, session) => {
          // Offline while refreshing is not the same as signed out: the stored
          // session is still good, so do not send the user to the sign-in screen.
          if (error?.code === "NetworkError") {
            return reject(new Error("Can't reach the sign-in service. Check your connection."));
          }
          resolve(error || !session ? null : session.getIdToken().getJwtToken());
        });
      });
    },

    signUp({ email, password, name }) {
      const address = clean(email);
      if (!address.endsWith(`@${emailDomain}`)) {
        return Promise.reject(new Error(`Use your @${emailDomain} e-mail address.`));
      }
      const attributes = [
        new CognitoUserAttribute({ Name: "email", Value: address }),
        new CognitoUserAttribute({ Name: "name", Value: String(name || "").trim() }),
      ];
      return new Promise((resolve, reject) => pool.signUp(address, password, attributes, null, settle(resolve, reject)));
    },

    confirmSignUp({ email, code }) {
      return new Promise((resolve, reject) =>
        userFor(email).confirmRegistration(String(code).trim(), true, settle(resolve, reject)),
      );
    },

    resendCode({ email }) {
      return new Promise((resolve, reject) => userFor(email).resendConfirmationCode(settle(resolve, reject)));
    },

    signIn({ email, password }) {
      const details = new AuthenticationDetails({ Username: clean(email), Password: password });
      return new Promise((resolve, reject) =>
        userFor(email).authenticateUser(details, {
          onSuccess: () => resolve(),
          onFailure: (error) => reject(explain(error)),
          newPasswordRequired: () =>
            reject(new Error("This account needs a new password. Ask an admin to set a permanent one.")),
        }),
      );
    },

    forgotPassword({ email }) {
      return new Promise((resolve, reject) =>
        userFor(email).forgotPassword({ onSuccess: () => resolve(), onFailure: (error) => reject(explain(error)) }),
      );
    },

    confirmNewPassword({ email, code, password }) {
      return new Promise((resolve, reject) =>
        userFor(email).confirmPassword(String(code).trim(), password, {
          onSuccess: () => resolve(),
          onFailure: (error) => reject(explain(error)),
        }),
      );
    },

    async signOut() {
      pool.getCurrentUser()?.signOut();
    },
  };
}
