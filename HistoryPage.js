// '/processor/getdata' does not match '/processor/nmgetdata' (Non-Monetary), so the two never mix
const GET_DATA = '/fact-ai-api/processor/getdata';

export class HistoryPage {
    constructor(page) {
        this.page = page;
        this.apiBodies = [];

        // Tabs are <a> elements (same as the Transactions tab)
        this.historyTab = page.locator('//a[text() = "History"]');

        // Smallest block that holds the table AND the Search box ("Showing N of N records")
        this.section = page
            .locator('div')
            .filter({ has: page.locator('#history-table') })
            .filter({ has: page.getByPlaceholder('Search') })
            .last();
        this.searchInput = this.section.getByPlaceholder('Search');
        this.recordCount = this.section.getByText(/Showing \d+ of \d+ records/);

        // div#history-table > table#nonfrozen_table (DevTools > Elements)
        this.table = page.locator('#history-table table');
        this.tableHeaders = this.table.locator('thead th');
        this.tableRows = this.table.locator('tbody tr');
    }

    // ---------- API side ----------

    // Call BEFORE login. Keeps every getdata response that contains history rows
    // (the first row and the other rows come from different calls).
    startApiCapture() {
        this.apiBodies = [];
        this.page.on('response', async (response) => {
            if (!response.url().includes(GET_DATA)) return;
            if (response.request().method() !== 'POST' || response.status() !== 200) return;
            try {
                const body = await response.json();
                const hasHistoryRows =
                    Array.isArray(body?.data) &&
                    body.data.some((item) => 'postingDate' in item && 'desc' in item);
                if (hasHistoryRows) this.apiBodies.push(body);
            } catch (error) {
                // not JSON, ignore
            }
        });
    }

    // All captured records, merged by sequenceNumber (same record from two calls = one record)
    getApiRecords() {
        const byId = new Map();
        for (const body of this.apiBodies) {
            for (const item of body.data) {
                if (!('postingDate' in item)) continue;
                const id = String(item.sequenceNumber ?? item.refNum ?? JSON.stringify(item));
                const record = byId.get(id) ?? {};
                for (const [key, value] of Object.entries(item)) {
                    const hasValue = value !== '' && value != null;
                    if (hasValue || !(key in record)) record[key] = value;
                }
                byId.set(id, record);
            }
        }
        return [...byId.values()];
    }

    // ---------- UI side ----------

    async openHistoryTab() {
        await this.historyTab.click();
        await this.tableRows.first().waitFor({ state: 'visible', timeout: 60000 });
    }

    // Reads "Showing 27 of 27 records" -> { shown: 27, total: 27 }
    async getRecordCounts() {
        const text = (await this.recordCount.innerText()).replace(/\s+/g, ' ').trim();
        const match = text.match(/Showing (\d+) of (\d+) records/i);
        if (!match) throw new Error(`Unexpected record count text: "${text}"`);
        return { shown: Number(match[1]), total: Number(match[2]) };
    }

    // Reads the table as objects, mapping columns by header text
    async getTableRecords() {
        await this.tableRows.first().waitFor({ state: 'visible', timeout: 60000 });

        return this.table.evaluate((table) => {
            const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

            const headers = [...table.querySelectorAll('thead th')].map((th) =>
                clean(th.innerText).toLowerCase()
            );
            const col = (text) => headers.findIndex((h) => h.includes(text));
            const idx = {
                postingDate: col('posting date'),
                description: col('description'),
                dataItem: col('data item'),
                oldValue: col('old value'),
                newValue: col('new')
            };
            if (Object.values(idx).includes(-1)) {
                throw new Error(`Unexpected table headers: ${headers.join(' | ')}`);
            }

            return [...table.querySelectorAll('tbody tr')].map((tr) => {
                const cells = [...tr.querySelectorAll('td')].map((td) => clean(td.innerText));
                return {
                    postingDate: cells[idx.postingDate] ?? '',
                    description: cells[idx.description] ?? '',
                    dataItem: cells[idx.dataItem] ?? '',
                    oldValue: cells[idx.oldValue] ?? '',
                    newValue: cells[idx.newValue] ?? ''
                };
            });
        });
    }

    // Clicks the sort toggle of a column header, e.g. sortBy('Posting Date')
    async sortBy(columnName) {
        await this.tableHeaders
            .filter({ hasText: columnName })
            .locator('[title="Toggle SortBy"]')
            .click();
    }

    async search(term) {
        await this.searchInput.fill(term);
    }

    async clearSearch() {
        await this.searchInput.fill('');
    }
}
