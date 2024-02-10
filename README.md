# Paramount+ Target Finder

This repository contains scripts for enhancing and scraping information from Paramount+ based on a CSV dataset.

## Prerequisites

- Node.js and Yarn installed
- Dependencies installed: `yarn`

## Usage

### Dataset Enhancement

1. Navigate to the project directory:

    ```bash
    cd <project-directory>
    ```

2. Install dependencies:

    ```bash
    yarn install
    ```

3. Run the enhancer:

    ```bash
    node enhance.js
    ```

4. The enhancer will read `raw.csv`, extract information from the 'URL' and 'Title' fields, add 'Season', 'Episode', and 'Show' columns, and generate `data.csv`.

### Paramount+ Scraper

1. Ensure the dataset is enhanced by running `enhance.js` as mentioned above.

2. Install dependencies (if not already installed):

    ```bash
    node play.js
    ```

3. The scraper will process the input CSV file (`data.csv`), search Paramount+ for each title, and generate an output CSV file (`output.csv`) with matched URLs.

## Configuration

### `enhance.js`

- Input CSV file: `raw.csv`
- Output CSV file: `output2.csv`

### `play.js`

- The input CSV file is assumed to have columns: `URL`, `Title`, `Season`, `Episode`, and `Show`.
- Constants like `SEARCH_URL`, `SHOWS_URL`, `BRAND_FALLBACK`, `DATA_CSV`, and `RESULT_CSV` can be adjusted based on the specific use case.

## Credits

- Playwright: [https://playwright.dev/](https://playwright.dev/)
- string-similarity: [https://www.npmjs.com/package/string-similarity](https://www.npmjs.com/package/string-similarity)
- chalk: [https://www.npmjs.com/package/chalk](https://www.npmjs.com/package/chalk)
- csvtojson: [https://www.npmjs.com/package/csvtojson](https://www.npmjs.com/package/csvtojson)
- json2csv: [https://www.npmjs.com/package/json2csv](https://www.npmjs.com/package/json2csv)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
