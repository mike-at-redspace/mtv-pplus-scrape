import { chromium } from 'playwright'
import { createReadStream } from 'fs'
import fs from 'fs/promises'
import inquirer from 'inquirer'
import chalk from 'chalk'
import csv from 'csv-parser'
import { parseAsync } from 'json2csv'

class Crawler {
  browser = null
  context = null
  item = 0
  totalItems = 0
  history = []

  async initializeBrowser() {
    this.browser = await chromium.launch({ headless: false })
  }

  async closeBrowser() {
    if (this.browser) {
      await this.browser.close()
    }
  }

  async crawlAndExtract(page, url) {
    this.log(chalk.yellow(`Crawling: ${chalk.whiteBright.bold(url)}`))
    this.item++
    try {
      await page.goto(url)
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
      this.log(chalk.red(`Error crawling ${url}: ${error.message}`))
      this.history.push({ url })
      return null
    }
  }

  async crawlAllUrls(urls) {
    this.context = await this.browser.newContext()
    const page = await this.context.newPage()

    await page.setViewportSize({ width: 500, height: 900 })

    const crawledData = []
    this.totalItems = urls.length

    for (const url of urls) {
      if (this.history.find(match => match.url === url)) {
        this.log(chalk.yellow(`Skipping: ${chalk.whiteBright.bold(url)}`))
        continue
      }
      const data = await this.crawlAndExtract(page, url)
      if (data) {
        crawledData.push(data)
      }
    }

    await this.context.close()
    return crawledData
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
