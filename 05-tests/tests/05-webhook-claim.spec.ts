import { expect, test, type Page } from "@playwright/test";
import { ApiClient } from "./helpers/api";
import {
  API_URL,
  E2E_ADMIN_PASSWORD,
  E2E_ADMINS,
  RUN_ID,
  uniquePhone,
} from "./helpers/env";
import { dealCard, kanbanColumn, leadQueue, loginUI, toast } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

const SOURCE_NAME = `LP Webhook ${RUN_ID}`;
const LEAD_NAME = `Lead Webhook ${RUN_ID}`;
const CONSULTOR_EMAIL = `consultor-fila-${RUN_ID}@example.com`;
const CONSULTOR_PASSWORD = "Consultor123!";

test.describe("Webhook de captação + fila / assumir", () => {
  let adminPage: Page;
  let api: ApiClient;
  let webhookToken: string;
  let dealId: string;

  test.beforeAll(async ({ browser }) => {
    adminPage = await browser.newPage();
    await loginUI(adminPage, E2E_ADMINS.webhook, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.webhook, E2E_ADMIN_PASSWORD);
    await api.createUser({
      email: CONSULTOR_EMAIL,
      name: "Consultor Fila E2E",
      password: CONSULTOR_PASSWORD,
      role: "CONSULTOR",
    });
  });

  test.afterAll(async () => {
    await api?.dispose();
    await adminPage?.close();
  });

  test("admin cria fonte de lead nas Configurações e copia a URL do webhook", async () => {
    await adminPage.goto("/configuracoes");
    await adminPage.getByRole("tab", { name: "Fontes de lead" }).click();
    await adminPage.getByLabel("Nome da fonte").fill(SOURCE_NAME);
    await adminPage.getByRole("button", { name: "Nova fonte" }).click();
    await expect(toast(adminPage, "Fonte criada.")).toBeVisible();

    // Único source criado nesta run — o card exibe a URL num <code>.
    const sourceCard = adminPage
      .locator("div.rounded-lg.border, div.rounded-xl.border")
      .filter({ has: adminPage.getByText(SOURCE_NAME, { exact: true }) })
      .last();
    const url = (await sourceCard.locator("code").innerText()).trim();
    expect(url).toContain("/webhooks/leads/");
    webhookToken = url.split("/").pop()!;
    expect(webhookToken.length).toBeGreaterThanOrEqual(32);
  });

  test("POST no webhook cria lead sem dono (202)", async ({ request }) => {
    const res = await request.post(`${API_URL}/webhooks/leads/${webhookToken}`, {
      data: {
        name: LEAD_NAME,
        phone: uniquePhone(),
        course_of_interest: "Enfermagem",
        campaign: "e2e-campanha",
      },
    });
    expect(res.status()).toBe(202);
    const body = (await res.json()) as { result: string; deal_id: string };
    expect(body.result).toBe("accepted");
    dealId = body.deal_id;

    // O deal nasce sem dono (fila).
    const deal = await api.getDeal(dealId);
    expect(deal.owner_id).toBeNull();
    expect(deal.status).toBe("open");
  });

  test("consultor vê o lead na fila e assume (vira dono)", async ({ browser }) => {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await loginUI(page, CONSULTOR_EMAIL, CONSULTOR_PASSWORD);

    const queue = leadQueue(page);
    await expect(queue).toBeVisible();
    const queued = dealCard(queue, LEAD_NAME);
    await expect(queued).toBeVisible();
    await expect(queued).toContainText("Enfermagem");

    await queued.getByRole("button", { name: "Assumir" }).click();
    await expect(toast(page, "Negociação assumida!")).toBeVisible();

    // Saiu da fila e entrou na 1ª coluna do funil novo.
    await expect(
      dealCard(kanbanColumn(page, "Novo lead"), LEAD_NAME),
    ).toBeVisible();
    await expect(dealCard(leadQueue(page), LEAD_NAME)).toHaveCount(0);

    // Confirmação de dono via API, com a visão do próprio consultor.
    const consultorApi = await ApiClient.login(CONSULTOR_EMAIL, CONSULTOR_PASSWORD);
    const me = await consultorApi.me();
    const deal = await consultorApi.getDeal(dealId);
    expect(deal.owner_id).toBe(me.id);

    // Cadência: o webhook criou a task automática "Make first
    // contact" sem dono; o claim atribuiu ao consultor.
    const tasks = await consultorApi.get<
      Array<{ title: string; assigned_to: string | null }>
    >(`/deals/${dealId}/tasks`);
    const autoTask = tasks.find((t) => t.title === "Make first contact");
    expect(autoTask, "task automática do webhook deve existir").toBeTruthy();
    expect(autoTask!.assigned_to).toBe(me.id);

    await consultorApi.dispose();
    await ctx.close();
  });
});
