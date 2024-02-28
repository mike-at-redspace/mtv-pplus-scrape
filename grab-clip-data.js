import { chromium } from 'playwright';
import { createReadStream } from 'fs';
import fs from 'fs/promises';
import inquirer from 'inquirer';
import chalk from 'chalk';
import csv from 'csv-parser';
import { parseAsync } from 'json2csv';

class Crawler {
  constructor() {
    this.browser = null;
    this.contexts = [];
    this.item = 0;
    this.totalItems = 0;
    this.history = [];
    this.retries = [];
    this.MAX_SESSIONS = 5;
  }

  async initializeBrowser() {
    this.browser = await chromium.launch();
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close();
    }
  }

  async is404Page(page) {
    const pageTitle = await page.title();
    return pageTitle.includes('Error 404');
  }

  async is500Page(page) {
    const pageTitle = await page.title();
    return pageTitle.includes('Server');
  }

  async crawlAndExtract(page, url, i) {
    this.log(`Crawling: ${url}`);
    this.item++;
    try {
      this.retries[i]++;
      await page.goto(url);
      if (await this.is404Page(page)) {
        this.retries[i] = 3;
        throw new Error('404 Error');
      }
      if (await this.is500Page(page)) {
        throw new Error('500 Error');
      }
      const titleElement = await page.waitForSelector('.title-wrap > a > div', {
        timeout: 600,
      });
      const title = await titleElement.textContent();
      if (!title) {
        throw new Error('Title not found');
      }
      this.log(`Title found: ${title}`);
      this.history.push({ url, title });
      return { Title: title, Show: title, URL: url };
    } catch (error) {
      if (this.retries[i] < 3) {
        this.log(`${error.message} Retrying (${this.retries[i]}/3) for: ${url}`);
        return this.crawlAndExtract(page, url, i);
      } else {
        this.log(`Error crawling ${url}: ${error.message}`);
        this.history.push({ url });
      }

      return null;
    }
  }

  async crawlAllUrls(urls) {
    const crawledData = [];

    for (let i = 0; i < this.MAX_SESSIONS; i++) {
      this.contexts[i] = await this.browser.newContext();
    }

    const queueGenerator = this.generateQueue(urls);

    const processingPromises = this.contexts.map(async context => {
      crawledData.push(...await this.processQueue(queueGenerator, context));
    });

    await Promise.all(processingPromises);

    for (let i = 0; i < this.MAX_SESSIONS; i++) {
      await this.contexts[i].close();
    }

    return crawledData;
  }

  async* generateQueue(urls) {
    for (let i = 0; i < urls.length; i++) {
      yield { url: urls[i], index: i % this.MAX_SESSIONS };
    }
  }

  async processQueue(queueGenerator, context) {
    const crawledData = [];

    for await (const { url, index } of queueGenerator) {
      const page = await context.newPage({ javaScriptEnabled: false });
      await page.setViewportSize({ width: 500, height: 900 });

      this.retries[index] = 0;
      if (this.history.find((match) => match.url === url)) {
        this.log(`Skipping: ${url}`);
        await page.close();
        continue;
      }

      const data = await this.crawlAndExtract(page, url, index);
      await page.close();

      if (data) {
        crawledData.push(data);
      }
    }

    return crawledData;
  }

  distributeUrls(urls) {
    this.totalItems = urls.length;
    const urlsPerBrowser = Array(this.MAX_SESSIONS).fill([]);
    urls.forEach((url, i) => {
      urlsPerBrowser[i % this.MAX_SESSIONS].push(url);
    });
    return urlsPerBrowser;
  }

  async readCSV(file) {
    const data = [];
    return new Promise((resolve, reject) => {
      createReadStream(file)
        .pipe(csv())
        .on('data', (row) => data.push(row))
        .on('end', () => resolve(data))
        .on('error', (error) => reject(error));
    });
  }

  async promptUser() {
    const questions = [
      {
        type: 'input',
        name: 'inputFile',
        message: 'Enter the input CSV file name:',
        default: 'clips.csv',
        validate: (value) => (value.trim() !== '' ? true : 'Please enter a valid input file name.'),
      },
      {
        type: 'input',
        name: 'outputFile',
        message: 'Enter the output CSV file name:',
        default: 'titled-clips.csv',
        validate: (value) => (value.trim() !== '' ? true : 'Please enter a valid output file name.'),
      },
    ];

    return await inquirer.prompt(questions);
  }

  log(message) {
    const percentage = this.totalItems > 0 ? Math.floor((this.item / this.totalItems) * 100) : 0;
    const status = chalk.bgRgb(0, 102, 219).bold(`${this.item}/${this.totalItems} ${percentage}%`);
    console.log(`${status}: ${message}`);
  }

  async main() {
    console.clear();
    try {
      const { inputFile, outputFile } = await this.promptUser();

      await this.initializeBrowser();

      const parsedCsv = await this.readCSV(inputFile);
      const urls = parsedCsv.map((row) => row.url.trim());
      this.totalItems = urls.length;

      const crawledData = await this.crawlAllUrls(urls);
      const csvOutput = await parseAsync(crawledData, {
        fields: ['URL', 'Title', 'Season', 'Episode', 'Show'],
      });
      await fs.writeFile(outputFile, csvOutput);
      this.log(`Crawling and extraction complete. Output saved to ${outputFile}`);
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`));
    } finally {
      await this.closeBrowser();
    }
  }
}

const crawler = new Crawler();
crawler.main();
