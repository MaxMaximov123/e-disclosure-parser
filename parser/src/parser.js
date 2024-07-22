import { db } from './database.js';
import config from './config.js';
import moment from 'moment';
import 'moment-timezone';
import cheerio from 'cheerio';


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

  async getGamesByHtml(html) {
    let $ = cheerio.load(html);

    let games = [];

    $('.elem').each((index, element) => {
      let dateTime = $(element).find('.draw_date').attr('title');

      const zoneElements = $(element).find('.zone');
      const zones = [[], []];

      zoneElements.each((i, el) => {
        let numbers = $(el).find('b');
        numbers.each((ind, elem) => {
          zones[i].push(Number($(elem).text()));
        });
      });

      let game = {
          // dateTime: this.convertTZ(moment(dateTime, 'DD.MM.YYYY HH:mm').toDate(), 'Europe/Moscow'),
          dateTime: moment(dateTime, 'DD.MM.YYYY HH:mm').toDate(),
    
          upperNumber_1: zones[0][0],
          upperNumber_2: zones[0][1],
          upperNumber_3: zones[0][2],
          upperNumber_4: zones[0][3],
    
          bottomNumber_1: zones[1][0],
          bottomNumber_2: zones[1][1],
          bottomNumber_3: zones[1][2],
          bottomNumber_4: zones[1][3],
        }

      games.push(game);
    });
    return games;
  }

  async scanning() {
    while (true) {
      let continueSearching = true;
      let page = 1;
      let newGamesIntoDB = [];

      while (continueSearching) {

        try {
          let htmlTable = await this.getHtmlByPage(page);
          let newGames = await this.getGamesByHtml(htmlTable.data);

          page++;

          for (let newGame of newGames) {
            if (String(newGame.dateTime) in this.allGames) {
              continueSearching = false;
              console.log('This game already exist');
              break;
            }

            newGamesIntoDB.push(newGame);
          }
          
          if (newGamesIntoDB.length === 0) {
            break;
          }
          
          try {
            await db('games').insert(newGamesIntoDB).onConflict().ignore();
            newGamesIntoDB = [];
          }
          catch(e) {
            console.log('DB insert error', e);
            console.log(newGamesIntoDB);
          }

          for (let newGameIntoDB of newGamesIntoDB) {
            this.allGames[newGameIntoDB.dateTime] = newGameIntoDB;
          }

          console.log(Object.keys(this.allGames).length, page);
          await this.waitForTimeout(1000);
        } catch(e) {
          console.log('Last page', e);
          break
        }
      }

      await this.waitForTimeout(1000 * 60 * 60);
    }
  }

  convertTZ(date, tzString) {
    return new Date((typeof date === "string" ? new Date(date) : date).toLocaleString("en-US", {timeZone: tzString}));
  }

  async postRequest(url, data) {
    return new Promise((resolve, reject) => {
      const options = {
          method: 'POST',
          headers: {
              'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: data
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

  async getHtmlByPage(page) {
    let responseData = await this.postRequest(
      'https://www.stoloto.ru/draw-results/oxota/load',
      `page=${page}&mode=date&super=false&from=01.01.2024&to=${moment().format('DD.MM.YYYY')}`
    );

    return responseData;
  }

  async start() {
    
    // await db('games').insert({
    //   dateTime: new Date(),

    //   upperNumber_1: 1,
    //   upperNumber_2: 2,
    //   upperNumber_3: 3,
    //   upperNumber_4: 4,

    //   bottomNumber_1: 1,
    //   bottomNumber_2: 2,
    //   bottomNumber_3: 3,
    //   bottomNumber_4: 4,
    // });

    let db_ames = await db('games').select('*');
    this.allGames = {};

    for (let game of db_ames) {
      this.allGames[game.dateTime] = game;
    }

    // console.log(await this.getHtmlByPage(1470))
    // try {
    //   console.log(await this.getGamesByHtml(await this.getHtmlByPage(1470)));
    // } catch(e) {
    //   console.log(999, e);
    // }
    this.scanning();
  }
}