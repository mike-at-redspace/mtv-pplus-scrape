import fs from 'fs'
import csv from 'csvtojson'
import { parseAsync, transforms } from 'json2csv'
import { promisify } from 'util'
import chalk from 'chalk'

const { flatten } = transforms
const readFileAsync = promisify(fs.readFile)
const writeFileAsync = promisify(fs.writeFile)

async function addColumns() {
  try {
    const csvData = await readFileAsync('raw.csv', 'utf8')
    const records = await parseCSV(csvData)

    for (const record of records) {
      const match = record['URL'].match(/season-(\d+)-ep-(\d+)/i)
      if (match) {
        record['Season'] = parseInt(match[1], 10)
        record['Episode'] = parseInt(match[2], 10)
      } else {
        record['Season'] = null
        record['Episode'] = null
      }

      // Extract show name before the first " - "
      const titleParts = record['Title'].split(' - ')
      record['Show'] = titleParts.length > 0 ? titleParts[0] : ''
    }

    const outputCSV = await stringify(records, {
      header: true,
      columns: ['URL', 'Title', 'Show', 'Season', 'Episode']
    })
    await writeFileAsync('data.csv', outputCSV)
    console.log(
      chalk.greenBright(
        `Output CSV file generated: ${chalk.whiteBright.bold('data.csv')} run ${chalk.whiteBright.bold('play.js')} to start scraping the target urls`
      )
    )
  } catch (error) {
    console.error(chalk.red('Error:'), error)
  }
}

async function parseCSV(csvData) {
  const jsonArray = await csv().fromString(csvData)
  return jsonArray
}

async function stringify(data, options) {
  return parseAsync(data, {
    ...options,
    transforms: [flatten(options.transforms)]
  })
}

addColumns()
