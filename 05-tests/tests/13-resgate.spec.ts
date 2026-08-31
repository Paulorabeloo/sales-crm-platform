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

const LEAD_NAME = `Lead Resgate ${RUN_ID}`;
const NEW_CYCLE = `Resgate ${RUN_ID}`;
const LOST_REASON = "Preço/mensalidade"; // recuperável no seed

/** YYYY-MM-DD local de hoje. */
function todayISO(): string {
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

test.describe("Resgate: reabrir lead perdido no ciclo ativo", () => {
  let page: Page;
  let api: ApiClient;
  let oldDealId: string;
  let oldCycleName: string;
  let newCycleId: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginUI(page, E2E_ADMINS.rescue, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.rescue, E2E_ADMIN_PASSWORD);
    const me = await api.me();

    // Perde um lead (motivo recuperável) no ciclo ativo atual...
    oldCycleName = (await api.getActiveCycle()).name;
    const reasons = await api.listLostReasons();
    const reason = reasons.find((r) => r.label === LOST_REASON);
    if (!reason) throw new Error(`Lost reason "${LOST_REASON}" not seeded`);
    const deal = await api.createDeal({
      title: LEAD_NAME,
      phone: uniquePhone(),
      ownerId: me.id,
      interestCourse: "Direito",
    });
    oldDealId = deal.id;
    await api.registerFirstContact(oldDealId);
    await api.markLost(oldDealId, reason.id);

    // ...e vira o ciclo: a perda passa a ser "de ciclo anterior".
    const cycle = await api.createCycle({
      name: NEW_CYCLE,
      startsOn: todayISO(),
      activate: true,
    });
    newCycleId = cycle.id;
  });

  test.afterAll(async () => {
    await api?.dispose();
    await page?.close();
  });

  test("aba Resgate lista o lead perdido; reabrir cria negociação nova e o item some", async () => {
    await page.goto("/meu-dia");
    const rescueTab = page.getByRole("tab", { name: /Resgate/ });
    // Badge de contagem na própria aba (>= 1).
    await expect(rescueTab).toContainText(/[1-9]/);
    await rescueTab.click();

    // Agrupado pelo motivo de perda, com ciclo de origem e idade.
    await expect(
      page.getByRole("heading", { name: new RegExp(LOST_REASON) }),
    ).toBeVisible();
    const row = page.locator("li").filter({ hasText: LEAD_NAME });
    await expect(row).toBeVisible();
    await expect(row).toContainText(`Ciclo de origem: ${oldCycleName}`);

    // Reabrir no ciclo atual -> dialog de confirmação.
    await row.getByRole("button", { name: "Reabrir no ciclo atual" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(LEAD_NAME);
    await dialog.getByRole("button", { name: "Confirmar" }).click();
    await expect(
      toast(page, "Negociação reaberta no ciclo atual."),
    ).toBeVisible();

    // O item SOME da lista (fix: /deals/recoverable exclui deals reabertos).
    await expect(page.locator("li").filter({ hasText: LEAD_NAME })).toHaveCount(0);

    // Recarregar não o traz de volta (o filtro é do backend, não do cache).
    await page.reload();
    await page.getByRole("tab", { name: /Resgate/ }).click();
    await expect(page.locator("li").filter({ hasText: LEAD_NAME })).toHaveCount(0);
  });

  test("deal novo nasce aberto no ciclo ativo; o antigo permanece perdido e fora da lista", async () => {
    // O antigo permanece lost, com o cross-link na timeline.
    const oldDeal = await api.getDeal(oldDealId);
    expect(oldDeal.status).toBe("lost");
    const timeline = await api.get<{
      items: Array<{ type: string; payload: { new_deal_id?: string } }>;
    }>(`/deals/${oldDealId}/activities`);
    const link = timeline.items.find((a) => a.type === "reopened_in_cycle");
    expect(link, "activity reopened_in_cycle deve existir").toBeTruthy();

    // O novo é aberto, no ciclo ativo, na 1ª etapa, com a qualificação copiada.
    const newDeal = await api.getDeal(link!.payload.new_deal_id!);
    expect(newDeal.status).toBe("open");
    expect(newDeal.cycle_id).toBe(newCycleId);
    expect(newDeal.enrollment_data?.interest_course).toBe("Direito");
    const me = await api.me();
    expect(newDeal.owner_id).toBe(me.id);

    // E a API de resgate não lista mais o deal antigo (fix do QA final).
    const recoverable = await api.recoverable();
    expect(
      recoverable.items.map((i) => i.deal_id),
    ).not.toContain(oldDealId);
  });
});
