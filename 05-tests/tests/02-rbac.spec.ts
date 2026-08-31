import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD, E2E_ADMINS, RUN_ID } from "./helpers/env";
import { kanbanColumn, loginUI, toast } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

const CONSULTOR_EMAIL = `consultor-rbac-${RUN_ID}@example.com`;
const CONSULTOR_PASSWORD = "Consultor123!";

test.describe("RBAC", () => {
  let adminPage: Page;

  test.beforeAll(async ({ browser }) => {
    adminPage = await browser.newPage();
    await loginUI(adminPage, E2E_ADMINS.rbac, E2E_ADMIN_PASSWORD);
  });

  test.afterAll(async () => {
    await adminPage?.close();
  });

  test("admin cria consultor nas Configurações", async () => {
    await adminPage.goto("/configuracoes");
    await adminPage.getByRole("button", { name: "Novo consultor" }).click();

    const dialog = adminPage.getByRole("dialog");
    await dialog.getByLabel("Nome", { exact: true }).fill("Consultor RBAC E2E");
    await dialog.getByLabel("E-mail", { exact: true }).fill(CONSULTOR_EMAIL);
    await dialog.getByLabel("Senha inicial").fill(CONSULTOR_PASSWORD);
    // Perfil default = Consultor
    await dialog.getByRole("button", { name: "Criar", exact: true }).click();

    await expect(toast(adminPage, "Usuário criado.")).toBeVisible();
    await expect(
      adminPage.getByRole("cell", { name: CONSULTOR_EMAIL }),
    ).toBeVisible();
  });

  test("consultor não vê menus de admin e URLs diretas redirecionam", async ({
    browser,
  }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginUI(page, CONSULTOR_EMAIL, CONSULTOR_PASSWORD);

    // Vê o kanban normalmente (funil novo de 6 etapas).
    await expect(kanbanColumn(page, "Novo lead")).toBeVisible();
    await expect(kanbanColumn(page, "Tentando contato")).toBeVisible();
    await expect(kanbanColumn(page, "Concluído")).toBeVisible();

    // Menu sem Relatórios/Configurações (Meu Dia é o 1º item para todo role).
    await expect(page.getByRole("link", { name: "Meu Dia" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Negociações" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Minhas tarefas" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Relatórios" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Configurações" })).toHaveCount(0);

    // Acesso direto pela URL é redirecionado pro kanban.
    await page.goto("/relatorios");
    await page.waitForURL("**/negociacoes");
    await page.goto("/configuracoes");
    await page.waitForURL("**/negociacoes");

    await ctx.close();
  });
});
