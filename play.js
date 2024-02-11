import { chromium } from 'playwright'
import { compareTwoStrings } from 'string-similarity'
import csv from 'csv-parser'
import chalk from 'chalk'
import * as fs from 'fs'

class Scraper {
  constructor() {
    // constants
    this.FALLBACK_URL = 'https://www.paramountplus.com/brands/mtv/'
    this.SEARCH_URL = 'https://www.paramountplus.com/search/'
    this.SHOWS_URL = 'https://www.paramountplus.com/shows/'
    this.DATA_CSV = 'data.csv'
    this.RESULT_CSV = 'output.csv'
    this.MIN_CONFIDENCE = 0.6
    this.MIN_SEARCH_LENGTH = 3

    // instance variables
    this.browser = null
    this.page = null
    this.notFoundList = []
    this.matchesList = []
    this.currentRow = null
    this.progress = '0%'
  }

  initialize = async () => {
    console.clear()
    // uncomment for headless mode
    // this.browser = await chromium.launch({ headless: false })
    this.browser = await chromium.launch()
    this.page = await this.browser.newPage()
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
    let bestMatch = null
    let highestScore = 0

    for (const url of urlList) {
      const normalizedUrl = url
        .toLowerCase()
        .replace(this.SHOWS_URL, '')
        .replace(/\/$/, '')

      const score = compareTwoStrings(normalizedInput, normalizedUrl)

      if (score > this.MIN_CONFIDENCE && score > highestScore) {
        bestMatch = url
        highestScore = score
      }
    }

    if (bestMatch) {
      this.matchesList.push({ searchTerm, bestMatch })
      this.log(
        chalk.greenBright(
          `Best match for ${chalk.white.bold(searchTerm)} is ${chalk.white.bold(bestMatch)} with a score of ${chalk.white.bold(highestScore)}`
        )
      )
    }

    return bestMatch
  }

  scrape = async () => {
    try {
      const data = await this.readCSV()

      for (let i = 0; i < data.length; i++) {
        const row = data[i]
        this.currentRow = row
        await this.processRow()
        this.progress = `${Math.round(((i + 1) / data.length) * 100)}%`
      }
    } catch (error) {
      console.error('Error during scraping:', error)
    }
  }

  processRow = async () => {
    const { Show } = this.currentRow
    const searchTerm = Show.replace(/\s+/g, ' ')

    if (this.notFoundList.includes(searchTerm)) {
      this.handleBrandFallback(searchTerm)
    } else {
      const existingMatch = this.findExistingMatch(searchTerm)

      if (existingMatch) {
        await this.handleExistingMatch(existingMatch)
      } else {
        await this.searchProperty(searchTerm)
      }
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
    this.writeOutput(Title, searchTerm, Season, Episode, URL, bestMatch)
    if (Season) {
      const seasonUrl = `${bestMatch}episodes/${Season}/`
      return await this.gotoSeason(seasonUrl)
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
    } else {
      this.log(
        chalk.greenBright(
          `Already processed ${chalk.white.bold(searchTerm)} checking for episodes`
        )
      )
      this.writeOutput(Title, searchTerm, Season, Episode, URL, bestMatch)

      if (Season) {
        const seasonUrl = `${bestMatch}episodes/${Season}/`
        await this.gotoSeason(seasonUrl)
        if (!(await this.isErrorPage())) {
          await this.findEpisodeTarget()
        }
      }
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
    if (!this.page.url().includes(seasonUrl)) {
      this.log(
        chalk.magenta(`Identified season link: ${chalk.white.bold(seasonUrl)}`)
      )
    }

    return await this.page
      .goto(seasonUrl, { waitUntil: 'domcontentloaded' })
      .catch(error => {
        console.error('Error during seasons navigation:', error)
      })
  }

  findEpisodeTarget = async () => {
    const { Episode } = this.currentRow

    if (Episode) {
      const stringToFind = `E${Episode}`

      try {
        await this.page.waitForSelector('.episode .epNum', { timeout: 600 })
        const episodes = await this.page.$$('.episode .epNum')

        for (const episodeHandle of episodes) {
          const text = await episodeHandle.innerText()

          if (text === stringToFind) {
            this.log(
              chalk.greenBright(
                `Found episode: ${chalk.whiteBright.bold(text)}`
              )
            )

            const episodeLink = await this.getEpisodeHref(episodeHandle)

            if (episodeLink) {
              this.log(
                chalk.greenBright(
                  `Identified episode link: ${chalk.white.bold(episodeLink)}`
                )
              )

              const { Title, Show, Season, URL } = this.currentRow
              this.writeOutput(Title, Show, Season, Episode, URL, episodeLink)
              break
            }
          }
        }
      } catch (error) {
        this.log(
          chalk.red(
            `Error finding and processing episode: ${chalk.whiteBright.bold(error.message)}`
          )
        )
      }
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

  log = message =>
    console.log(`${chalk.bgBlue.bold(`[${this.progress}]`)} ${message}`)

  readCSV = async () => {
    const data = []
    return new Promise((resolve, reject) => {
      fs.createReadStream(this.DATA_CSV)
        .pipe(csv())
        .on('data', row => data.push(row))
        .on('end', () => resolve(data))
        .on('error', error => reject(error))
    })
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
