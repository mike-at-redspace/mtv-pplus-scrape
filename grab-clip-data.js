import { chromium } from 'playwright'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import inquirer from 'inquirer'
import csv from 'csv-parser'
import { parseAsync } from 'json2csv'
import chalk from 'chalk'

class Crawler {
  constructor() {
    this.MAX_RETRIES = 3
    this.MAX_SESSIONS = 5
    this.browser = null
    this.contexts = []
    this.history = []
    this.retries = []
    this.currentItem = 0
    this.totalItems = 0
  }

  async initializeBrowser() {
    this.browser = await chromium.launch()
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close()
    }
  }

  async promptUser() {
    return await inquirer.prompt([
      {
        type: 'input',
        name: 'inputFile',
        message: 'Enter the input CSV file name:',
        default: 'clips.csv',
        validate: value =>
          value.trim() !== '' ? true : 'Please enter a valid input file name.'
      },
      {
        type: 'input',
        name: 'outputFile',
        message: 'Enter the output CSV file name:',
        default: 'titled-clips.csv',
        validate: value =>
          value.trim() !== '' ? true : 'Please enter a valid output file name.'
      }
    ])
  }

  async is404Page(page) {
    const pageTitle = await page.title()
    return pageTitle.includes('Error 404')
  }

  async is500Page(page) {
    const pageTitle = await page.title()
    return pageTitle.includes('Server')
  }

  /**
   * Performs the crawling and data extraction. Navigates to the given URL,
   * checks for 404 and 500 errors, and extracts the title from the page.
   * Retries up to MAX_RETRIES in case of errors before logging the error and moving on.
   *
   * @param {Page} page - The page object to use for crawling.
   * @param {string} url - The URL to crawl.
   * @param {number} i - The index of the current session.
   * @returns {Promise<Object>} The extracted data from the page.
   */
  async crawlAndExtract(page, url, i) {
    this.log(chalk.blueBright(`Crawling: ${chalk.white.bold(url)}`))
    try {
      this.retries[i]++
      await page.goto(url)
      if (await this.is404Page(page)) {
        this.retries[i] = this.MAX_RETRIES
        throw new Error('404 Error')
      }
      if (await this.is500Page(page)) {
        throw new Error('500 Error')
      }
      const titleElement = await page.waitForSelector('.title-wrap > a > div', {
        timeout: 600
      })
      const title = await titleElement.textContent()
      if (!title) {
        throw new Error('Title not found')
      }
      this.log(chalk.greenBright(`Title found: ${chalk.white.bold(title)}`))
      this.history.push({ url, title })
      this.currentItem++
      return { Title: title, Show: title, URL: url }
    } catch (error) {
      if (this.retries[i] < this.MAX_RETRIES) {
        this.log(
          chalk.yellow(
            `${error.message} Retrying (${this.retries[i]}/${this.MAX_RETRIES}) for: ${chalk.white.bold(url)}`
          )
        )
        return this.crawlAndExtract(page, url, i)
      } else {
        this.log(
          chalk.red(`Error crawling ${chalk.white.bold(url)}: ${error.message}`)
        )
        this.history.push({ url })
        this.currentItem++
      }

      return null
    }
  }

  /**
   * Manages the crawling of all URLs. Creates new browser contexts,
   * generates a queue of URLs, processes the queue, and finally closes all contexts.
   *
   * @param {string[]} urls - The array of URLs to crawl.
   * @returns {Promise<Object[]>} - The extracted data from the pages.
   */
  async crawlAllUrls(urls) {
    const crawledData = []

    for (let i = 0; i < this.MAX_SESSIONS; i++) {
      this.contexts[i] = await this.browser.newContext()
    }

    const queueGenerator = this.generateQueue(urls)

    const processingPromises = this.contexts.map(async context => {
      crawledData.push(...(await this.processQueue(queueGenerator, context)))
    })

    await Promise.all(processingPromises)

    for (const context of this.contexts) {
      await context.close()
    }

    return crawledData
  }

  /**
   * Generates a queue of URLs to distribute among different sessions.
   *
   * @param {string[]} urls - The array of URLs to crawl.
   * @returns {Generator} - A generator that yields the URL and the index of the session.
   */
  async *generateQueue(urls) {
    for (let i = 0; i < urls.length; i++) {
      yield { url: urls[i], index: i % this.MAX_SESSIONS }
    }
  }

  /**
   * Processes the queue of URLs. Creates a new page for each URL,
   * checks if the URL has already been crawled, and if not, crawls and
   * extracts data from the page.
   *
   * @param {Generator} queueGenerator - The generator that yields the URL and the index of the session.
   * @param {BrowserContext} context - The browser context to use for crawling.
   * @returns {Promise<Object[]>} - The extracted data from the pages.
   */
  async processQueue(queueGenerator, context) {
    const crawledData = []

    for await (const { url, index } of queueGenerator) {
      const page = await context.newPage({ javaScriptEnabled: false })
      await page.setViewportSize({ width: 500, height: 900 })

      this.retries[index] = 0
      if (this.history.find(match => match.url === url)) {
        this.log(
          chalk.yellowBright(
            `Skipping: ${chalk.white.bold(url)} (already crawled)`
          )
        )
        await page.close()
        continue
      }

      const data = await this.crawlAndExtract(page, url, index)
      await page.close()

      if (data) {
        crawledData.push(data)
      }
    }

    return crawledData
  }

  /**
   * Reads data from a CSV file.
   *
   * @param {string} file - The file name to read.
   * @returns {Promise<Object[]>} - The data read from the CSV file.
   */
  async readCSV(file) {
    const data = []
    return new Promise((resolve, reject) => {
      createReadStream(file)
        .pipe(csv())
        .on('data', row => data.push(row))
        .on('end', () => resolve(data))
        .on('error', error => reject(error))
    })
  }

  getProgressBar = () => {
    const progressBarWidth = 20
    const progress =
      this.totalItems > 0
        ? Math.floor((this.currentItem / this.totalItems) * 100)
        : 0
    const percentageString = `${this.currentItem}/${this.totalItems} ${progress}%`
    const padLength = Math.max(
      0,
      Math.ceil((progressBarWidth - percentageString.length) / 2)
    )
    const padding = ' '.repeat(padLength)
    const progressString = `${padding}${percentageString}${' '.repeat(progressBarWidth - percentageString.length - padLength)}`
    const completedWidth = Math.floor((progress / 100) * progressBarWidth)
    const completeString = progressString.slice(0, completedWidth)
    const incompleteString = progressString.slice(completedWidth)
    const completePercentagePart = chalk.bgRgb(73, 215, 97).bold(completeString)
    const incompletePercentagePart = chalk
      .bgRgb(0, 102, 219)
      .bold(incompleteString)

    return `${completePercentagePart}${incompletePercentagePart}`
  }

  log(message) {
    const progressBar = this.getProgressBar()
    console.log(`${progressBar} ${message}`)
  }

  async main() {
    console.clear()
    try {
      const { inputFile, outputFile } = await this.promptUser()

      await this.initializeBrowser()

      const parsedCsv = await this.readCSV(inputFile)
      const urls = parsedCsv.map(row => row.url.trim())
      this.totalItems = urls.length

      const crawledData = await this.crawlAllUrls(urls)
      const csvOutput = await parseAsync(crawledData, {
        fields: ['URL', 'Title', 'Season', 'Episode', 'Show']
      })
      await fs.writeFile(outputFile, csvOutput)
      this.log(
        chalk.greenBright(
          `Crawling and extraction complete. Output saved to ${chalk.white.bold(outputFile)}`
        )
      )
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`))
    } finally {
      await this.closeBrowser()
    }
  }
}

const crawler = new Crawler()
crawler.main()
