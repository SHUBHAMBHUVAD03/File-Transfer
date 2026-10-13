import { test, expect } from '@playwright/test';
import { NonMonitoringTable } from '../pages/NonMonitoringTable';
import { LoginPage } from '../pages/LoginPage';

// Same clean-up for UI and API values: collapse extra spaces and trim
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

const normalize = (record) => ({
    accountNumber: clean(record.accountNumber),
    date: clean(record.date),
    description: clean(record.description)
});

// Sort key, so the comparison does not depend on row order
const byKey = (a, b) =>
    `${a.accountNumber}|${a.date}|${a.description}`.localeCompare(
        `${b.accountNumber}|${b.date}|${b.description}`
    );

// ---- sorting helpers (only Account and Date have a sort toggle) ----
const toTime = (value) => {
    const [month, day, year] = value.split('/').map(Number); // MM/DD/YYYY
    return Date.UTC(year, month - 1, day);
};

const sortColumns = [
    { key: 'accountNumber', header: 'Account', compare: (a, b) => a.localeCompare(b, undefined, { numeric: true }) },
    { key: 'date', header: 'Date', compare: (a, b) => toTime(a) - toTime(b) }
];

const sameOrder = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);

const directionOf = (values, asc, desc) =>
    sameOrder(values, asc) ? 'asc' : sameOrder(values, desc) ? 'desc' : 'none';

// Login, open the Transactions tab and return the nmgetdata records (cleaned)
async function openNonMonetary(page) {
    const loginPage = new LoginPage(page);

    // Start listening BEFORE login so the nmgetdata call cannot be missed.
    // The timeout clock starts here, so allow time for login + customer search.
    const apiResponsePromise = page.waitForResponse(
        (response) =>
            response.url().includes('/fact-ai-api/processor/nmgetdata') &&
            response.request().method() === 'POST' &&
            response.status() === 200,
        { timeout: 120000 }
    );
    apiResponsePromise.catch(() => {}); // avoids "unhandled rejection" noise if the test fails earlier

    await loginPage.login();
    await loginPage.fraudDeposit('36992');
    await page.locator('//a[text() = "Transactions"]').click();

    const response = await apiResponsePromise;
    const apiData = await response.json();
    expect(Array.isArray(apiData.finalArray), 'nmgetdata response should contain finalArray').toBe(true);
    return apiData.finalArray.map(normalize);
}

test.describe('Non-Monetary section validation', () => {
    test('Non-Monetary section UI vs API validation', async ({ page }) => {
        test.setTimeout(180000);

        const nonMonetaryTable = new NonMonitoringTable(page);
        const apiRecords = await openNonMonetary(page);

        // UI data
        const uiRecords = (await nonMonetaryTable.getTableRecords()).map(normalize);

        // 1. Same number of records
        expect(uiRecords.length).toBe(apiRecords.length);

        // 2. Same data in every record (row order is ignored)
        expect(uiRecords.sort(byKey)).toEqual(apiRecords.sort(byKey));
    });

    test('Non-Monetary sorting validation (Account and Date columns)', async ({ page }) => {
        test.setTimeout(240000);

        const nonMonetaryTable = new NonMonitoringTable(page);
        const apiRecords = await openNonMonetary(page);
        let verifiedColumns = 0;

        for (const { key, header, compare } of sortColumns) {
            await test.step(`Sort by ${header}`, async () => {
                const apiValues = apiRecords.map((record) => record[key]);

                // Sorting cannot be proven when every row has the same value
                if (new Set(apiValues).size < 2) {
                    test.info().annotations.push({
                        type: 'column skipped',
                        description: `${header}: all values are the same, use a customer with different values`
                    });
                    return;
                }

                // Expected orders come from the API data
                const asc = [...apiValues].sort(compare);
                const desc = [...asc].reverse();

                const readColumn = async () =>
                    (await nonMonetaryTable.getTableRecords()).map((record) => normalize(record)[key]);
                const readDirection = async () => directionOf(await readColumn(), asc, desc);

                // 1st click: UI must be sorted exactly like the API data (asc or desc)
                const startDirection = await readDirection();
                await nonMonetaryTable.sortBy(header);
                await expect
                    .poll(readDirection, {
                        timeout: 15000,
                        message: `${header}: after the 1st click the UI order should match the API data sorted (API asc: ${asc.join(', ')})`
                    })
                    .toMatch(
                        startDirection === 'none'
                            ? /^(asc|desc)$/
                            : new RegExp(`^${startDirection === 'asc' ? 'desc' : 'asc'}$`)
                    );
                const firstDirection = await readDirection();

                // 2nd click: the order must flip
                await nonMonetaryTable.sortBy(header);
                await expect
                    .poll(readDirection, {
                        timeout: 15000,
                        message: `${header}: after the 2nd click the order should be reversed`
                    })
                    .toBe(firstDirection === 'asc' ? 'desc' : 'asc');

                verifiedColumns++;
            });
        }

        test.skip(verifiedColumns === 0, 'No column could be verified: all values are the same for this customer');
    });
});
