import config from './config.js';
import moment from 'moment';
import 'moment-timezone';
import puppeteer from 'puppeteer';
import fs, { chownSync } from 'fs';
import { JSDOM } from 'jsdom';
import * as cheerio from 'cheerio';
import MD5 from "crypto-js/md5.js";
import unzipper from 'unzipper';
import path from 'path';
import fetch from 'node-fetch';
import AdmZip from 'adm-zip';
import { dirname } from 'path';
import { URL } from 'url';
import { fileURLToPath } from 'url';
import HttpsProxyAgent from 'https-proxy-agent';
import ProxyChain from 'proxy-chain';
import UserAgent from 'user-agents';

const __dirname = dirname(fileURLToPath(import.meta.url + '/..'));
const __filename = fileURLToPath(import.meta.url);

export default class Parser {
  postKeys = [];
  browser = null;
  page = null;
  totalHeight = 0;
  isScanning = true;

  constructor({ restartTime }) {
    this.restartTime = restartTime;

    this.start().catch((error) => {
      console.log(error);
    });
  }

  async waitForTimeout(time) {
    await new Promise((resolve) => setTimeout(resolve, time));
  }

  sanitizeFileName(fileName) {
    return fileName
      .replace(/[<>:"\/\\|?*\x00-\x1F]/g, '_')  // Заменяем недопустимые символы на "_"
      .replace(/[^\x00-\x7F]/g, '')  // Удаляем нелатинские символы, которые могут вызывать ошибки
      .trim();
  }

  postRequest(url, data) {
    return new Promise((resolve, reject) => {
    const options = {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
        },
        body: JSON.stringify(data)
    };
    
    fetch(url, options)
    .then(response => response.json())
    .then(result => {
        resolve(result);
    })
    .catch(error => {
        reject(error);
    });
    })
  }

  async downloadAndExtractFile(url, outputDir, newFileNameWithoutExt) {
    try {
      if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
      }

      // console.log('Saving', url);

      if (fs.existsSync(`${outputDir}/${newFileNameWithoutExt}.pdf`) || fs.existsSync(`${outputDir}/${newFileNameWithoutExt}.doc`)) {
        // console.log(`Файл уже сохранен: ${outputDir}/${newFileNameWithoutExt}`);
        return;
      }

      let randomIndexPage = Math.floor(Math.random() * Object.values(this.pagesReportsProxies).length);
      let page = Object.values(this.pagesReportsProxies)[randomIndexPage];

      const response = await page.evaluate(async (url) => {
          const res = await fetch(url, { timeout: 60000 });
          const buffer = await res.arrayBuffer(); // возвращаемый массив байтов
          return Array.from(new Uint8Array(buffer)); // преобразуем в массив чисел
      }, url);

      const buffer = Buffer.from(response);

      const zipPath = path.join(outputDir, 'temp.zip');
      fs.writeFileSync(zipPath, buffer);

      const zip = new AdmZip(zipPath);
      const zipEntries = zip.getEntries();

      if (zipEntries.length !== 1) {
          throw new Error('Ожидался один файл в архиве');
      }

      const zipEntry = zipEntries[0];
      const originalFileName = zipEntry.entryName;
      const fileExtension = path.extname(originalFileName);

      const sanitizedFileName = this.sanitizeFileName(newFileNameWithoutExt) + fileExtension;
      const extractedFilePath = path.join(outputDir, sanitizedFileName);

      fs.writeFileSync(extractedFilePath, zipEntry.getData());
      // console.log(`Файл сохранен: ${extractedFilePath}`);

      fs.unlinkSync(zipPath);
  } catch (error) {
      // console.error('Ошибка:', error.message);
  }
  };

  async fetchReportTableData(url) {
    try {
      let html = await this.getFromSite(url);

      let $ = cheerio.load(html);

      let table = $('.files-table');

      let headers = [];
      table.find('tbody tr th').each((index, element) => {
        headers.push($(element).text().trim().replace(/\u00AD/g, ''))
      });

      let rows = [];
      table.find('tbody tr').each((index, element) => {
        let row = {};
        $(element).find('td').each((i, elem) => {
          let key = headers[i];

          if (!key) {
            return;
          }

          let value;
          if (key === 'Файл') {
            $(elem).find('a').each((i, elem) => {
              value = $(elem).attr('href');
            });

          } else {
            value = $(elem).text().trim().replace(/\u00AD/g, '');
          }
          row[key] = value;
        });

        if (Object.keys(row).length && row['Файл']) {
          rows.push(row);
        }
      });

      return rows;
    } catch (error) {
      console.error('Ошибка при получении данных:', error);
      return [];
    }
  }

  async getContentFromElement(url) {
    try {
      let html = await this.getFromSite(url);

      let $ = cheerio.load(html);
      let contentElement = $('#cont_wrap');

      if (contentElement.length > 0) {
        return contentElement.text().trim();
      } else {
        console.log('Элемент с id "cont_wrap" не найден');
      }
    } catch (error) {
      console.error('Ошибка:', error.message);
    }
  }

  async postFromSite(url, data) {
    let randomIndexPage = Math.floor(Math.random() * Object.values(this.pagesNewsProxies).length);
    let page = Object.values(this.pagesReportsProxies)[randomIndexPage];

    let result = await page.evaluate(async (url, data) => {
      return await (await fetch(url, {
        "headers": {
          "content-type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        "body": data,
        "method": "POST"
      })).json();
    }, url, data);

    return result;
  }

  extractSubstrings(input) {
    let regexStart = /\d\.\d\.\d/g;
    let regexEnd = /\d\.\d\.\d|\d\.\d|$/g;
    let result = [];
    let matchStart, matchEnd;

    while ((matchStart = regexStart.exec(input)) !== null) {
      let startIdx = matchStart.index;

      regexEnd.lastIndex = regexStart.lastIndex;
      matchEnd = regexEnd.exec(input);

      let endIdx;
      if (matchEnd !== null) {
        endIdx = matchEnd.index;
      } else {
        endIdx = input.length;
      }

      let substring = input.slice(startIdx, endIdx).trim();
      result.push(substring);
      regexStart.lastIndex = endIdx;
    }

    return result;
  }

  async getFromSite(url) {
    let randomIndexPage = Math.floor(Math.random() * Object.values(this.pagesReportsProxies).length);
    let page = Object.values(this.pagesReportsProxies)[randomIndexPage];

    let result = await page.evaluate(async (url) => {
      return await (await fetch(url)).text();
    }, url);

    return result;
  }

  async scanningNews() {
    while (true) {
      let finishDate = moment().format('DD.MM.YYYY');
      let startDate = moment();
      startDate.add(-1, 'M');
      startDate = startDate.format('DD.MM.YYYY');


      let responseData = [];

      try {
        responseData = await this.postFromSite(
          'https://www.e-disclosure.ru/api/search/sevents',
          `eventTypeTerm=&radView=0&dateStart=${startDate}&dateFinish=${finishDate}&textfieldEvent=&radReg=FederalDistricts&districtsCheckboxGroup=-1&regionsCheckboxGroup=-1&branchesCheckboxGroup=-1&textfieldCompany=&lastPageSize=10&lastPageNumber=1&query=&queryEvent=`
        );

        responseData = responseData.foundEventsList;
      } catch (e) {
        console.log('Error while getting POST', e)
      }

      for (let news of responseData) {
        if (!this.tickers[news.companyName]) {
          console.log(`Skip news unknown company name id: ${news.pseudoGUID}`);
          continue;
        }

        if (!this.subtitles[news.eventName]) {
          console.log(`Skip news unknown subtitle id: ${news.pseudoGUID}`);
          continue;
        }

        let newsToPost = {
          ticker: this.tickers[news.companyName].name,
          name: news.companyName,
          fullText: await this.getContentFromElement(`https://www.e-disclosure.ru/portal/event.aspx?EventId=${news.pseudoGUID}`),
          textes: [],
        };
        
        if (newsToPost.fullText) {
          for (let filter of this.subtitles[news.eventName].filters || []) {
            for (let startFilter of filter.start) {
              for (let endFilter of filter.end) {
                let startIndex = newsToPost.fullText.indexOf(startFilter);
                let endIndex = newsToPost.fullText.indexOf(endFilter);
                newsToPost.textes.push(newsToPost.fullText.slice(startIndex, endIndex));
              }
            }
          }

          for (let substring of this.extractSubstrings(newsToPost.fullText)) {
            for (let key of this.subtitles[news.eventName].keys) {
              if (substring.includes(key)) {
                newsToPost.textes.push(substring);
              }
            }
          }
        }

        let hashOfData = MD5(JSON.stringify(newsToPost)).toString();
        if (!this.historyNews.includes(hashOfData)) {
          // post req

          this.newNews.push(newsToPost);

          if (!this.isFirstIterationNews) {
            await this.postRequest('http://92.53.124.200:5000/api/edisclosure_news', newsToPost);
            console.log('Post news sended');
          }
          fs.writeFileSync('./data/newNews.json', JSON.stringify(this.newNews, null, 2));
          this.historyNews.push(hashOfData);
          fs.writeFileSync('./data/historyNews.json', JSON.stringify(this.historyNews, null, 2));
        }
      }

      await this.waitForTimeout(1000 * 60);
      this.isFirstIterationNews = false;
    }
  }

  async controlSavingFiles(url, path, name) {
    await this.waitForTimeout(Math.floor((1 + Math.random()) * 5000));
    this.tasksOfSavingReportsFiles.push(this.downloadAndExtractFile(url, path, name));

    if (this.tasksOfSavingReportsFiles.length >= 3) {
      await Promise.all(this.tasksOfSavingReportsFiles);
      this.tasksOfSavingReportsFiles = [];
    }
  }

  async saveReportForType(type, companyName) {
    let url = `https://www.e-disclosure.ru/portal/files.aspx?id=${this.tickers[companyName].id}&type=${type}`;

    let dataOfTable = await this.fetchReportTableData(url);

    let tasksOfSavingReports = [];

    for (let row of dataOfTable) {
      row.ticker = this.tickers[companyName].ticker;
      row.name = companyName;
      row.id = this.tickers[companyName].id;
      row.type = type;

      let hashOfData = MD5(JSON.stringify(row)).toString();

      let url = row['Файл'];

      this.controlSavingFiles(url, './data/reports', MD5(row['Файл']).toString());

      row['Файл'] = `${__dirname}/data/reports/${MD5(row['Файл']).toString()}`;

      if (!this.historyReports.includes(hashOfData)) {

        // post request!!!!!!!
        this.newReports.push(row);

        if (!this.isFirstIteration) {
          await this.postRequest('http://92.53.124.200:5000/api/edisclosure_reports', row);
          console.log("Post reports sended");
        }
        fs.writeFileSync('./data/newReports.json', JSON.stringify(this.newReports, null, 2));
        this.historyReports.push(hashOfData);
        fs.writeFileSync('./data/historyReports.json', JSON.stringify(this.historyReports, null, 2));
      }
    }
  }

  async saveReportForCompanyName(companyName) {
    for (let type of this.tickers[companyName].types) {
      await this.saveReportForType(type, companyName);
    }

    console.log(companyName, 'saved!');
  }

  async scanningReports() {
    while (true) {
      for (let companyName of Object.keys(this.tickers)) {
        await this.saveReportForCompanyName(companyName);
      }

      await this.waitForTimeout(60 * 1000);
      this.isFirstIterationReports = false;
    }
  }

  async start() {
    this.tasksOfSavingReportsFiles = [];
    this.newNews = [];
    this.newReports = [];
    this.historyNews = JSON.parse(fs.readFileSync('./data/historyNews.json', 'utf8'));
    this.historyReports = JSON.parse(fs.readFileSync('./data/historyReports.json', 'utf8'));
    this.isFirstIterationNews = true;
    this.isFirstIterationReports = true;

    let tickersFile = JSON.parse(fs.readFileSync('./data/tickers.json', 'utf8'));
    this.tickers = {};

    for (let ticker of tickersFile) {
      this.tickers[ticker.name] = ticker;
    }

    let subtitlesFile = JSON.parse(fs.readFileSync('./data/subtitles.json', 'utf8'));
    this.subtitles = {};

    for (let subtitle of subtitlesFile) {
      this.subtitles[subtitle.subtitle] = subtitle;
    }
    
    this.proxies = await Promise.all(
      JSON.parse(fs.readFileSync('./data/proxies.json', 'utf8')).map(
        async proxy => await ProxyChain.anonymizeProxy(proxy)
        )
    );

    console.log(this.proxies);

    this.browsersProxies = [];
    this.pagesReportsProxies = {};
    this.pagesNewsProxies = {};

    for (let proxy of this.proxies) {
      let browser;
      try {
        browser = await puppeteer.launch({
          args: [
            `--proxy-server=${proxy}`,
            '--ignore-certificate-errors',
            '--disable-web-security',
            // '--disable-setuid-sandbox',
            // '--disable-dev-shm-usage',
            // '--disable-gpu',
            // '--disable-software-rasterizer',
            // '--single-process',
            // '--no-zygote',
            // '--disable-extensions',
            '--no-sandbox'

          ],
          protocolTimeout: 360000,
          timeout: 60000,
          // headless: false,
          headless: 'new'
        });

        this.browsersProxies.push(this.browsersProxies);
    
        console.log(`Browser with proxy ${proxy} is launching...`);
    
        let pageNews = (await browser.pages())[0];
        this.pagesNewsProxies[proxy] = pageNews;

        pageNews.on('response', async (response) => {
          let url = response.url();
          
          if (url.startsWith('https://www.e-disclosure.ru/xpvnsulc')) {
            console.log('removed news', proxy);
            delete this.pagesNewsProxies[proxy];
          }
        });

        await pageNews.setUserAgent(new UserAgent().toString());
        await pageNews.goto('https://www.e-disclosure.ru/poisk-po-soobshheniyam');
    
    
        let pageReport = await browser.newPage();
        this.pagesReportsProxies[proxy] = pageReport;

        pageReport.on('response', async (response) => {
          let url = response.url();
          
          if (url.startsWith('https://www.e-disclosure.ru/xpvnsulc')) {
            console.log('removed report', proxy);
            delete this.pagesReportsProxies[proxy];
          }
        });

        await pageReport.setUserAgent(new UserAgent().toString());
        await pageReport.goto('https://www.e-disclosure.ru/portal/files.aspx?id=38334&type=5');
    
        console.log(`Browser with proxy ${proxy} is ready!`);
    
      } catch (error) {
        console.error(`Error with browser ${proxy}:`, error);
      }
    }

    await this.waitForTimeout(1000 * 30);

    console.log(this.pagesNewsProxies);
    console.log(this.pagesReportsProxies);

    console.log('Start parsing');

    this.scanningNews();
    this.scanningReports();

    
  }
}