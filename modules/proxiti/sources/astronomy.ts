import { Source, ConfigLoader, GenericDevice, InitObject, Parameters } from 'domoja-core';
import * as assert from 'assert';
import * as request from 'request';

var logger = require("tracer").colorConsole({
	dateformat: "dd/mm/yyyy HH:MM:ss.l",
	level: 3 //0:'test', 1:'trace', 2:'debug', 3:'info', 4:'warn', 5:'error'
});

//import * as cache from "./cache";
var cronJob = require('cron').CronJob;
var logger = require("tracer").colorConsole({
	dateformat: "dd/mm/yyyy HH:MM:ss.l",
	level: 3 //0:'test', 1:'trace', 2:'debug', 3:'info', 4:'warn', 5:'error'
});



// http://www.proxiti.info/horaires_soleil.php?o=06030
// <tr><th>Date</th><th>Lever du Soleil</th><th>Coucher du Soleil</th><th>Durée du Jour</th><th>Soleil au Zénith</th><th>Début de l'Aube</th><th>Fin du Crépuscule</th></tr>

const NB_COLS = 7;
// number of columns in the table

// fields of the table, in the given order
const DATE = 1;
const LEVER_DU_SOLEIL = 2;
const COUCHER_DU_SOLEIL = 3;
const DUREE_DU_JOUR = 4;
const SOLEIL_AU_ZENITH = 5;
const DEBUT_DE_L_AUBE = 6;
const FIN_DU_CREPUSCULE = 7;

export class astronomy extends Source {
	job: any;
	request: request.Request;

	constructor(path: string) {
		super(path);
		let self = this;
		this.job = new cronJob({
			cronTime: '00 01 * * *', // Runs every day at 1:00 AM.
			onTick: function () {
				self.RetryUpdateCache(function () {
					logger.info("All astronomy info updated and stored in cache from CronJob.")
				})
			},
			runOnInit: true
		});
	}

	createInstance(configLoader: ConfigLoader, path: string, initObject: InitObject): Source {
		return new astronomy(path);
	}

	getParameters(): Parameters {
		return {
			location: 'REQUIRED'
		}
	}

	setAttribute(device: GenericDevice, attribute: string, value: string, callback: (err: Error) => void): void {
		return callback(new Error('Unsupported attribute/value ' + attribute + '/' + value))
	}

	release(): void {
		this.job.stop();
		this.job = null;
		this.request.abort();
		super.release();
	}

	static registerDeviceTypes(): void {
		Source.registerDeviceType(this, 'device', {
			source: 'REQUIRED',
			id: 'REQUIRED',
			location: 'OPTIONAL'
		});
	}

	RetryUpdateCache(f: Function) {
		let self = this;
		this.UpdateCache(function (err) {
			if (err == null) {
				f();
			} else {
				logger.warn(err);
				var delay = 10;
				logger.warn("Retrying in", delay, "mn");
				setTimeout(function () {
					self.RetryUpdateCache(f);
				}, delay * 60 * 1000);
			}
		});
	}

	UpdateCache(callback: (err: Error) => void) {

		let self = this;

		this.request = request.get("http://www.proxiti.info/horaires_soleil.php?o=06030", function (err, response, bodyString) {

			var clearRe = /<center>|<\/center>|<span[^>]*>|<\/span>|<br \/>/g

			var cBodyString = bodyString.replace(clearRe, "")
			//console.dir(cBodyString)

			//var re = /<ev type="([^"]*)"\s+pro="([^"]*)"\s+id="([^"]*)"\s+gmt="([^"]*)"\s+v1="([^"]*)"\s+v2="([^"]*)"\s+lowbatt="([^"]*)"\/>/g;
			// <tr><th>Date</th><th>Lever du Soleil</th><th>Coucher du Soleil</th><th>Durée du Jour</th><th>Soleil au Zénith</th><th>Début de l'Aube</th><th>Fin du Crépuscule</th></tr>
			var reh = /<tr><th>([^<]*)<\/th><th>([^<]*)<\/th><th>([^<]*)<\/th><th>([^<]*)<\/th><th>([^<]*)<\/th><th>([^<]*)<\/th><th>([^<]*)<\/th><\/tr>/

			var err = null;
			var match = reh.exec(cBodyString)
			if (match == undefined) {
				logger.error("Couldn't find headers in:", bodyString)
				err = new Error("Couldn't find headers in:" + bodyString)
			} else {
				assert.notEqual(match, undefined)
				assert.equal(match.length - 1, NB_COLS, "Wrong number of columns (" + (match.length - 1) + ") in proxiti table.");
				assert.equal(match[DATE], "Date");
				assert.equal(match[LEVER_DU_SOLEIL], "Lever du Soleil");
				assert.equal(match[COUCHER_DU_SOLEIL], "Coucher du Soleil");
				assert.equal(match[DUREE_DU_JOUR], "Durée du Jour");
				assert.equal(match[SOLEIL_AU_ZENITH], "Soleil au Zénith");
				assert.equal(match[DEBUT_DE_L_AUBE], "Début de l'Aube");
				assert.equal(match[FIN_DU_CREPUSCULE], "Fin du Crépuscule");

				// find right line with the date
				var today = new Date()
				var day = today.getDate()
				var month = 1 + today.getMonth()
				var year = today.getFullYear()
				var todayString = (day < 10 ? "0" : "") + day + "-" + (month < 10 ? "0" : "") + month + "-" + year
				logger.debug(todayString)

				// <tr><td><center>Vendredi<br />19-04-2013</center></td><td><center>06h41</center></td><td><center>20h20</center></td><td><center>13H<br />38 min.</center></td><td><center>13h30</center></td><td><center>06h11</center></td><td><center>20h50</center></td></tr>
				var re = new RegExp('<tr><td>[a-zA-Z]*(' + todayString + ')<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><td>([^<]*)<\/td><\/tr>', 'g')
				var mmatch = re.exec(cBodyString)
				var pushData = [];
				if (mmatch != undefined) {
					for (var f = 1; f <= NB_COLS; f++) {

						var t = mmatch[f];

						var resep = /([0-9]+)[^0-9]+([0-9]+)/
						var rematch = resep.exec(t)
						if (rematch != undefined) {
							assert.notEqual(rematch, undefined)
							assert.equal(rematch.length, 3)

							//						var t = 60 * rematch[1] + (rematch[2] - 0)
							var d = new Date;
							var t2 = new Date(d.getFullYear(), d.getMonth(), d.getDate(), parseInt(rematch[1]), parseInt(rematch[2]), 0);

							// keep in cache
							logger.debug("Putting in cache '" + f + "' (" + match[f] + ") with value '" + t + "'.");
							//cache.set(f, t2)

							switch (f) {
								case LEVER_DU_SOLEIL:
									self.setDeviceState("sunrise", t2.toString());
									sunriseTime = t2;
									break;
								case COUCHER_DU_SOLEIL:
									self.setDeviceState("sunset", t2.toString());
									sunsetTime = t2;
									break;
								case DUREE_DU_JOUR:
									self.setDeviceState("dayDuration", t2.toString());
									dayDuration = t2;
									break;
								case SOLEIL_AU_ZENITH:
									self.setDeviceState("zenithTime", t2.toString());
									zenithTime = t2;
									break;
								case DEBUT_DE_L_AUBE:
									self.setDeviceState("dawnTime", t2.toString());
									dawnTime = t2;
									break;
								case FIN_DU_CREPUSCULE:
									self.setDeviceState("duskTime", t2.toString());
									duskTime = t2;
									break;
							}
						}
					}

				}
				lastUpdateDate = new Date();
				//pushData.push("dateMAJAstronomy");
				//require("../routes/refreshData").pushData(pushData);

			}

			callback(err);
		});

	}

}



export var zenithTime: Date = undefined;
export var sunriseTime: Date = undefined;
export var sunsetTime: Date = undefined;
export var dayDuration: Date = undefined;
export var dawnTime: Date = undefined;
export var duskTime: Date = undefined;
export var lastUpdateDate: Date = undefined;
/*
export function getZenithTime(cb_func: (err: Error, value: Date) => void) {
	return zenithTime;
};

export function getSunriseTime(cb_func: (err: Error, value: Date) => void) {
	var d = new Date();
	d.setHours(7)
	d.setMinutes(0)
	d.setSeconds(0)
	getFromCache(cb_func, LEVER_DU_SOLEIL, d)
};

export function getSunsetTime(cb_func: (err: Error, value: Date) => void) {
	var d = new Date();
	d.setHours(20)
	d.setMinutes(0)
	d.setSeconds(0)
	getFromCache(cb_func, COUCHER_DU_SOLEIL, d)
};

export function getDayDuration(cb_func: (err: Error, value: Date) => void) {
	var d = new Date();
	d.setHours(13)
	d.setMinutes(0)
	d.setSeconds(0)
	getFromCache(cb_func, DUREE_DU_JOUR, d)
};

export function getDuskTime(cb_func: (err: Error, value: Date) => void) {
	var d = new Date();
	d.setHours(6)
	d.setMinutes(0)
	d.setSeconds(0)
	getFromCache(cb_func, DEBUT_DE_L_AUBE, d)
};

export function getDawnTime(cb_func: (err: Error, value: Date) => void) {
	var d = new Date();
	d.setHours(21)
	d.setMinutes(0)
	d.setSeconds(0)
	getFromCache(cb_func, FIN_DU_CREPUSCULE, d)
};


function getFromCache(cb_func: (err: Error, value: Date) => void, field: number, def_value: Date) {
	var time = cache.get(field);

	if (time == undefined) {
		UpdateCache(function (err) {
			if (err) {
				cb_func(err, undefined);
			} else {
				var time = cache.get(field)
				if (time == undefined) {
					time = def_value
				}
				cb_func(null, time);
			}
		});
	} else {
		cb_func(null, time);
	}
}

*/