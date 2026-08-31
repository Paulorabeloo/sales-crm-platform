/**
 * Popup: login/logout + API and CRM base-URL configuration.
 * All texts come from strings.ts (pt-BR).
 */

import { api } from "../lib/api";
import { STRINGS } from "../lib/strings";

function byId<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const loginView = byId<HTMLDivElement>("login-view");
const sessionView = byId<HTMLDivElement>("session-view");
const emailInput = byId<HTMLInputElement>("email");
const passwordInput = byId<HTMLInputElement>("password");
const loginBtn = byId<HTMLButtonElement>("login-btn");
const loginMessage = byId<HTMLDivElement>("login-message");
const logoutBtn = byId<HTMLButtonElement>("logout-btn");
const apiBaseInput = byId<HTMLInputElement>("api-base");
const crmBaseInput = byId<HTMLInputElement>("crm-base");
const saveConfigBtn = byId<HTMLButtonElement>("save-config-btn");
const configMessage = byId<HTMLDivElement>("config-message");

function applyStrings(): void {
  byId("title").textContent = STRINGS.popupTitle;
  byId("email-label").textContent = STRINGS.emailLabel;
  byId("password-label").textContent = STRINGS.passwordLabel;
  loginBtn.textContent = STRINGS.loginButton;
  byId("logged-as-label").textContent = STRINGS.loggedInAs;
  logoutBtn.textContent = STRINGS.logoutButton;
  byId("session-hint").textContent = STRINGS.sessionInfo;
  byId("settings-title").textContent = STRINGS.settingsTitle;
  byId("api-base-label").textContent = STRINGS.apiBaseLabel;
  byId("crm-base-label").textContent = STRINGS.crmBaseLabel;
  saveConfigBtn.textContent = STRINGS.save;
}

async function renderAuth(): Promise<void> {
  const state = await api.getAuthState();
  const loggedIn = state.ok && state.data.loggedIn && state.data.user;
  loginView.classList.toggle("hidden", Boolean(loggedIn));
  sessionView.classList.toggle("hidden", !loggedIn);
  if (state.ok && state.data.user) {
    byId("user-name").textContent = state.data.user.name;
    byId("user-email").textContent = state.data.user.email;
  }
}

async function renderConfig(): Promise<void> {
  const config = await api.getConfig();
  if (config.ok) {
    apiBaseInput.value = config.data.apiBase;
    crmBaseInput.value = config.data.crmBase;
  }
}

function isValidHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

loginBtn.addEventListener("click", async () => {
  const email = emailInput.value.trim();
  const password = passwordInput.value;
  if (!email || !password) return;
  loginBtn.disabled = true;
  loginBtn.textContent = STRINGS.loggingIn;
  loginMessage.className = "message";
  loginMessage.textContent = "";

  const result = await api.login(email, password);
  loginBtn.disabled = false;
  loginBtn.textContent = STRINGS.loginButton;
  if (!result.ok) {
    loginMessage.className = "message error";
    if (result.error.status === 401) loginMessage.textContent = STRINGS.loginFailed;
    else if (result.error.status === 429) loginMessage.textContent = STRINGS.loginRateLimited;
    else if (result.error.status === 0) loginMessage.textContent = STRINGS.errorNetwork;
    else loginMessage.textContent = result.error.detail || STRINGS.errorGeneric;
    return;
  }
  passwordInput.value = "";
  await renderAuth();
});

passwordInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") loginBtn.click();
});

logoutBtn.addEventListener("click", async () => {
  await api.logout();
  await renderAuth();
});

saveConfigBtn.addEventListener("click", async () => {
  const apiBase = apiBaseInput.value.trim();
  const crmBase = crmBaseInput.value.trim();
  configMessage.className = "message";
  if (!isValidHttpUrl(apiBase) || !isValidHttpUrl(crmBase)) {
    configMessage.className = "message error";
    configMessage.textContent = STRINGS.invalidUrl;
    return;
  }
  await api.setConfig({ apiBase, crmBase });
  configMessage.className = "message ok";
  configMessage.textContent = STRINGS.settingsSaved;
});

applyStrings();
void renderAuth();
void renderConfig();
