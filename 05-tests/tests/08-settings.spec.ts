import { expect, test, type Page } from "@playwright/test";
import { E2E_ADMIN_PASSWORD, E2E_ADMINS, RUN_ID } from "./helpers/env";
import { kanbanFilterTrigger, loginUI, toast } from "./helpers/ui";

test.describe.configure({ mode: "serial" });

const OLD_NAME = "Unidade 1";
const NEW_NAME = `Unidade Centro ${RUN_ID}`;

test.describe("Configurações — renomear unidade", () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await loginUI(page, E2E_ADMINS.settings, E2E_ADMIN_PASSWORD);
  });

  test.afterAll(async () => {
    await page?.close();
  });

  test("renomear a unidade reflete no filtro do kanban", async () => {
    await page.goto("/configuracoes");
    await page.getByRole("tab", { name: "Unidades" }).click();

    // Acha o input da linha cujo valor é "Unidade 1" (o campo "nova unidade"
    // tem o mesmo rótulo, mas está vazio).
    const inputs = page.getByRole("textbox", { name: "Nome da unidade" });
    await expect(inputs.first()).toBeVisible();
    const count = await inputs.count();
    let target = null;
    let oldValue = OLD_NAME;
    for (let i = 0; i < count; i++) {
      if ((await inputs.nth(i).inputValue()) === OLD_NAME) {
        target = inputs.nth(i);
        break;
      }
    }
    if (!target) {
      // Retry em novo worker: "Unidade 1" pode já ter sido renomeada na
      // tentativa anterior — renomeia a primeira unidade existente.
      for (let i = 0; i < count; i++) {
        const value = await inputs.nth(i).inputValue();
        if (value) {
          target = inputs.nth(i);
          oldValue = value;
          break;
        }
      }
    }
    expect(target, "deve existir uma unidade para renomear").not.toBeNull();

    await target!.fill(NEW_NAME);
    await target!.press("Enter"); // blur -> salva
    await expect(toast(page, "Unidade atualizada.")).toBeVisible();

    // O novo nome aparece no filtro "Unidade" do kanban (e o antigo some).
    await page.goto("/negociacoes");
    await kanbanFilterTrigger(page, "Unidade").click();
    await expect(
      page.getByRole("option", { name: NEW_NAME, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: oldValue, exact: true }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
  });
});
