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






export class NonMonitoringTable {
    constructor(page) {
        this.page = page;
        // \s* because the text may be split across two elements with no space between them
        this.sectionHeading = page.getByText(/Non-Monetary\s*\(Last \d+ Days?\)/i);
        // The table sits inside div#nonmonetary-table (DevTools > Elements)
        this.nonMonetarytable = page.locator('#nonmonetary-table table');
        this.tableHeaders = this.nonMonetarytable.locator('thead th');
        this.tableRows = this.nonMonetarytable.locator('tbody tr');
    }

    // Clicks the sort toggle of a column header, e.g. sortBy('Account') or sortBy('Date')
    async sortBy(columnName) {
        await this.tableHeaders
            .filter({ hasText: columnName })
            .locator('[title="Toggle SortBy"]')
            .click();
    }

    async getTableRecords() {
        // Wait for the table rows (id seen in DevTools) instead of the heading text
        await this.tableRows.first().waitFor({ state: 'visible', timeout: 60000 });

        const rows = await this.tableRows.all();
        const records = [];

        for (const row of rows) {
            const cells = row.locator('td');
            records.push({
                accountNumber: (await cells.nth(0).innerText()).trim(),
                date: (await cells.nth(1).innerText()).trim(),
                description: (await cells.nth(2).innerText()).trim()
            });
        }
        return records;
    }
}



