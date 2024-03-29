import { chromium } from 'playwright'
import { createReadStream, existsSync } from 'fs'
import fs from 'fs/promises'
import inquirer from 'inquirer'
import csv from 'csv-parser'
import { parseAsync } from 'json2csv'
import chalk from 'chalk'

class Crawler {
  constructor() {
    this.MAX_RETRIES = 3
    this.MAX_SESSIONS = 10
    this.browser = null
    this.contexts = []
    this.history = []
    this.retries = []
    this.errors = []
    this.currentItem = 0
    this.totalItems = 0
    this.lastLog = ''
  }

  initializeBrowser = async () => (this.browser = await chromium.launch())

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close()
    }
  }

  async promptUser() {
    const isCSVFile = filename => filename.trim().toLowerCase().endsWith('.csv')
    return await inquirer.prompt([
      {
        type: 'input',
        name: 'inputFile',
        message: 'Enter the input CSV file name:',
        default: 'raw-episodes.csv',
        validate: filename => {
          if (!isCSVFile(filename)) {
            return chalk.red('Please enter a valid input file name.')
          }
          if (!existsSync(filename)) {
            return chalk.red('The input file does not exist.')
          }
          return true
        }
      },
      {
        type: 'input',
        name: 'outputFile',
        message: 'Enter the output CSV file name:',
        default: 'titled-epsiodes.csv',
        validate: filename => {
          if (!isCSVFile(filename)) {
            return chalk.red('Please enter a valid output file name.')
          }
          if (existsSync(filename)) {
            return chalk.red(
              'The output file already exists. Please enter a different name.'
            )
          }
          return true
        }
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

  async extractSeasonEpisode(page) {
    // Regular expression to match "Season X, Ep. Y"
    const regex = /Season (\d+), Ep\. (\d+)/
    const pageTitle = await page.title()
    const match = pageTitle.match(regex)
    let Season, Episode
    if (match) {
      Season = parseInt(match[1], 10)
      Episode = parseInt(match[2], 10)
    }
    return { Season, Episode }
  }

  /**
   * Performs the crawling and data extraction. Navigates to the given URL,
   * checks for 404, 500 an other errors, and extracts the title from the page.
   * Retries up to MAX_RETRIES in case of errors before logging the error and moving on.
   *
   * @param {Page} page - The page object to use for crawling.
   * @param {string} URL - The URL to crawl.
   * @param {number} i - The index of the current session.
   * @returns {Promise<Object>} The extracted data from the page.
   */
  async crawlAndExtract(page, URL, i) {
    this.log(chalk.blueBright(`Crawling: ${chalk.white.bold(URL)}`))
    try {
      const shortId = URL.split('/').pop()
      this.retries[i]++
      await page
        .goto(URL, { timeout: 15000, waitUntil: 'domcontentloaded' })
        .catch(({ message }) => {
          if (message.includes('ERR_TOO_MANY_REDIRECTS')) {
            this.retries[i] = this.MAX_RETRIES
          }
          const error = message.split('\n')?.[0] ?? message
          throw new Error(error)
        })
      if (await this.is404Page(page)) {
        this.retries[i] = this.MAX_RETRIES
        throw new Error('404 Error')
      }
      if (await this.is500Page(page)) {
        throw new Error('500 Error')
      }
      const titleElement = await page.waitForSelector('.title-wrap > a > div', {
        timeout: 10000
      })
      const title = await titleElement.textContent()
      if (!title) {
        throw new Error('Title not found')
      }
      const { Season, Episode } = await this.extractSeasonEpisode(page)

      if (Season && Episode) {
        this.log(
          chalk.greenBright(
            `Episode data for ${chalk.white.bold(shortId)} found after ${chalk.white.bold(this.retries[i])} attempt${this.retries[i] > 1 ? 's' : ''}: ${chalk.white.bold(`${title} E${Episode} S${Season}`)}`
          )
        )
      } else {
        this.log(
          chalk.greenBright(
            `Show title for clip ${chalk.white.bold(shortId)} found after ${chalk.white.bold(this.retries[i])} attempt${this.retries[i] > 1 ? 's' : ''}: ${chalk.white.bold(title)}`
          )
        )
      }
      this.history.push({ URL, title })
      this.currentItem++

      return {
        Title: title,
        Show: title,
        URL,
        Episode,
        Season
      }
    } catch ({ message }) {
      const error = message.split('\n')?.[0] ?? message
      if (this.retries[i] < this.MAX_RETRIES) {
        this.log(
          chalk.yellow(
            `Retry ${this.retries[i]}/${this.MAX_RETRIES} for ${chalk.white.bold(URL)}: ${error}`
          )
        )
        return this.crawlAndExtract(page, URL, i)
      } else {
        this.log(chalk.red(`Error crawling ${chalk.white.bold(URL)}: ${error}`))
        this.history.push({ URL })
        this.errors.push({ URL, error: error })
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

    // Create a single browser context
    const context = await this.browser.newContext()

    // Generate the queue as before
    const queueGenerator = this.generateQueue(urls)

    // Process the queue with multiple pages (tabs)
    const processingPromises = Array.from({ length: this.MAX_SESSIONS }).map(
      async () => {
        const page = await context.newPage({ javaScriptEnabled: false })
        await page.setViewportSize({ width: 500, height: 900 })

        for await (const { URL, index } of queueGenerator) {
          this.retries[index] = 0
          if (this.history.find(match => match.URL === URL)) {
            this.log(
              chalk.yellowBright(
                `Skipping: ${chalk.white.bold(URL)} (already crawled)`
              )
            )
            continue
          }

          const data = await this.crawlAndExtract(page, URL, index)

          if (data) {
            crawledData.push(data)
          }
        }

        await page.close()
      }
    )

    await Promise.all(processingPromises)

    // Close the context
    await context.close()

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
      yield { URL: urls[i], index: i % this.MAX_SESSIONS }
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

    for await (const { URL, index } of queueGenerator) {
      const page = await context.newPage({ javaScriptEnabled: false })
      await page.setViewportSize({ width: 500, height: 900 })

      this.retries[index] = 0
      if (this.history.find(match => match.URL === URL)) {
        this.log(
          chalk.yellowBright(
            `Skipping: ${chalk.white.bold(URL)} (already crawled)`
          )
        )
        await page.close()
        continue
      }

      const data = await this.crawlAndExtract(page, URL, index)
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
    const incompletePercentagePart = chalk.bgBlueBright.bold(incompleteString)

    return `${completePercentagePart}${incompletePercentagePart}`
  }

  log(message) {
    const progressBar = this.getProgressBar()
    if (this.lastLog !== message) {
      this.lastLog = message
      console.log(`${progressBar} ${message}`)
    }
  }

  splashScreen = async () =>
    createReadStream('webplex-logo.txt', { encoding: 'utf8' }).on(
      'data',
      data => console.log(chalk.blueBright.bold(data))
    )

  sortResults = records =>
    records.sort((a, b) => {
      if (a['Title'] < b['Title']) return -1
      if (a['Title'] > b['Title']) return 1
      if (parseInt(a['Season']) < parseInt(b['Season'])) return -1
      if (parseInt(a['Season']) > parseInt(b['Season'])) return 1
      if (parseInt(a['Episode']) < parseInt(b['Episode'])) return -1
      if (parseInt(a['Episode']) > parseInt(b['Episode'])) return 1
      return 0
    })

  async main() {
    console.clear()
    try {
      const { inputFile, outputFile } = await this.promptUser()
      await this.splashScreen()
      console.log('\n\n\n')
      await this.initializeBrowser()

      const parsedCsv = await this.readCSV(inputFile)
      const urls = parsedCsv.map(row => row.URL.trim())
      this.totalItems = urls.length

      const crawledData = await this.crawlAllUrls(urls)
      const sortedData = this.sortResults(crawledData)
      const csvOutput = await parseAsync(sortedData, {
        fields: ['URL', 'Title', 'Season', 'Episode', 'Show']
      })
      await fs.writeFile(outputFile, csvOutput)
      this.log(
        chalk.greenBright(
          `Crawling and extraction complete. Output saved to ${chalk.white.bold(outputFile)}`
        )
      )
      if (this.errors.length > 0) {
        const errorCount = this.errors.length
        const errorLogFile = outputFile.replace('.csv', '-error-log.csv')
        const errorLog = await parseAsync(this.errors, {
          fields: ['URL', 'error']
        })
        await fs.writeFile(errorLogFile, errorLog)
        this.log(
          chalk.redBright(
            `${chalk.white.bold(errorCount)} Error${errorCount > 1 ? 's' : ''} found. Error log saved to ${chalk.white.bold(errorLogFile)}`
          )
        )
      }
    } catch (error) {
      console.error(chalk.red(`Error: ${error.message}`))
    } finally {
      await this.closeBrowser()
    }
  }
}

const crawler = new Crawler()
crawler.main()
