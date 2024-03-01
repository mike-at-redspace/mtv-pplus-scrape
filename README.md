# Redirect Target Generator for Paramount+

This repository serves the purpose of generating redirect targets for a CSV list of URLs related to Paramount+.

## Usage

### `yarn get-video-data`
Crawls a CSV of URLs to video endpages, movies, specials, episodes, or clips and generates a CSV or rich metadata.

| Constant         | Description                                                  |
| ---------------- | ------------------------------------------------------------ |
| `MAX_RETRIES`    | Maximum number of retries                 |
| `MAX_SESSIONS`   | Maximum number of concurrent browser sessions for crawling   |


### `yarn get-pplus-urls`
Takes output from `get-video-data` and attempts to find the best match on P+ and generates a CSV of redirects for Akamai.

| Constant           | Description                                          |
| ------------------ | ---------------------------------------------------- |
| `SEARCH_URL`       | URL for searching on P+ to find the best match       |
| `SHOWS_URL`        | URL for fetching information about shows on P+       |
| `BRAND_FALLBACK`   | Fallback value for brand when not found on P+        |
| `MATCHES_CSV`      | CSV seed matches of permalinks to speed things up    |

---

## Credits

- [Playwright](https://playwright.dev/)
- [string-similarity](https://www.npmjs.com/package/string-similarity)
- [chalk](https://www.npmjs.com/package/chalk)
- [csvtojson](https://www.npmjs.com/package/csvtojson)
- [json2csv](https://www.npmjs.com/package/json2csv)

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
