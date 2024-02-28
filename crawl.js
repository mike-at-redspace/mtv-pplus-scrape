import { chromium } from 'playwright'
import { parseAsync } from 'json2csv'
import fs from 'fs/promises'
import inquirer from 'inquirer'
import chalk from 'chalk'

const MAX_PAGES = 100
const searchQuery = 'site:www.tvland.com “Season” "Ep."'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const extractResults = async page => {
  return await page.$$eval('#search a:has(h3), #botstuff a:has(h3)', elements =>
    elements.map(element => {
      const title = element.querySelector('h3')?.innerText || ''
      const url = element.href || ''
      if (title.includes('More results') || title.includes('Try again')) {
        return null
      }
      return { title, url }
    })
  )
}

const hasMoreResults = async page => {
  return !!(await page.$('a[aria-label="More results"]'))
}

const hasOmittedResults = async page => {
  return !!(await page.$('a:has-text("omitted")'))
}

const saveToCSV = async (results, outputFile) => {
  const uniqueResults = results.filter(
    (result, index, self) =>
      index === self.findIndex(r => r?.url === result?.url)
  )

  const csvData = await parseAsync(uniqueResults, {
    header: true,
    columns: ['title', 'url']
  })

  await fs.writeFile(outputFile, csvData)
}

const scrapeGoogleSearchResults = async () => {
  try {
    // CLI prompt for the output file name
    const { outputFile } = await inquirer.prompt([
      {
        type: 'input',
        name: 'outputFile',
        message: 'Enter the output file name (default: raw.csv):',
        default: 'raw.csv'
      }
    ])

    const browser = await chromium.launch({ headless: false })
    const context = await browser.newContext()
    const page = await context.newPage()
    await page.goto(
      `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`
    )

    let results = await extractResults(page)
    let pageNumber = 1

    while ((await hasMoreResults(page)) || (await hasOmittedResults(page))) {
      try {
        const moreResultsButton = await page
          .waitForSelector('a[aria-label="More results"]', { timeout: 1000 })
          .catch(() => null)
        const omittedResultsButton = await page
          .waitForSelector('a:has-text("omitted")', { timeout: 1000 })
          .catch(() => null)

        if (moreResultsButton && pageNumber < MAX_PAGES) {
          await moreResultsButton.click()
          pageNumber++
        } else if (omittedResultsButton) {
          await omittedResultsButton.click()
          pageNumber = 0
        } else {
          break
        }

        await delay(100)
        await page.evaluate(() =>
          window.scrollTo(0, document.body.scrollHeight)
        )
      } catch {
        break
      }
      results = results.concat(await extractResults(page))
    }

    await saveToCSV(results, outputFile)
    console.log(
      chalk.greenBright(`Google Search Results saved to: ${outputFile}`)
    )
    await browser.close()
  } catch (error) {
    console.error('Error:', error)
  }
}

scrapeGoogleSearchResults().catch(error => {
  console.error('Error:', error)
})
