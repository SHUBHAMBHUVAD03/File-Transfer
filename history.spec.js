import { test, expect } from '@playwright/test';
import { HistoryPage } from '../pages/HistoryPage';
import { LoginPage } from '../pages/LoginPage';

const CUSTOMER_ID = '10517528'; // customer whose History tab has 27 records

// Same clean-up for UI and API values: collapse extra spaces and trim
const clean = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();

// API record -> same shape as a UI row
const toRow = (record) => ({
    postingDate: clean(record.postingDate),
    description: clean(record.desc),
    dataItem: clean(record.dataItem),
    oldValue: clean(record.oldValue),
    newValue: clean(record.newValue)
});

// Sort key, so comparisons do not depend on row order
const keyOf = (r) => `${r.postingDate}|${r.description}|${r.dataItem}|${r.oldValue}|${r.newValue}`;
const byKey = (a, b) => keyOf(a).localeCompare(keyOf(b));

// ---- sorting helpers ----
const toTime = (value) => {
    const [month, day, year] = value.split('/').map(Number); // MM/DD/YYYY
    return Date.UTC(year, month - 1, day);
};
const sameOrder = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
const directionOf = (values, asc, desc) =>
    sameOrder(values, asc) ? 'asc' : sameOrder(values, desc) ? 'desc' : 'none';

test.describe('History section validation', () => {
    let historyPage;

    test.beforeEach(async ({ page }) => {
        test.setTimeout(240000);

        const loginPage = new LoginPage(page);
        historyPage = new HistoryPage(page);

        historyPage.startApiCapture(); // listen BEFORE login so no getdata call is missed
        await loginPage.login();
        await loginPage.fraudDeposit(CUSTOMER_ID);
        await historyPage.openHistoryTab();
    });

    // The getdata calls finish at different times: wait until the API total matches the UI total.
    // This is also the record-count check (API vs UI).
    async function getApiRows() {
        const { total } = await historyPage.getRecordCounts();
        await expect
            .poll(() => historyPage.getApiRecords().length, {
                timeout: 30000,
                message: `API records (all getdata calls) should equal the UI total (${total})`
            })
            .toBe(total);
        return historyPage.getApiRecords().map(toRow);
    }

    test('History table data matches the getdata API data', async () => {
        const apiRows = await getApiRows();
        const uiRows = await historyPage.getTableRecords();

        // 1. Same number of records
        expect(uiRows.length).toBe(apiRows.length);

        // 2. Same data in every record (row order is ignored)
        expect(uiRows.sort(byKey)).toEqual(apiRows.sort(byKey));
    });

    test('History table sorting by Posting Date matches API data', async () => {
        const apiRows = await getApiRows();
        const apiDates = apiRows.map((row) => row.postingDate);
        test.skip(new Set(apiDates).size < 2, 'All Posting Dates are the same, sorting cannot be verified');

        // Expected orders come from the API data (dates compared as dates, not text)
        const asc = [...apiDates].sort((a, b) => toTime(a) - toTime(b));
        const desc = [...asc].reverse();

        const readDirection = async () =>
            directionOf((await historyPage.getTableRecords()).map((row) => row.postingDate), asc, desc);

        // 1st click: UI must be sorted exactly like the API dates (asc or desc)
        await historyPage.sortBy('Posting Date');
        await historyPage.page.waitForTimeout(500); // let the table re-sort before reading
        await expect
            .poll(readDirection, {
                timeout: 15000,
                message: 'After the 1st click the Posting Date order should match the API dates sorted'
            })
            .not.toBe('none');
        const firstDirection = await readDirection();

        // 2nd click: the order must flip
        await historyPage.sortBy('Posting Date');
        await expect
            .poll(readDirection, {
                timeout: 15000,
                message: 'After the 2nd click the Posting Date order should be reversed'
            })
            .toBe(firstDirection === 'asc' ? 'desc' : 'asc');
    });

    test('History table search filter matches API data', async () => {
        const apiRows = await getApiRows();

        // Pick a description that appears more than once, so the filter returns a subset
        const counts = {};
        apiRows.forEach((row) => {
            counts[row.description] = (counts[row.description] || 0) + 1;
        });
        const term =
            Object.keys(counts).find((d) => counts[d] > 1 && counts[d] < apiRows.length) ??
            apiRows[0].description;

        const expected = apiRows.filter((row) =>
            Object.values(row).some((value) => value.toLowerCase().includes(term.toLowerCase()))
        );

        await historyPage.search(term);

        await expect
            .poll(async () => (await historyPage.getTableRecords()).sort(byKey), {
                timeout: 15000,
                message: `UI rows after searching "${term}" should match the filtered API data`
            })
            .toEqual(expected.sort(byKey));
        await expect(historyPage.recordCount).toHaveText(
            new RegExp(`Showing\\s+${expected.length}\\s+of`, 'i')
        );

        // Clearing the search brings every record back
        await historyPage.clearSearch();
        await expect
            .poll(async () => (await historyPage.getTableRecords()).length, {
                timeout: 15000,
                message: 'Clearing the search should show all records again'
            })
            .toBe(apiRows.length);
    });
});
