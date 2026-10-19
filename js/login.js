
import { auth } from "./firebase.js";

import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/12.19.0/firebase-auth.js";

const $ = (id) => document.getElementById(id);

const form = $("login-form");
const emailInput = $("email");
const passwordInput = $("password");
const submitButton = $("submit-button");
const submitLabel = $("submit-label");
const toggleModeButton = $("toggle-mode");
const forgotButton = $("forgot-password");
const passwordToggle = $("toggle-password");
const messageBox = $("auth-message");
const messageText = $("auth-message-text");

let isRegisterMode = false;
let isBusy = false;
let authReady = false;

$("current-year").textContent = new Date().getFullYear();

function showMessage(message, type = "error") {
  messageBox.hidden = false;
  messageBox.classList.toggle("success", type === "success");

  const icon = messageBox.querySelector("i");
  icon.className = type === "success"
    ? "fa-solid fa-circle-check"
    : "fa-solid fa-circle-exclamation";

  messageText.textContent = message;
}

function clearMessage() {
  messageBox.hidden = true;
  messageBox.classList.remove("success");
  messageText.textContent = "";
}

function setBusy(busy, label = "") {
  isBusy = busy;
  submitButton.disabled = busy;
  toggleModeButton.disabled = busy;
  forgotButton.disabled = busy;

  if (busy) {
    submitLabel.textContent = label || "Please wait...";
    submitButton.querySelector("i").className =
      "fa-solid fa-circle-notch fa-spin";
  } else {
    updateModeUI();
  }
}

function updateModeUI() {
  $("form-eyebrow").textContent = isRegisterMode
    ? "CREATE YOUR ACCOUNT"
    : "WELCOME BACK";

  $("form-title").innerHTML = isRegisterMode
    ? "Your workspace<br>starts <span>here.</span>"
    : "Good to see you<span>.</span>";

  $("form-subtitle").textContent = isRegisterMode
    ? "Create your account to start organising your business."
    : "Sign in to continue to your business workspace.";

  submitLabel.textContent = isRegisterMode
    ? "Create my account"
    : "Sign in to workspace";

  submitButton.querySelector("i").className = "fa-solid fa-arrow-right";

  $("mode-question").textContent = isRegisterMode
    ? "Already have an account?"
    : "New to your workspace?";

  toggleModeButton.innerHTML = isRegisterMode
    ? 'Sign in instead <i class="fa-solid fa-arrow-right"></i>'
    : 'Create an account <i class="fa-solid fa-arrow-right"></i>';

  passwordInput.autocomplete = isRegisterMode
    ? "new-password"
    : "current-password";

  passwordInput.setAttribute("minlength", "6");
}

function friendlyError(error) {
  switch (error.code) {
    case "auth/invalid-email":
      return "That email address doesn't look valid. Check it and try again.";

    case "auth/missing-password":
      return "Please enter your password.";

    case "auth/weak-password":
      return "Choose a stronger password with at least 6 characters.";

    case "auth/email-already-in-use":
      return "An account with this email already exists. Try signing in instead.";

    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "The email or password is incorrect. Check your details and try again.";

    case "auth/user-disabled":
      return "This account has been disabled. Contact the administrator.";

    case "auth/too-many-requests":
      return "Too many attempts. Please wait a while before trying again.";

    case "auth/network-request-failed":
      return "Network error. Check your internet connection and try again.";

    case "auth/operation-not-allowed":
      return "Email and password sign-in is not enabled. Enable it in Firebase Authentication.";

    case "auth/weak-password":
      return "Your password must contain at least 6 characters.";

    case "auth/invalid-api-key":
      return "Firebase rejected the API key. Check the configuration in js/firebase.js.";

    case "auth/unauthorized-domain":
      return "This website domain is not authorised. Add it under Firebase Authentication settings.";

    default:
      console.error("Firebase Authentication error:", error);
      return error.message || "Something went wrong. Please try again.";
  }
}

toggleModeButton.addEventListener("click", () => {
  if (isBusy) return;

  isRegisterMode = !isRegisterMode;
  clearMessage();
  form.reset();
  updateModeUI();
});

passwordToggle.addEventListener("click", () => {
  const shouldShow = passwordInput.type === "password";

  passwordInput.type = shouldShow ? "text" : "password";

  passwordToggle.innerHTML = shouldShow
    ? '<i class="fa-regular fa-eye-slash"></i>'
    : '<i class="fa-regular fa-eye"></i>';

  passwordToggle.setAttribute(
    "aria-label",
    shouldShow ? "Hide password" : "Show password"
  );

  passwordToggle.title = shouldShow ? "Hide password" : "Show password";
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  if (isBusy) return;

  clearMessage();

  const email = emailInput.value.trim();
  const password = passwordInput.value;

  if (!email || !password) {
    showMessage("Enter your email address and password.");
    return;
  }

  if (password.length < 6) {
    showMessage("Your password must contain at least 6 characters.");
    return;
  }

  setBusy(true, isRegisterMode ? "Creating your account..." : "Signing you in...");

  try {
    if (isRegisterMode) {
      await createUserWithEmailAndPassword(auth, email, password);
      // Firebase signs the new user in automatically.
    } else {
      await signInWithEmailAndPassword(auth, email, password);
    }

    showMessage(
      isRegisterMode
        ? "Account created! Opening your workspace..."
        : "Signed in successfully! Opening your workspace...",
      "success"
    );

    window.location.replace("./products.html");
  } catch (error) {
    showMessage(friendlyError(error));
    setBusy(false);
  }
});

forgotButton.addEventListener("click", async () => {
  if (isBusy) return;

  clearMessage();

  const email = emailInput.value.trim();

  if (!email) {
    showMessage("Enter your email address first, then select Forgot password.");
    emailInput.focus();
    return;
  }

  setBusy(true, "Sending reset email...");

  try {
    await sendPasswordResetEmail(auth, email);

    showMessage(
      "If an account exists for that email, a password reset message has been sent. Check your inbox and spam folder.",
      "success"
    );
  } catch (error) {
    showMessage(friendlyError(error));
  } finally {
    setBusy(false);
  }
});

onAuthStateChanged(auth, (user) => {
  authReady = true;

  if (user) {
    window.location.replace("./products.html");
  }
});

updateModeUI();
console.log("Cruz Heist login page loaded.");
