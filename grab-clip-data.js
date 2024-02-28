import { chromium } from 'playwright'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import inquirer from 'inquirer'
import chalk from 'chalk'
import csv from 'csv-parser'
import { parseAsync } from 'json2csv'

class Crawler {
  browsers = []
  contexts = []
  item = 0
  totalItems = 0
  history = []
  retries = 0
  MAX_SESSIONS = 10

  async initializeBrowser() {
    // Initialize MAX_SESSIONS browser instances
    for (let i = 0; i < this.MAX_SESSIONS; i++) {
      this.browsers[i] = await chromium.launch()
    }
  }

  async closeBrowser() {
    for (const browser of this.browsers) {
      if (browser) {
        await browser.close()
      }
    }
  }

  is404Page = async page => {
    const pageTitle = await page.title()
    return pageTitle.includes('Error 404')
  }

  is500Page = async page => {
    const pageTitle = await page.title()
    return pageTitle.includes('Server')
  }

  async crawlAndExtract(page, url) {
    this.log(chalk.yellow(`Crawling: ${chalk.whiteBright.bold(url)}`))
    this.item++
    try {
      this.retries++
      await page.goto(url)
      if (await this.is404Page(page)) {
        this.retries = 3
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
      this.log(
        chalk.greenBright(`Title found: ${chalk.whiteBright.bold(title)}`)
      )
      this.history.push({ url, title })
      return { Title: title, Show: title, URL: url }
    } catch (error) {
      if (this.retries < 3) {
        this.log(
          chalk.yellow(
            `${error.message} Retrying (${this.retries}/3) for: ${chalk.whiteBright.bold(url)}`
          )
        )
        return this.crawlAndExtract(page, url)
      } else {
        this.log(chalk.red(`Error crawling ${url}: ${error.message}`))
        this.history.push({ url })
      }

      return null
    }
  }

  async crawlAllUrls(urls) {
    const urlsPerBrowser = this.distributeUrls(urls)

    let crawledData = []
    for (let i = 0; i < this.browsers.length; i++) {
      this.contexts[i] = await this.browsers[i].newContext()
      const page = await this.contexts[i].newPage()
      await page.setViewportSize({ width: 500, height: 900 })

      for (const url of urlsPerBrowser[i]) {
        this.retries = 0
        if (this.history.find(match => match.url === url)) {
          this.log(chalk.yellow(`Skipping: ${chalk.whiteBright.bold(url)}`))
          continue
        }
        const data = await this.crawlAndExtract(page, url)
        if (data) {
          crawledData.push(data)
        }
      }

      await this.contexts[i].close()
    }

    return crawledData
  }

  distributeUrls(urls) {
    this.totalItems = urls.length
    const urlsPerBrowser = Array(this.browsers.length).fill([])
    for (let i = 0; i < urls.length; i++) {
      urlsPerBrowser[i % this.browsers.length].push(urls[i])
    }
    return urlsPerBrowser
  }

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

  async promptUser() {
    const questions = [
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
    ]

    return await inquirer.prompt(questions)
  }

  log(message) {
    const percentage = Math.floor((this.item / this.totalItems) * 100)
    const status = chalk
      .bgRgb(0, 102, 219)
      .bold(`${this.item}/${this.totalItems} ${percentage}%`)
    console.log(`${status}: ${message}`)
  }

  async main() {
    console.clear()
    try {
      const { inputFile, outputFile } = await this.promptUser()

      await this.initializeBrowser()

      const parsedCsv = await this.readCSV(inputFile)
      const urls = parsedCsv.map(row => row.url.trim())
      const crawledData = await this.crawlAllUrls(urls)
      const csvOutput = await parseAsync(crawledData, {
        fields: ['URL', 'Title', 'Season', 'Episode', 'Show']
      })
      await fs.writeFile(outputFile, csvOutput)
      this.log(
        chalk.green(
          `Crawling and extraction complete. Output saved to ${chalk.whiteBright.bold(outputFile)}`
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
