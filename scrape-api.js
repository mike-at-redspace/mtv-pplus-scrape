import { createReadStream, existsSync } from 'fs';
import fs from 'fs/promises';
import csv from 'csv-parser';
import { parseAsync } from 'json2csv';
import fetch from 'node-fetch';
import chalk from 'chalk';

class CSVProcessor {
    constructor(inputFilePath, outputFilePath) {
        this.inputFilePath = inputFilePath;
        this.outputFilePath = outputFilePath;
        this.processedUrls = new Set();
        this.outputRows = [];
        this.queue = [];
        this.processing = false;
    }

    extractShortId(url) {
        const segments = url.split('/');
        return segments[segments.length - 2];
    }

    async initialize() {
        this.outputRows = await this.loadOutputCSV();
    }

    async delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async processQueue() {
        if (this.processing || this.queue.length === 0) {
            return;
        }

        this.processing = true;
        const [url, shortId] = this.queue.shift();

        try {
            const updatedRow = await this.fetchData(shortId, url);
            this.outputRows.push(updatedRow);
            this.processedUrls.add(url);
            await this.writeOutputCSV(this.outputRows);
        } catch (error) {
            console.error(chalk.red(`Error fetching data for ${shortId}:`), error.message);
        } finally {
            this.processing = false;
            await this.delay(100);
            await this.processQueue();
        }
    }

    async processCSV() {
        if (!existsSync(this.inputFilePath)) {
            console.error(chalk.red('Input file does not exist!'));
            return;
        }

        await this.initialize();

        const readStream = createReadStream(this.inputFilePath);

        readStream
            .pipe(csv())
            .on('data', async (row) => {
                const url = row.URL;
                const shortId = this.extractShortId(url);
                if (!this.processedUrls.has(url)) {
                    this.queue.push([url, shortId]);
                    await this.processQueue();
                } else {
                    console.log(chalk.blue(`Data already fetched for ${shortId}`));
                }
            })
            .on('end', async () => {
                console.log(chalk.green('CSV file processing completed'));
            });
    }

    getSeasonAndEpisode = (title) => {
        let season = null;
        let episode = null;
        title = String(title);

        // Regular expressions to match season and episode
        const seasonRegex = /S(?:eason)?\s*(\d+)/i;
        const episodeRegex = /E(?:pisode)?\s*(\d+)/i;

        // Strip any whitespace from the title
        title = title.replace(/\s+/g, '');

        // Match the input string against the season regex
        let match = title.match(seasonRegex);
        if (match) {
            season = match[1];
        }

        // Match the input string against the episode regex
        match = title.match(episodeRegex);
        if (match) {
            episode = match[1];
        }

        return {
            season: season ? parseInt(season) : null,
            episode: episode ? parseInt(episode) : null
        };
    }

    async fetchData(shortId, url) {
        try {
            const data = await this.fetchDataFromApi(shortId);

            let title = data.item.title || data.item.shortTitle;
            let parentEntity = data.item.parentEntity || {};

            let hasEpisodeData = parseInt(data.item.episodeNumber) && parseInt(data.item.seasonNumber);

            if (!parentEntity.title) {
                // try and split by | and grab first part, fallback to data.item.shortTitle
                const parts = String(title).split('|');
                if (parts.length > 1) {
                    parentEntity.title = parts[0].trim();
                } else {
                    parentEntity.title = data.item.shortTitle;
                }
            }

            if (!hasEpisodeData) {
                const { season, episode } = this.getSeasonAndEpisode(title);
                hasEpisodeData = season && episode;
                if (hasEpisodeData) {
                    data.item.seasonNumber = season;
                    data.item.episodeNumber = episode;
                }
            }

            const updatedRow = {
                URL: url,
                Title: title,
                Show: parentEntity.title,
                Episode: hasEpisodeData ? parseInt(data.item.episodeNumber) : '',
                Season: hasEpisodeData ? parseInt(data.item.seasonNumber) : '',
            };

            if (hasEpisodeData) {
                console.log(chalk.green(`Data fetched for ${updatedRow.Show} (${shortId}) - S${updatedRow.Season} - E${updatedRow.Episode}`));
            } else {
                console.log(chalk.green(`Data fetched for ${updatedRow.Show} (${shortId})`));
            }
            return updatedRow;
        } catch (error) {
            throw error;
        }
    }

    async fetchDataFromApi(shortId) {
        const apiUrl = `https://neutron-api.paramount.tech/api/3.4/property?platform=web&brand=nickvideos&region=US&version=5&shortId=${shortId}&type=episode`;

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
        };

        const options = {
            method: 'GET',
            headers: headers,
            referrerPolicy: 'strict-origin-when-cross-origin',
        };

        try {
            const response = await fetch(apiUrl, options);

            if (!response.ok) {
                return {
                    item: {
                        title: response.status,
                        parentEntity: {},
                        episodeNumber: null,
                        seasonNumber: null,
                        shortTitle: 'Data not found'
                    }
                }
            }

            const jsonResponse = await response.json();

            return jsonResponse.data;
        } catch (error) {
            throw error;
        }
    }

    async loadOutputCSV() {
        try {
            if (existsSync(this.outputFilePath)) {
                const readStream = createReadStream(this.outputFilePath);
                const rows = [];

                readStream
                    .pipe(csv())
                    .on('data', (row) => {
                        rows.push(row);
                        this.processedUrls.add(row.URL);
                    })
                    .on('error', (error) => {
                        console.error(chalk.red('Error reading output CSV file:'), error);
                    });

                return new Promise((resolve) => {
                    readStream.on('end', () => resolve(rows));
                });
            } else {
                console.log(chalk.blue('Output CSV file does not exist, creating a new one'));
                return [];
            }
        } catch (error) {
            console.error(chalk.red('Error loading output CSV file:'), error);
            throw error;
        }
    }

    async writeOutputCSV(rows) {
        try {
            const csvData = await parseAsync(rows, { header: true });
            await fs.writeFile(this.outputFilePath, csvData);
        } catch (error) {
            console.error(chalk.red('Error writing to output CSV:'), error);
            throw error;
        }
    }
}

const processor = new CSVProcessor('nick-epsiodes.csv', 'nick-output.csv');
processor.processCSV();
