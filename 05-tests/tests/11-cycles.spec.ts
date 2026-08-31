import { expect, test, type Page } from "@playwright/test";
import { ApiClient } from "./helpers/api";
import {
  E2E_ADMIN_PASSWORD,
  E2E_ADMINS,
  RUN_ID,
  uniquePhone,
} from "./helpers/env";
import {
  dealCard,
  kanbanColumn,
  loginUI,
  openSettingsTab,
  toast,
} from "./helpers/ui";

test.describe.configure({ mode: "serial" });

const CYCLE_NAME = `2026.2 E2E ${RUN_ID}`;
const DEAL_NAME = `Lead Rollover ${RUN_ID}`;

/** YYYY-MM-DD local, N days from now. */
function isoInDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Table row of the Ciclos tab whose editable name input holds `name`
 * (the inputs are controlled, so the value lives in the DOM property).
 */
async function cycleRow(
  page: Page,
  name: string,
): Promise<ReturnType<Page["locator"]>> {
  const nameInputs = page.getByRole("textbox", { name: "Nome" });
  await expect(nameInputs.first()).toBeVisible();
  for (let i = 0; i < (await nameInputs.count()); i++) {
    if ((await nameInputs.nth(i).inputValue()) === name) {
      return nameInputs.nth(i).locator("xpath=ancestor::tr");
    }
  }
  throw new Error(`Ciclo "${name}" não encontrado na tabela`);
}

test.describe("Ciclos (spec 10.1): countdown no kanban + rollover", () => {
  let page: Page;
  let api: ApiClient;
  let dealId: string;
  let oldCycleName: string;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginUI(page, E2E_ADMINS.cycles, E2E_ADMIN_PASSWORD);
    api = await ApiClient.login(E2E_ADMINS.cycles, E2E_ADMIN_PASSWORD);
    const me = await api.me();
    // Deal ABERTO no ciclo ativo atual: é ele que o rollover vai mover.
    oldCycleName = (await api.getActiveCycle()).name;
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

  test("criar ciclo com prazo, ativar e ver o countdown no kanban", async () => {
    await openSettingsTab(page, "Ciclos");

    await page.locator("#new-cycle-name").fill(CYCLE_NAME);
    await page.locator("#new-cycle-deadline").fill(isoInDays(5));
    await page.getByRole("button", { name: "Novo ciclo" }).click();
    await expect(toast(page, "Ciclo criado.")).toBeVisible();

    const row = await cycleRow(page, CYCLE_NAME);

    // Ativar abre o dialog de aviso (o ciclo atual será desativado).
    await row.getByRole("button", { name: "Ativar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText("O ciclo atual será desativado.");
    await dialog.getByRole("button", { name: "Confirmar" }).click();
    await expect(toast(page, "Ciclo ativado.")).toBeVisible();

    // Kanban: chip do ciclo ativo com countdown "Faltam 5 dias".
    await page.goto("/negociacoes");
    await expect(
      page.getByText(`Ciclo ativo: ${CYCLE_NAME}`),
    ).toBeVisible();
    await expect(page.getByText("Faltam 5 dias", { exact: true })).toBeVisible();
  });

  test("rollover move os deals abertos do ciclo antigo para o ativo", async () => {
    // Antes do rollover o deal segue no ciclo antigo (o filtro default do
    // kanban é o ciclo ativo novo, então ele some do board).
    await page.goto("/negociacoes");
    await expect(dealCard(kanbanColumn(page, "Novo lead"), DEAL_NAME)).toHaveCount(0);

    await openSettingsTab(page, "Ciclos");
    const oldRow = await cycleRow(page, oldCycleName);
    await oldRow.getByRole("button", { name: "Rolar leads abertos" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toContainText(
      /negociaç(ão|ões) abertas? ser(á|ão) movidas? para o ciclo ativo/,
    );
    await dialog.getByRole("button", { name: "Confirmar" }).click();
    await expect(
      toast(page, /negociaç(ão|ões) movidas? para o ciclo ativo\./),
    ).toBeVisible();

    // O deal aberto mudou de ciclo (won/lost ficam onde estão) e a timeline
    // ganhou o evento tipado.
    const activeCycle = await api.getActiveCycle();
    expect(activeCycle.name).toBe(CYCLE_NAME);
    const deal = await api.getDeal(dealId);
    expect(deal.cycle_id).toBe(activeCycle.id);
    const timeline = await api.get<{ items: Array<{ type: string }> }>(
      `/deals/${dealId}/activities`,
    );
    expect(timeline.items.some((a) => a.type === "cycle_changed")).toBe(true);

    // Com o filtro default (ciclo ativo) o card volta a aparecer no kanban.
    await page.goto("/negociacoes");
    await expect(
      dealCard(kanbanColumn(page, "Novo lead"), DEAL_NAME),
    ).toBeVisible();

    // Timeline no detalhe mostra o label pt-BR com origem -> destino.
    await page.goto(`/negociacoes/${dealId}`);
    await expect(page.getByText("Mudou de ciclo")).toBeVisible();
    await expect(
      page.getByText(`${oldCycleName} → ${CYCLE_NAME}`),
    ).toBeVisible();
  });
});
