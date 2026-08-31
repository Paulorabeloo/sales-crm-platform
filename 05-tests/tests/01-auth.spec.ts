import { expect, test } from "@playwright/test";
import { ADMIN_EMAIL, ADMIN_PASSWORD, E2E_ADMINS } from "./helpers/env";
import { loginUI } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

test.describe("Auth", () => {
  test("rota protegida redireciona para /login quando deslogado", async ({ page }) => {
    await page.goto("/negociacoes");
    await page.waitForURL("**/login");
    await expect(
      page.getByRole("button", { name: "Entrar", exact: true }),
    ).toBeVisible();
  });

  test("senha errada mostra erro e não loga", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("E-mail").fill(E2E_ADMINS.auth);
    await page.getByLabel("Senha").fill("senha-errada-123");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    // (getByRole("alert") também pegaria o route-announcer do Next.)
    await expect(page.getByText("E-mail ou senha incorretos.")).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });

  test("login do admin funciona e logout encerra a sessão", async ({ page }) => {
    await loginUI(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await expect(page.getByRole("link", { name: "Relatórios" })).toBeVisible();

    await page.getByRole("button", { name: "Minha conta" }).click();
    await page.getByRole("menuitem", { name: "Sair" }).click();
    await page.waitForURL("**/login");

    // A sessão realmente acabou: rota protegida volta pro login.
    await page.goto("/negociacoes");
    await page.waitForURL("**/login");
  });
});
