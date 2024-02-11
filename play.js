import { chromium } from 'playwright'
import stringSimilarity from 'string-similarity'
import csv from 'csv-parser'
import chalk from 'chalk'
import * as fs from 'fs'

class Scraper {
  constructor() {
    this.notFoundList = []
    this.matchesList = []
    this.browser = null
    this.page = null
    this.SEARCH_URL = 'https://www.paramountplus.com/search/'
    this.SHOWS_URL = 'https://www.paramountplus.com/shows/'
    this.BRAND_FALLBACK = 'https://www.paramountplus.com/brands/mtv/'
    this.DATA_CSV = 'data.csv'
    this.RESULT_CSV = 'output.csv'
  }

  initialize = async () => {
    console.clear()
    this.browser = await chromium.launch()
    this.page = await this.browser.newPage()
  }

  closeBrowser = async () => await this.browser.close()

  slugify = inputString =>
    inputString
      .split(' - ')[0]
      .toLowerCase()
      .replace(/[^a-z0-9 -]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim()

  findBestMatch(inputString, urlList, threshold = 0.6) {
    const normalizedInput = this.slugify(inputString)
    let bestMatch = null
    let highestScore = 0

    for (const url of urlList) {
      const normalizedUrl = url
        .toLowerCase()
        .replace(this.SHOWS_URL, '')
        .replace(/\/$/, '')

      const score = stringSimilarity.compareTwoStrings(
        normalizedInput,
        normalizedUrl
      )

      if (score > threshold && score > highestScore) {
        bestMatch = url
        highestScore = score
      }
    }

    if (bestMatch) {
      console.log(
        chalk.greenBright(
          `Best match for ${chalk.white.bold(inputString)} is ${chalk.white.bold(bestMatch)} with a score of ${chalk.white.bold(highestScore)}`
        )
      )
    }

    return bestMatch
  }

  scrape = async () => {
    try {
      const data = await this.readCSV(this.DATA_CSV)

      for (const row of data) {
        await this.processRow(row)
      }
    } catch (error) {
      console.error('Error during scraping:', error)
      // Handle errors here
    }
  }

  async processRow(row) {
    const { URL, Title, Season, Episode, Show } = row
    const searchTerm = Show.replace(/\s+/g, ' ')

    if (this.notFoundList.includes(searchTerm)) {
      this.handleBrandFallback(searchTerm, Title, Season, Episode, URL)
    } else {
      const existingMatch = this.findExistingMatch(searchTerm)

      if (existingMatch) {
        await this.handleExistingMatch(existingMatch, row)
      } else {
        await this.srearchForShowPage(searchTerm, {
          Title,
          Season,
          Episode,
          URL
        })
      }
    }
  }

  handleBrandFallback(searchTerm, Title, Season, Episode, URL) {
    console.log(
      chalk.magentaBright(
        `Skipped ${chalk.white.bold(searchTerm)} as it was not found previously`
      )
    )
    this.writeOutput(
      Title,
      searchTerm,
      Season,
      Episode,
      URL,
      this.BRAND_FALLBACK
    )
  }

  findExistingMatch(searchTerm) {
    return this.matchesList.find(match => match.searchTerm === searchTerm)
  }

  handleExistingMatch({ bestMatch, searchTerm }, row) {
    const { Title, Season, Episode, URL } = row
    this.writeOutput(Title, searchTerm, Season, Episode, URL, bestMatch)
    if (Season) {
      const seasonUrl = `${bestMatch}episodes/${Season}/`
      return this.navigateToSeason(seasonUrl)
    }
  }

  async srearchForShowPage(searchTerm, row) {
    console.log(
      chalk.blueBright(
        `Searching Paramount+ for: ${chalk.white.bold(searchTerm)}`
      )
    )

    await this.page.goto(this.SEARCH_URL)
    await this.performSearch(searchTerm)

    const bestMatch = this.findBestMatch(
      searchTerm,
      this.matchesList.map(match => match.bestMatch)
    )
    const { Title, Season, Episode, URL } = row
    if (!bestMatch) {
      console.log(
        chalk.red(`No optimal match found for ${chalk.white.bold(Title)}`)
      )

      this.writeOutput(
        Title,
        searchTerm,
        Season,
        Episode,
        URL,
        this.BRAND_FALLBACK
      )
    } else {
      console.log(
        chalk.greenBright(
          `Already processed ${chalk.white.bold(searchTerm)} checking for episodes`
        )
      )
      this.writeOutput(Title, searchTerm, Season, Episode, URL, bestMatch)

      if (Season) {
        const seasonUrl = `${bestMatch}episodes/${Season}/`
        this.findAndProcessEpisode(seasonUrl)
      }
    }
  }

  async performSearch(searchTerm) {
    await this.page.type('input[name="q"]', '')

    for (let i = 0; i < searchTerm.length; i++) {
      const char = searchTerm[i]
      await this.page.type('input[name="q"]', char)
      await this.page.waitForTimeout(600)

      const hrefs = await this.page.$$eval(
        '[data-ci="search-results"] a',
        results =>
          results
            .map(result => result.href)
            .filter(href => href.includes('/shows/'))
      )

      if (i && !hrefs[0]) {
        console.log(chalk.red(`No search results found after ${i} characters`))
        i = searchTerm.length
        this.notFoundList.push(searchTerm)
        continue
      }

      const bestMatch = this.findBestMatch(searchTerm, hrefs)

      if (bestMatch) {
        this.matchesList.push({ searchTerm, bestMatch })
        break
      }
    }
  }

  async navigateToSeason(seasonUrl) {
    if (!this.page.url().includes(seasonUrl)) {
      console.log(
        chalk.magenta(`Identified season link: ${chalk.white.bold(seasonUrl)}`)
      )
    }

    return await this.page
      .goto(seasonUrl, { waitUntil: 'domcontentloaded' })
      .catch(error => {
        console.error('Error during seasons navigation:', error)
      })
  }

  async findAndProcessEpisode(row) {
    const { Episode } = row
    if (Episode) {
      const stringToFind = `E${Episode}`
      const episodes = await this.page
        .waitForSelector('.episode .epNum', { timeout: 5000 })
        .then(() => this.page.$$('.episode .epNum'))

      for (const episodeHandle of episodes) {
        const text = await episodeHandle.innerText()

        if (text === stringToFind) {
          console.log(
            chalk.greenBright(`Found episode: ${chalk.whiteBright.bold(text)}`)
          )

          const episodeLink = await this.getEpisodeLink(episodeHandle)

          if (episodeLink) {
            console.log(
              chalk.greenBright(
                `Identified episode link: ${chalk.white.bold(episodeLink)}`
              )
            )
            const { Title, Show, Season, URL } = row
            this.writeOutput(Title, Show, Season, Episode, URL, episodeLink)
            break
          }
        }
      }
    }
  }

  async getEpisodeLink(episodeHandle) {
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

  writeOutput(Title, Show, Season, Episode, URL, target) {
    fs.appendFileSync(
      this.RESULT_CSV,
      `"${Title}",${Show},${Season},${Episode},${URL},${target}\n`
    )
  }

  async readCSV(filePath) {
    const data = []
    return new Promise((resolve, reject) => {
      fs.createReadStream(filePath)
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
