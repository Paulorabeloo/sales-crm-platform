import { expect, type Locator, type Page } from "@playwright/test";

/** UI login through the real /login form; waits for the kanban to load. */
export async function loginUI(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel("E-mail").fill(email);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await page.waitForURL("**/negociacoes");
  await expect(
    page.getByRole("heading", { name: "Negociações", exact: true }),
  ).toBeVisible();
}

/**
 * Desktop kanban column (w-64 wrapper since the visual overhaul) identified
 * by its stage heading. The board is duplicated for mobile (hidden
 * accordion), so scope to the desktop wrapper first.
 */
export function kanbanColumn(page: Page, stageName: string): Locator {
  return page
    .locator("div.hidden.md\\:block div.w-64")
    .filter({ has: page.getByRole("heading", { name: stageName, exact: true }) });
}

/**
 * A deal card inside a locator, matched by contact name.
 * On the board, dnd-kit wraps the card in a second role=button element — the
 * presentational card (the one with `cursor-pointer`) is targeted to keep the
 * locator strict-mode safe.
 */
export function dealCard(scope: Locator | Page, contactName: string): Locator {
  return scope
    .locator("div[role='button'].cursor-pointer")
    .filter({ hasText: contactName });
}

/**
 * Section card (shadcn Card is `rounded-lg border` since the visual overhaul;
 * a few authored containers still use `rounded-xl border`) identified by its
 * heading.
 */
export function sectionCard(page: Page, heading: string | RegExp): Locator {
  return page
    .locator("div.rounded-lg.border, div.rounded-xl.border")
    .filter({ has: page.getByRole("heading", { name: heading }) });
}

/** The "Fila de novos leads" queue block on the kanban page. */
export function leadQueue(page: Page): Locator {
  return page.locator("details").filter({ hasText: "Fila de novos leads" });
}

/**
 * dnd-kit drag (PointerSensor, activation distance 8px): manual mouse
 * movement in small steps from the card center to the target column center.
 */
export async function dragCardToColumn(
  page: Page,
  card: Locator,
  targetColumn: Locator,
): Promise<void> {
  const cardBox = await card.boundingBox();
  const targetBox = await targetColumn.boundingBox();
  if (!cardBox || !targetBox) throw new Error("drag: card or column not visible");

  const startX = cardBox.x + cardBox.width / 2;
  const startY = cardBox.y + Math.min(20, cardBox.height / 2); // grab near the top (below is a button)
  const endX = targetBox.x + targetBox.width / 2;
  const endY = targetBox.y + targetBox.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  // First small move crosses the 8px activation distance.
  await page.mouse.move(startX + 12, startY + 2, { steps: 3 });
  await page.mouse.move(endX, endY, { steps: 20 });
  await page.mouse.move(endX, endY + 4, { steps: 2 });
  await page.mouse.up();
}

/** Open a Radix select (trigger inside the container) and pick an option. */
export async function selectOption(
  page: Page,
  trigger: Locator,
  optionName: string,
): Promise<void> {
  await trigger.click();
  await page.getByRole("option", { name: optionName, exact: true }).click();
}

/** Kanban filter select trigger, located right below its small label. */
export function kanbanFilterTrigger(page: Page, label: string): Locator {
  return page
    .locator("div.flex.flex-col.gap-1")
    .filter({ has: page.locator("label", { hasText: label }) })
    .getByRole("combobox");
}

/** Sonner toast containing the given text. */
export function toast(page: Page, text: string | RegExp): Locator {
  return page.locator("[data-sonner-toast]").filter({ hasText: text });
}

/** The "Próximo contato" one-click prompt dialog (chained after actions). */
export function nextContactPrompt(page: Page): Locator {
  return page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Próximo contato" }) });
}

/**
 * Resolve the next-contact prompt. `option` is the button label ("Amanhã",
 * "Em 3 dias", …) or "Sem próximo passo" to skip.
 */
export async function resolveNextContactPrompt(
  page: Page,
  option: string,
): Promise<void> {
  const dialog = nextContactPrompt(page);
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: option, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/**
 * Replaces window.open with a recorder (survives navigations on this page).
 * Read the captured URLs with openedUrls().
 */
export async function stubWindowOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as { __openedUrls: string[] };
    w.__openedUrls = [];
    window.open = ((url?: string | URL) => {
      w.__openedUrls.push(String(url ?? ""));
      return null;
    }) as typeof window.open;
  });
}

export function openedUrls(page: Page): Promise<string[]> {
  return page.evaluate(
    () => (window as unknown as { __openedUrls?: string[] }).__openedUrls ?? [],
  );
}

/** Open /configuracoes on the given tab. */
export async function openSettingsTab(page: Page, tab: string): Promise<void> {
  await page.goto("/configuracoes");
  await page.getByRole("tab", { name: tab, exact: true }).click();
}
