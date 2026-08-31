import { expect, test, type Page } from "@playwright/test";
import { ApiClient } from "./helpers/api";
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMINS,
  RUN_ID,
  uniquePhone,
} from "./helpers/env";
import { loginUI, toast } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

const DEAL_NAME = `Negociação Tarefas ${RUN_ID}`;
const TASK_TITLE = `Ligar para confirmar documentos ${RUN_ID}`;

test.describe("Tarefas", () => {
  let page: Page;
  let api: ApiClient;
  let dealId: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginUI(page, E2E_ADMINS.tasks, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.tasks, E2E_ADMIN_PASSWORD);
    const me = await api.me();
    const deal = await api.createDeal({
      title: DEAL_NAME,
      phone: uniquePhone(),
      ownerId: me.id,
    });
    dealId = deal.id;
  });

  test.afterAll(async () => {
    await api?.dispose();
    await page?.close();
  });

  test("criar tarefa no deal com vencimento", async () => {
    await page.goto(`/negociacoes/${dealId}`);
    await page.getByRole("button", { name: "Nova tarefa" }).click();

    const dialog = page.getByRole("dialog");
    await dialog.getByLabel("O que precisa ser feito?").fill(TASK_TITLE);
    // Vencimento default = hoje (mantido de propósito: cai no grupo "Hoje").
    await expect(dialog.getByLabel("Vencimento")).not.toHaveValue("");
    await dialog.getByRole("button", { name: "Criar", exact: true }).click();

    await expect(toast(page, "Tarefa criada.")).toBeVisible();
    // Escopo no card "Tarefas" — o título também aparece no Histórico
    // (activity task_created).
    const tasksCard = page
      .locator("div.rounded-lg.border, div.rounded-xl.border")
      .filter({ has: page.getByRole("heading", { name: "Tarefas", exact: true }) });
    const row = tasksCard.locator("li").filter({ hasText: TASK_TITLE });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Vence em");
  });

  test("aparece em Minhas tarefas e pode ser concluída", async () => {
    await page.goto("/tarefas");

    const todayGroup = page
      .locator("div.rounded-lg.border, div.rounded-xl.border")
      .filter({ has: page.getByRole("heading", { name: /^Hoje/ }) });
    const row = todayGroup.locator("li").filter({ hasText: TASK_TITLE });
    await expect(row).toBeVisible();

    await row.getByRole("checkbox", { name: "Concluir" }).click();
    await expect(toast(page, "Tarefa concluída.")).toBeVisible();
    // Concluída sai da lista de pendentes.
    await expect(
      page.locator("li").filter({ hasText: TASK_TITLE }),
    ).toHaveCount(0);
  });
});
