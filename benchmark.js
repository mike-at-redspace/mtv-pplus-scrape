import { chromium } from "playwright";

const domains = [
    "bet-com-10172-webplex-app.webplex.vmn.io",
    "bet-com-10072-webplex-app.webplex.vmn.io",
];
const paths = [
    "/",
    "/photo-gallery/ejhoo1/2024-naacp-image-awards-keke-palmer-s-diverse-red-carpet-hairstyles/pf45x0",
    "/article/lmzxs1/ye-accused-of-discriminating-against-black-employees",
];
const numTestsPerTab = 5;
const cooldownTime = 50;
const maxRetries = 3;
const resetCacheFrequency = 5;

const measureTTFB = async (page, url) => {
    await page.goto(url);
    const performanceTiming = JSON.parse(
        await page.evaluate(() => JSON.stringify(window.performance.timing)),
    );
    return performanceTiming.responseStart - performanceTiming.requestStart;
};

const retryNavigate = async (page, url, retries = 0, resetCache) => {
    try {
        if (resetCache) {
            url += "?resetCache=true";
        }
        // console.log(`Navigating to ${url}`);
        const ttfb = await measureTTFB(page, url);
        return ttfb;
    } catch (error) {
        if (retries < maxRetries) {
            console.error(`Error navigating to ${url}: ${error}`);
            console.warn(
                `Retrying navigation to ${url} (${retries + 1}/${maxRetries})`,
            );
            await new Promise((resolve) => setTimeout(resolve, 900)); // Wait 900ms before retrying
            await retryNavigate(page, url, retries + 1, resetCache);
        } else {
            console.error(`Maximum retries (${maxRetries}) exceeded for ${url}`);
            throw error;
        }
    }
};

const benchmarkPaths = async () => {
    const results = {};
    let currentTest = 0;

    const browser = await chromium.launch();

    for (const domain of domains) {
        const context = await browser.newContext({
            httpCredentials: { username: "dutton", password: "daybreak11" },
        });
        results[domain] = {};

        const pages = [];
        const numPages = 5; // Adjust this value to change the number of tabs/pages

        for (let i = 0; i < numPages; i++) {
            pages.push(await context.newPage());
        }

        const pathsPerPage = Math.ceil(paths.length / numPages);

        const pagePromises = pages.map(async (page, pageIndex) => {
            const startIndex = pageIndex * pathsPerPage;
            const endIndex = Math.min(startIndex + pathsPerPage, paths.length);
            const pagePaths = paths.slice(startIndex, endIndex);

            for (const path of pagePaths) {
                results[domain][path] = [];

                for (let i = 0; i < numTestsPerTab; i++) {
                    let resetCache = false;
                    if (i % resetCacheFrequency === 0) {
                        resetCache = true;
                    }
                    const url = `https://${domain}${path}`;
                    const ttfb = await retryNavigate(page, url, 0, resetCache);
                    if (ttfb) {
                        const totalTests = numTestsPerTab * paths.length * domains.length;
                        currentTest++;
                        const percentComplete = Math.round((currentTest / totalTests) * 100);
                        console.log(
                            `https://${domain}${path} ${ttfb}ms - ${currentTest}/${totalTests} ${percentComplete}% complete`,
                        );
                        results[domain][path].push(ttfb);
                    }
                    await new Promise((resolve) => setTimeout(resolve, cooldownTime)); // Delay before starting the next test
                }
            }
        });

        await Promise.all(pagePromises);

        for (const page of pages) {
            await page.close();
        }
        await context.close();
    }

    await browser.close();

    return results;
};

const generateMarkdownTable = (results, domains, paths) => {
    const calculateAverageResponseTime = (domainTimes) => domainTimes.reduce((acc, val) => acc + val, 0) / domainTimes.length;

    const calculateDomainAverages = (results) => {
        const domainAverages = {};
        for (const path of paths) {
            domainAverages[path] = {};
            for (const domain of domains) {
                const domainTimes = results[domain][path];
                domainAverages[path][domain] = Math.round(calculateAverageResponseTime(domainTimes));
            }
        }
        return domainAverages;
    };

    const generateTableHeader = (domains, paths) => {
        let table = '| Test # | URI |';
        for (const domain of domains) {
            table += ` ${domain} (ms) | Average |`;
        }
        table += '\n| --- | --- |';
        for (let i = 0; i < domains.length * 2; i++) {
            table += ' --- |';
        }
        table += '\n';
        return table;
    };

    const generateDataRows = (results, paths, domains) => {
        let table = '';
        for (let i = 0; i < paths.length; i++) {
            const path = paths[i];
            let row = `| ${i + 1} | ${path} `;
            for (const domain of domains) {
                const domainTimes = results[domain][path];
                const averageResponseTime = calculateAverageResponseTime(domainTimes);
                row += `| ${domainTimes.join(', ')} | ${averageResponseTime} `;
            }
            table += row + '\n';
        }
        return table;
    };

    const generateDomainAverageRow = (domainAverages, domains) => {
        let table = '| Domain Average | |';
        for (const domain of domains) {
            const averageDomain = Math.round(calculateAverageResponseTime(Object.values(domainAverages).map((value) => value[domain])),2);
            table += ` | ${averageDomain} |`;
        }
        table += '\n';
        return table;
    };

    const domainAverages = calculateDomainAverages(results);
    const tableHeader = generateTableHeader(domains, paths);
    const dataRows = generateDataRows(results, paths, domains);
    const domainAverageRow = generateDomainAverageRow(domainAverages, domains);

    return `${tableHeader}${dataRows}${domainAverageRow}`;
};

(async () => {
    const results = await benchmarkPaths();
    const markdownTable = generateMarkdownTable(results, domains, paths);
    console.clear();
    console.log(markdownTable);
})();
