import { expect, test, type Page } from "@playwright/test";
import { ApiClient } from "./helpers/api";
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMINS,
  RUN_ID,
  uniquePhone,
} from "./helpers/env";
import { loginUI, resolveNextContactPrompt, toast } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

const LEAD_NAME = `Lead Meu Dia ${RUN_ID}`;

test.describe("Meu Dia (spec 09.1): responder agora + quick log com cadência", () => {
  let page: Page;
  let api: ApiClient;
  let dealId: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginUI(page, E2E_ADMINS.myDay, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.myDay, E2E_ADMIN_PASSWORD);
    const me = await api.me();
    // Lead próprio SEM 1º contato -> deve cair em "Responder agora".
    const deal = await api.createDeal({
      title: LEAD_NAME,
      phone: uniquePhone(),
      ownerId: me.id,
      interestCourse: "Direito",
    });
    dealId = deal.id;
  });

  test.afterAll(async () => {
    await api?.dispose();
    await page?.close();
  });

  test("lead novo aparece em Responder agora com idade em destaque", async () => {
    await page.goto("/meu-dia");
    await expect(
      page.getByRole("heading", { name: "Meu Dia" }),
    ).toBeVisible();

    await expect(
      page.getByRole("heading", { name: "Responder agora" }),
    ).toBeVisible();
    const row = page.locator("li").filter({ hasText: LEAD_NAME });
    await expect(row).toBeVisible();
    await expect(row).toContainText("Direito");
    // Chip de idade do lead ("há 0min" logo após criar).
    await expect(row.getByText(/há \d+(min|h|d)/)).toBeVisible();
    // Ações rápidas na linha: WhatsApp + registrar contato.
    await expect(
      row.getByRole("button", { name: "Abrir WhatsApp" }),
    ).toBeVisible();
    await expect(
      row.getByRole("button", { name: "Registrar contato" }),
    ).toBeVisible();
  });

  test("quick log Sem resposta + agendar D+1 tira o lead de Responder agora", async () => {
    const row = page.locator("li").filter({ hasText: LEAD_NAME });
    await row.getByRole("button", { name: "Registrar contato" }).click();
    await page.getByRole("menuitem", { name: "Sem resposta" }).click();
    await expect(toast(page, "Contato registrado.")).toBeVisible();

    // Prompt encadeado, com "Amanhã" sugerido pela cadência (1ª tentativa ->
    // D+1, followup_cadence [1,3,7]).
    await expect(
      page.getByText(/Sugerido pela cadência: amanhã/),
    ).toBeVisible();
    await resolveNextContactPrompt(page, "Amanhã");
    await expect(toast(page, "Próximo contato agendado.")).toBeVisible();

    // O quick log conta como contato (1º contato registrado) e o follow-up é
    // amanhã -> o lead sai de "Responder agora" (e do Meu Dia de hoje).
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Meu Dia" }),
    ).toBeVisible();
    await expect(page.locator("li").filter({ hasText: LEAD_NAME })).toHaveCount(0);

    // Confirmação no backend: contato registrado + próximo contato amanhã.
    const deal = await api.getDeal(dealId);
    expect(deal.first_whatsapp_contact_at).not.toBeNull();
    expect(deal.next_contact_at).not.toBeNull();
  });
});
