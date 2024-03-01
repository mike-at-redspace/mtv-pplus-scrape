import { chromium } from 'playwright'
import { compareTwoStrings } from 'string-similarity'
import csv from 'csv-parser'
import chalk from 'chalk'
import inquirer from 'inquirer'
import { createReadStream, existsSync } from 'fs'
import * as fs from 'fs'

class Scraper {
  constructor() {
    this.FALLBACK_URL = 'https://www.paramountplus.com/brands/mtv/'
    this.SEARCH_URL = 'https://www.paramountplus.com/search/'
    this.SHOWS_URL = 'https://www.paramountplus.com/shows/'
    this.DATA_CSV = 'titled-epsiodes.csv'
    this.RESULT_CSV = 'epsiodes-redirects.csv'
    this.MATCHES_CSV = 'matches.csv'
    this.MIN_CONFIDENCE = 0.58
    this.MIN_SEARCH_LENGTH = 3

    this.browser = null
    this.page = null
    this.notFoundList = []
    this.missingShows = []
    this.matchesList = []
    this.currentRow = null
    this.totalRows = 0
    this.completedRows = 0
    this.lastLog = ''
  }

  closeBrowser = async () => await this.browser.close()

  slugify = searchTerm =>
    searchTerm
      .split(' - ')[0]
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()

  findBestMatch = (searchTerm, urlList) => {
    const normalizedInput = this.slugify(searchTerm)
    const bestMatch = urlList.reduce(
      (best, url) => {
        const normalizedUrl = url
          .toLowerCase()
          .replace(this.SHOWS_URL, '')
          .replace(/\/$/, '')
        const score = compareTwoStrings(normalizedInput, normalizedUrl)
        return score > this.MIN_CONFIDENCE && score > best.score
          ? { url, score }
          : best
      },
      { score: 0 }
    )

    if (bestMatch.score > 0) {
      this.matchesList.push({ searchTerm, bestMatch: bestMatch.url })
      this.log(
        chalk.greenBright(
          `Best match for ${chalk.white.bold(searchTerm)} is ${chalk.white.bold(bestMatch.url)} with a score of ${chalk.white.bold(Math.round(bestMatch.score * 100))}%`
        )
      )
    }

    return bestMatch.url
  }

  scrape = async () => {
    try {
      const data = await this.readCSV(this.DATA_CSV)
      this.totalRows = data.length

      for (let i = 0; i < data.length; i++) {
        const row = data[i]
        this.currentRow = row
        await this.processRow()
        this.completedRows = i + 1
      }
    } catch ({ message }) {
      const error = message.split('\n')?.[0] ?? message
      console.error('Error during scraping:', error)
    }
  }

  processRow = async () => {
    const { Show } = this.currentRow
    const searchTerm = Show?.replace(/\s+/g, ' ')

    if (!this.notFoundList.includes(searchTerm)) {
      const existingMatch = this.findExistingMatch(searchTerm)
      if (existingMatch) {
        await this.handleExistingMatch(existingMatch)
      } else {
        await this.searchProperty(searchTerm)
      }
    } else {
      this.handleBrandFallback(searchTerm)
    }
  }

  handleBrandFallback = searchTerm => {
    this.log(
      chalk.magentaBright(
        `Skipped ${chalk.white.bold(searchTerm)} as it was not found previously`
      )
    )
    const { Title, Season, Episode, URL } = this.currentRow
    this.writeOutput(Title, searchTerm, Season, Episode, URL, this.FALLBACK_URL)
  }

  findExistingMatch = searchTerm =>
    this.matchesList.find(match => match.searchTerm === searchTerm)

  handleExistingMatch = async ({ bestMatch, searchTerm }) => {
    const { Title, Season, Episode, URL } = this.currentRow
    if (bestMatch.includes?.('/video/')) {
      this.log(
        chalk.greenBright(
          `Identified video link for ${chalk.white.bold(searchTerm)}: ${chalk.white.bold(bestMatch)}`
        )
      )
      this.writeOutput(Title, searchTerm, Season, Episode, URL, bestMatch)
    } else {
      this.writeOutput(Title, searchTerm, Season, Episode, URL, bestMatch)
      await this.findEpisodeTarget(bestMatch)
    }
  }

  isErrorPage = async () => {
    const pageTitle = await this.page.title()
    return pageTitle.includes('404') || pageTitle.includes('Error')
  }

  searchProperty = async searchTerm => {
    this.log(
      chalk.blueBright(
        `Searching Paramount+ for: ${chalk.white.bold(searchTerm)}`
      )
    )

    await this.page.goto(this.SEARCH_URL)
    const bestMatch = await this.performSearch(searchTerm)
    const { Title, Season, Episode, URL } = this.currentRow

    if (!bestMatch) {
      this.log(
        chalk.red(`No optimal match found for ${chalk.white.bold(Title)}`)
      )
      this.writeOutput(
        Title,
        searchTerm,
        Season,
        Episode,
        URL,
        this.FALLBACK_URL
      )
      this.notFoundList.push(searchTerm)
    } else {
      this.log(
        chalk.greenBright(
          `Already processed ${chalk.white.bold(searchTerm)} checking for episodes`
        )
      )
      this.writeOutput(Title, searchTerm, Season, Episode, URL, bestMatch)
      await this.findEpisodeTarget(bestMatch)
    }
  }

  performSearch = async searchTerm => {
    let bestMatch = null
    await this.page.type('input[name="q"]', '')

    for (let i = 0; i < searchTerm.length; i++) {
      const char = searchTerm[i]
      await this.page.type('input[name="q"]', char)
      await this.page.waitForTimeout(600) // P+ keyup debounce is 500ms

      const hrefs = await this.page.$$eval(
        '[data-ci="search-results"] a',
        results =>
          results
            .map(result => result.href)
            // we only care about shows
            .filter(href => href.includes('/shows/'))
      )

      if (i > this.MIN_SEARCH_LENGTH && !hrefs[0]) {
        this.log(
          chalk.red(
            `No search results found after ${chalk.whiteBright.bold(i)} characters`
          )
        )
        i = searchTerm.length
        this.notFoundList.push(searchTerm)
        continue
      }

      bestMatch = this.findBestMatch(searchTerm, hrefs)

      if (bestMatch) {
        this.matchesList.push({ searchTerm, bestMatch })
        break
      }
    }
    return bestMatch
  }

  gotoSeason = async seasonUrl => {
    if (this.page.url().trim() !== seasonUrl.trim()) {
      this.log(
        chalk.magenta(`Identified season link: ${chalk.white.bold(seasonUrl)}`)
      )
      return await this.page
        .goto(seasonUrl, { waitUntil: 'domcontentloaded' })
        .catch(error => {
          console.error('Error during seasons navigation:', error)
        })
    }
  }

  findEpisodeTarget = async bestMatch => {
    const { URL, Title, Episode, Season, Show } = this.currentRow
    if (!Episode || !Season || !bestMatch) {
      if (bestMatch) {
        this.writeOutput(Title, Show, Season, Episode, URL, bestMatch)
      }
      return
    }

    const seasonUrl = `${bestMatch}episodes/${Season}/`
    if (this.notFoundList.includes(seasonUrl)) {
      this.log(
        chalk.magentaBright(
          `Skipped ${chalk.white.bold(seasonUrl)} as it was not found previously`
        )
      )
      return
    }
    await this.gotoSeason(seasonUrl)

    if (await this.isErrorPage()) {
      this.notFoundList.push(seasonUrl)
      this.log(
        chalk.red(`Error page found for ${chalk.whiteBright.bold(seasonUrl)}`)
      )
      return
    }

    const stringToFind = `E${Episode}`

    try {
      await this.page.waitForSelector('.episode .epNum', { timeout: 600 })
      const episodes = await this.page.$$('.episode .epNum')

      for (const episodeHandle of episodes) {
        const text = await episodeHandle.innerText()

        if (text === stringToFind) {
          const episodeLink = await this.getEpisodeHref(episodeHandle)

          if (episodeLink) {
            this.log(
              chalk.greenBright(
                `Identified episode link for ${chalk.white.bold(stringToFind)}: ${chalk.white.bold(episodeLink)}`
              )
            )

            const { Title, Show, Season, URL } = this.currentRow
            this.writeOutput(Title, Show, Season, Episode, URL, episodeLink)
            break
          }
        }
      }
    } catch ({ message }) {
      const error = message.split('\n')?.[0] ?? message
      this.log(
        chalk.red(
          `Error finding and processing episode: ${chalk.whiteBright.bold(error)}`
        )
      )
    }
  }

  getEpisodeHref = async episodeHandle => {
    return await episodeHandle.evaluate(element => {
      const findClosestEpisodeParent = el => {
        while (el && !el.classList.contains('episode')) {
          el = el.parentElement
        }
        return el
      }

      const closestEpisodeParent = findClosestEpisodeParent(element)

      if (closestEpisodeParent) {
        const anchor = closestEpisodeParent.querySelector('a')
        return anchor ? anchor.getAttribute('href') : null
      }

      return null
    })
  }

  writeOutput = (Title, Show, Season, Episode, URL, target) => {
    fs.appendFileSync(
      this.RESULT_CSV,
      `"${Title}",${Show},${Season},${Episode},${URL},${target}\n`
    )
  }

  splashScreen = () =>
    createReadStream('pplus-logo.txt', { encoding: 'utf8' }).on('data', data =>
      console.log(chalk.bgRgb(1, 100, 255).bold(data))
    )

  getProgressBar = () => {
    const progressBarWidth = 20
    const progress =
      this.totalRows > 0
        ? Math.floor((this.completedRows / this.totalRows) * 100)
        : 0
    const percentageString = `${this.completedRows}/${this.totalRows} ${progress}%`
    const padLength = Math.max(
      0,
      Math.ceil((progressBarWidth - percentageString.length) / 2)
    )
    const padding = ' '.repeat(padLength)
    const progressString = `${padding}${percentageString}${' '.repeat(
      progressBarWidth - percentageString.length - padLength
    )}`
    const completedWidth = Math.floor((progress / 100) * progressBarWidth)
    const completeString = progressString.slice(0, completedWidth)
    const incompleteString = progressString.slice(completedWidth)
    const completePercentagePart = chalk.bgRgb(73, 215, 97).bold(completeString)
    const incompletePercentagePart = chalk
      .bgRgb(1, 100, 255)
      .bold(incompleteString)

    return `${completePercentagePart}${incompletePercentagePart}`
  }

  log = message => {
    const progressBar = this.getProgressBar()
    if (this.lastLog !== message) {
      console.log(`${progressBar} ${message}`)
      this.lastLog = message
    }
  }

  readCSV = async file => {
    const data = []
    return new Promise((resolve, reject) => {
      fs.createReadStream(file)
        .pipe(csv())
        .on('data', row => data.push(row))
        .on('end', () => resolve(data))
        .on('error', error => reject(error))
    })
  }

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

  initialize = async () => {
    console.clear()
    const isCSVFile = file => file.trim().toLowerCase().endsWith('.csv')
    const { inputFile, outputFile } = await inquirer.prompt([
      {
        type: 'input',
        name: 'inputFile',
        message: 'Enter the input file name:',
        default: this.DATA_CSV,
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
        message: 'Enter the output file name:',
        default: this.RESULT_CSV,
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
    this.DATA_CSV = inputFile
    this.RESULT_CSV = outputFile
    // uncomment for headless mode
    // this.browser = await chromium.launch()
    this.splashScreen()
    this.browser = await chromium.launch({ headless: false })
    this.page = await this.browser.newPage()

    // load existing matches to speed up the process
    try {
      const data = await this.readCSV(this.MATCHES_CSV)
      this.matchesList = data.map(row => ({
        searchTerm: row.item,
        bestMatch: row.url
      }))
    } catch (error) {
      console.error('Error reading matches list:', error)
    }
  }
}

// IIFE
;(async () => {
  const scraper = new Scraper()
  try {
    await scraper.initialize()
    await scraper.scrape()
  } catch (error) {
    console.error(chalk.red('Error during scraping:'), error)
  } finally {
    await scraper.closeBrowser()
  }
})()
