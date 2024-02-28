# Redirect Target Generator for Paramount+

This repository serves the purpose of generating redirect targets for a CSV list of URLs related to Paramount+. The process involves two primary Yarn tasks: `grab-clip-data` and `grab-season-data`. 

## Usage

1. Start by navigating to the project directory:

    ```bash
    cd <project-directory>
    ```

2. Install dependencies:

    ```bash
    yarn install
    ```

3. Run the tasks to prepare the data:

    - To grab clip data:

        ```bash
        yarn grab-clip-data
        ```

    - To grab season data:

        ```bash
        yarn grab-season-data
        ```

4. Once the data is ready, execute the following command to generate the redirect targets:

    ```bash
    yarn get-pplus-urls
    ```

5. **Profit!** The script will process the input CSV file, search Paramount+ for each title, and generate an output CSV file with matched URLs.

## Configuration

### `get-pplus-urls.js`

- The input CSV file is assumed to have columns: `URL`, `Title`, `Season`, `Episode`, and `Show`.
- Constants like `SEARCH_URL`, `SHOWS_URL`, `BRAND_FALLBACK`, `DATA_CSV`, `RESULT_CSV`, `MATCHES_CSV`, and `DEFAULT_CSV` can be adjusted based on the specific use case.
- See the included default `.csv` file for examples of the structure.
- `matches.csv` is included to speed up matching of movies, documentaries, or specials but is not required.

## Credits

- [Playwright](https://playwright.dev/)
- [string-similarity](https://www.npmjs.com/package/string-similarity)
- [chalk](https://www.npmjs.com/package/chalk)
- [csvtojson](https://www.npmjs.com/package/csvtojson)
- [json2csv](https://www.npmjs.com/package/json2csv)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
