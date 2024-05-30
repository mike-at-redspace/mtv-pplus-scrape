import { chromium } from 'playwright';
import { createReadStream, existsSync } from 'fs';
import fs from 'fs/promises';
import csv from 'csv-parser';
import { parseAsync } from 'json2csv';
import chalk from 'chalk';

const csvFilePath = './cc-clips.csv';
const numTabs = 5;
const maxRetries = 3;

class Queue {
  constructor() {
    this.data = [];
  }

  enqueue(item) {
    this.data.push(item);
  }

  dequeue() {
    return this.data.shift();
  }

  isEmpty() {
    return this.data.length === 0;
  }
}

class Crawler {
  constructor() {
    this.currentItem = 0;
    this.totalItems = 0;
    this.startTime = Date.now();
  }

  logProgress(message, type = 'info') {
    const percentage = ((this.currentItem / this.totalItems) * 100).toFixed(2);
    const elapsedTime = (Date.now() - this.startTime) / 1000; // Calculate elapsed time in seconds
    const averageTimePerItem = elapsedTime / this.currentItem || 0; // Calculate average time per item
    const estimatedTotalTime = averageTimePerItem * this.totalItems; // Estimated total time
    const estimatedTimeRemaining = (estimatedTotalTime - elapsedTime).toFixed(2); // Calculate estimated time remaining
    
    const prefix = `${this.currentItem}/${this.totalItems} (${percentage}%): `;



    switch (type) {
      case 'info':
        console.log(chalk.green(`${prefix}${message} ${estimatedTimeRemaining}s`));
        break;
      case 'warning':
        console.log(chalk.yellow(`${prefix}${message} ${estimatedTimeRemaining}s`));
        break;
      case 'error':
        console.error(chalk.red(`${prefix}${message} ${estimatedTimeRemaining}s`));
        break;
      default:
        console.log(`${prefix}${message} ${estimatedTimeRemaining}s`);
        break;
    }
  }

  async crawlUrls() {
    try {
      if (!existsSync(csvFilePath)) {
        console.error(chalk.red('CSV file not found.'));
        return;
      }

      const urls = await this.readCsvFile(csvFilePath);
      await this.crawlUrlsInBatches(urls);
    } catch (error) {
      this.logProgress(`An error occurred: ${error}`, 'error');
    }
  }

  async readCsvFile(filePath) {
    const urls = [];
    await new Promise((resolve, reject) => {
      createReadStream(filePath)
        .pipe(csv())
        .on('data', (data) => {
          if (data.url) {
            urls.push(data);
            this.totalItems++;
          }
        })
        .on('end', () => resolve(urls))
        .on('error', (err) => reject(err));
    });
    return urls;
  }

  async processUrl(page, row) {
    let titleString = '';
    let retries = 0;

    const { url, title } = row;

    this.currentItem++;

    while (retries < maxRetries) {
      try {
        if (title) {
          this.logProgress(`title ${row.title} already found, skipping`, 'info');
          break;
        }

        await page.goto(url, { waitUntil: 'load' });

        // check if redirected
        const currentUrl = page.url();
        if (currentUrl.split('/').length !== url.split('/').length) {
          this.logProgress(`Redirected to ${currentUrl}`, 'warning');
          retries = maxRetries;
          break;
        }

        const metaTag = await page.waitForSelector('meta[property="search:parentTitle"]', { state: 'attached', timeout: 1000 });
        titleString = await metaTag.getAttribute('content');

        if (titleString) {
          row.title = titleString;

          const playerMetadata = await page.$('[data-display-name="PlayerMetadata"] p:nth-child(3)');
          if (playerMetadata) {
            const text = await playerMetadata.innerText();
            const match = text.match(/Season (\d+) E (\d+)/i);
            if (match && match.length === 3) {
              row.season = match[1];
              row.episode = match[2];
              this.logProgress(`title ${titleString} found Extracted season ${match[1]} and episode ${match[2]} from page`, 'info');
            }
          } else {
            this.logProgress(`title ${titleString} found`, 'info');
          }

          retries = maxRetries;
          break;
        }

        await page.waitForSelector('body');
        const pageTitle = await page.title();
        titleString = pageTitle.split(' | ')[0];
        this.logProgress(`Using fallback page title: ${titleString}`, 'warning');
        row.title = titleString;
        break;
      } catch (error) {
        this.logProgress(`Error visiting URL: ${url} - ${error}`, 'error');
        retries++;
        if (retries === maxRetries) {
          this.logProgress(`Max retries reached for URL: ${url} - no title extracted`, 'warning');
          break;
        }
      }
    }

    return row;
  }


  async crawlUrlsInBatches(rows) {
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const pageQueue = new Queue();

    // Initialize pages and enqueue them
    for (let i = 0; i < numTabs; i++) {
      const page = await context.newPage();
      pageQueue.enqueue({ page, index: i });
    }

    let currentIndex = 0;

    try {
      while (currentIndex < rows.length || !pageQueue.isEmpty()) {
        const batchSize = Math.min(numTabs, rows.length - currentIndex);
        const batchPromises = [];

        for (let i = 0; i < batchSize; i++) {
          const { page, index } = await pageQueue.dequeue();
          const url = rows[currentIndex + i];

          if (!url) {
            continue; // Skip if the URL is undefined or null
          }

          const updatedRow = await this.processUrl(page, url);
          rows[currentIndex + i] = updatedRow;

          batchPromises.push(updatedRow);
          pageQueue.enqueue({ page, index });
        }

        await Promise.all(batchPromises);

        await fs.writeFile(csvFilePath, await parseAsync(rows), 'utf8');
        currentIndex += batchSize;
      }
    } catch (error) {
      console.error(`Error processing URLs: ${error}`);
    } finally {
      // Close resources
      await context.close();
      await browser.close();
    }

    return rows;
  }

}

const crawler = new Crawler();
crawler.crawlUrls();
