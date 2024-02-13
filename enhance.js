import fs from 'fs';
import csv from 'csvtojson';
import { parseAsync, transforms } from 'json2csv';
import { promisify } from 'util';
import inquirer from 'inquirer';
import chalk from 'chalk';

const { flatten } = transforms;
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

async function addColumns(inputFile, outputFile) {
  try {
    const csvData = await readFileAsync(inputFile, 'utf8');
    const records = await parseCSV(csvData);

    for (const record of records) {
      const match = record['URL'].match(/season-(\d+)-ep-(\d+)/i);
      if (match) {
        record['Season'] = parseInt(match[1], 10);
        record['Episode'] = parseInt(match[2], 10);
      } else {
        record['Season'] = null;
        record['Episode'] = null;
      }

      // Extract show name before the first " - "
      const titleParts = record['Title'].split(' - ');
      record['Show'] = titleParts.length > 0 ? titleParts[0] : '';
    }

    const outputCSV = await stringify(records, {
      header: true,
      columns: ['URL', 'Title', 'Show', 'Season', 'Episode'],
    });
    await writeFileAsync(outputFile, outputCSV);
    console.log(
      chalk.greenBright(
        `Output CSV file generated: ${chalk.whiteBright.bold(outputFile)}`
      )
    );
  } catch (error) {
    console.error(chalk.red('Error:'), error);
  }
}

async function parseCSV(csvData) {
  const jsonArray = await csv().fromString(csvData);
  return jsonArray;
}

async function stringify(data, options) {
  return parseAsync(data, {
    ...options,
    transforms: [flatten(options.transforms)],
  });
}

async function runScript() {
  // CLI prompts for input and output file names
  const { inputFile, outputFile } = await inquirer.prompt([
    {
      type: 'input',
      name: 'inputFile',
      message: 'Enter the input file name:',
      default: 'raw.csv',
    },
    {
      type: 'input',
      name: 'outputFile',
      message: 'Enter the output file name:',
      default: 'data.csv',
    },
  ]);

  // Run the script with provided file names
  await addColumns(inputFile, outputFile);
}

// Run the script
runScript().catch((error) => {
  console.error(chalk.red('Error:'), error);
});
