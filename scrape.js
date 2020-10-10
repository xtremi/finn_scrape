const puppeteer = require("puppeteer")
const gmaps   	= require('./gmapsAPI.js');
const fs 		= require('fs');
const util 		= require('util');

var USE_GMAPS = true;

var base_url = "https://www.finn.no/realestate/homes/search.html";
base_url += "?&lat=59.91298&lon=10.7339";


console.log("Finn scraping v2");
console.log("Scraping URL: " + base_url);

let details_map = new Map();

/*
Get all details listed in <dl> lists as <dt>/<dd> pairs
in Finn's individual house pages.
*/
async function getHouseDetails(page){
	const details = await page.evaluate(() => {
		let dt = document.querySelectorAll("dl.definition-list > dt");
		let dd = document.querySelectorAll("dl.definition-list > dd");

		var types = [];
		var values = [];
		dt.forEach(function(el){
			types.push(el.innerText);
		});
		dd.forEach(function(el){
			values.push(el.innerText);
		});
		var details = {};
		
		for(i = 0; i < types.length; i++){
			details[types[i]] = values[i];
		}

		return details;
	
	})
	
	return details;
}
/*
Performs a querySelector query on <page> with query = <queryPath>,
checks if property <property> of query exists, and returns the its value.
If it doesn't exist, it returns <defaultReturnValue>.
*/
async function getSingleQuery(page, queryPath, property, defaultReturnValue){	
	
	const data = await page.evaluate((queryPath, property, defaultReturnValue)=>{						
		let element = document.querySelector(queryPath);		
		try{
			return element[property];
		}
		catch(err){
			return defaultReturnValue;
		}
		
	}, queryPath, property, defaultReturnValue)	
	return data;
}


async function getDivPanelContents(page)
{
	var queryPath  = "div.panel > span.u-t3, ";
	queryPath     += "div.panel > div > span.u-t3, ";
	queryPath     += "div.panel > span.u-strong.u-display-block, ";
	queryPath     += "div.panel > div > span.u-strong.u-display-block";

	const results = await page.evaluate((queryPath)=>{						
		let elements = Array.from(document.querySelectorAll(queryPath));		
		try{
			let texts = elements.map(element =>{
				return element["innerText"]
				})
			return texts;
		}
		catch(err){	
			return null;
		}
		
	}, queryPath)
	
	return results;
	
}

async function getAdditionalPriceDetails(page){
	
	var data = await getDivPanelContents(page);	
	var priceDetails = {};
	
	if(data && (data.length%2 == 0)){
		for(var i = 0; i < (data.length - 1); i = i + 2){
			priceDetails[data[i]] = data[i + 1];
		}		
	}
	return priceDetails;
}


async function getPris(page){
	var qrypath = "div.panel > span.u-t3";
	return await getSingleQuery(page, qrypath, "innerText", "<not found>");
}

async function getHouseAddress(page){	
	var qrypath = "div.u-word-break > section.panel > p.u-caption";
	return await getSingleQuery(page, qrypath, "innerText", "<missing address>");
}
async function getHouseDescription(page){	
	var qrypath = "div.u-word-break > section.panel > h1.u-t2";
	return await getSingleQuery(page, qrypath, "innerText", "<missing description>");
}
async function getHouseImage(page){
	const qrypath = 'img[data-index="0"]';
	return getSingleQuery(page, qrypath, "src", "");
}


function cleanRealProperties(hd){
	const real_properties = [
		"Bruksareal","Primærrom","Omkostninger","Totalpris","Tomteareal","Bruttoareal","Prisantydning", 
		"Felleskost/mnd.", "Formuesverdi", "Fellesgjeld", "Fellesformue", "Kommunale avg.", "Pris",
		"Areal", "Pris fra", "Pris til", "Tomt", "Pris med fellesgjeld", "Verditakst", "Grunnflate"
		];
	
	for(var i = 0; i < real_properties.length; i++){
		var pname = real_properties[i];
		if(hd.hasOwnProperty(pname)){
			var val = parseFloat(hd[pname].replace(/\s/g,''));
			hd[pname] = val;
		}
	}
	
}

function cleanHouseData(h)
{
	cleanRealProperties(h.details);
	var area = 0.0, price=0.0;
	
	if(h.details.hasOwnProperty("Bruksareal")){
	area = h.details["Bruksareal"];}
	else if(h.details.hasOwnProperty("Primærrom"))
		area = h.details["Primærrom"];
	else if(h.details.hasOwnProperty("Bruttoareal"))
		area = h.details["Bruttoareal"];
	else if(h.details.hasOwnProperty("Areal"))
		area = h.details["Areal"];	
	else if(h.details.hasOwnProperty("Grunnflate"))
		area = h.details["Grunnflate"];	
	
	var loan = 0.0;
	if(h.details.hasOwnProperty("Fellesgjeld"))
		loan = h.details["Fellesgjeld"];
	
	if(h.details.hasOwnProperty("Totalpris"))
		price = h.details["Totalpris"];
	else if(h.details.hasOwnProperty("Prisantydning"))
		price = h.details["Prisantydning"] + loan;
	else if(h.details.hasOwnProperty("Pris med fellesgjeld"))
		price = h.details["Pris med fellesgjeld"];	
	else if(h.details.hasOwnProperty("Pris"))
		price = h.details["Pris"] + loan;	
	else if(h.details.hasOwnProperty("Pris fra"))
		price = h.details["Pris fra"] + loan;		
	else if(h.details.hasOwnProperty("Formuesverdi"))
		price = h.details["Formuesverdi"] + loan;
	
	h.area = area;
	h.price = price;
}

function countKeys(details, priceDetails){
	for(let entry in details){
		if(details_map.has(entry))
			details_map.set(entry, details_map.get(entry) + 1);
		else
			details_map.set(entry, 1);	
		
	}

}

/*
Iterates all house objects in <houses> array.
Goes to the house.url and collects the following information:
- imgurl     : url of the main image
- details    : all details listed as "definitions" in the page (area, rooms, type, etc...)
- address    : house address
- description: title/description of the house page

The information is added to the house objects.
*/
async function getHousesDetails(page, houses_data, prevHouses_data){	
	
	var house 	= {}; 
	var i 		= 0;
	var nhouses = houses_data.ids.length;
			
	for(var id of houses_data.ids){
		i++;		
		
		const str = "[" + i + "/" + nhouses + "] id  : " + id;
		process.stdout.write(str + " reading....");
		
		
		if(id in prevHouses_data.houses){
			process.stdout.write(" retreived from saved houses!\n");
			houses_data.houses[id] = prevHouses_data.houses[id];
		}
		else{
			house = houses_data.houses[id]
			await page.goto(house.url, {timeout: 0});
						
			house.imgurl  		= await getHouseImage(page);		
			house.address 		= await getHouseAddress(page);
			house.description 	= await getHouseDescription(page);
			var details 		= await getHouseDetails(page);	
			var prices 			= await getAdditionalPriceDetails(page);
			house.details = {...details, ...prices};
			cleanHouseData(house);
			countKeys(house);
			
			houses_data.houses[id] = house;
			
			process.stdout.write(" read data from URL!\n")			
		}		
			
	}
	
	//Object.keys(houses_data.houses).forEach(await checkHouseData);
	
	
	/*for(i = 0; i < houses.length; i++){
		const str = "[" + (i+1) + "/" + houses.length + "] id  : " + houses[i].id;
		process.stdout.write(str + " reading....");
				
		
		await page.goto(houses[i].url, {timeout: 0});		
				
		
		houses[i].imgurl  		= await getHouseImage(page);		
		houses[i].address 		= await getHouseAddress(page);
		houses[i].description 	= await getHouseDescription(page);
		var details 			= await getHouseDetails(page);	
		var prices 				= await getAdditionalPriceDetails(page);
		houses[i].details = {...details, ...prices};
		cleanHouseData(houses[i]);
		countKeys(houses[i]);		
		//console.log("\t addr: " + houses[i].address);
		//console.log("\t house: " + JSON.stringify(houses[i],0,2));
		
		process.stdout.write("complete!\n")
	}*/
}




/*
Goes to the url <url>, and get the url and id of every
house listed.
Returned as an array of objects with properties <url> and <id>.
*/
async function getHouseLinksAndIDs(page, url){
	await page.goto(url);
	
	var linkClassPath = ".ads__unit > .ads__unit__content > h2 > a";
	
	const houseLinks = await page.evaluate((linkClassPath) => {			
		let elements = Array.from(document.querySelectorAll(linkClassPath));
		let links = elements.map(element => {
			return {"url" : element.href, "id" : element.id}
		});
		return links;
	}, linkClassPath)
	
	return houseLinks;
}

/*
Check the url for the page list (at bottom).
If found, it returns the largest page number.
If not found, returns 1.
*/
async function getLastPage(page){
	var classPath = 'nav.pagination > div.u-hide-lt768 > a';
	
	lastPage = await page.evaluate((classPath) =>{			
		let elements  	 = Array.from(document.querySelectorAll(classPath));
		if(elements.length > 0){	
			let pages     	 = elements.map(element => { return element.innerHTML} );
			var pagesNumeric = pages.map(function(item){ return parseInt(item,10)} );
			return Math.max(...pagesNumeric);
		}
		else{
			return 1;
		}
	}, classPath)
	
	return lastPage;
}


/*
Check the maximum number of pages in the current url,
goes to this page, and check if more pages exists.

Continues, until the last page is found.
The total number of pages is returned.
*/
async function getNumberOfPages(page, url){
	await page.goto(url);
	
		
	var previousLastPage = 1;
	var lastPage 		 = 1;
		
	var lastPageFound = false;
	while(!lastPageFound){
		
		lastPage = await getLastPage(page);
				
		console.log("Current last page is " + lastPage.toString());
		if(previousLastPage == lastPage){
			lastPageFound = true;
		}
		else{
			previousLastPage = lastPage;
			var nextPageUrl = url + "&page=" + lastPage.toString();
			console.log("Going to: " + nextPageUrl);
			await page.goto(nextPageUrl);
		}								
	}
	return lastPage;
}

/*
Given the number of pages, and a url <search_url>,
Iterates every page, and returns an array of objects with
properties <id> and <url> of each house.
*/
async function getAllHouseLinksAndIDs(page, search_url, max_pages){
	
	var all_house_links_and_ids = [];
	
	for(page_number = 1; page_number <= maxPages; page_number++){
		var url = search_url;
		if(page_number != 1){
			url += ("&page=" + page_number.toString());
		}
		
		console.log("Collecting house links and IDs at url: " + url);
		var houseLinksAndIDs = await getHouseLinksAndIDs(page, url);
		all_house_links_and_ids.push(...houseLinksAndIDs);
		
		var new_results 	= houseLinksAndIDs.length;
		var total_results 	= all_house_links_and_ids.length;
		
		console.log("Found " + new_results.toString() + " results (total = " + total_results.toString() + ")");		
	}
	
	var house_data = {};
	house_data.houses = {};
	house_data.ids = [];
		
	all_house_links_and_ids.forEach(function (item, index){
		house_data.houses[item.id] = item;
		house_data.ids.push(item.id);
	})	
	return house_data;
}




/*
*/
const MAX_TO_ADDR = 25;
function restrictNumberOfHouseToProcess(remainingHouses){
	var n_to_addresses = MAX_TO_ADDR;
	if(remainingHouses < MAX_TO_ADDR)
		n_to_addresses = remainingHouses;
	return n_to_addresses;
}

/**/
const emptyTD ={"time1" : 0, "dist1" : 0, "time2" : 0, "dist2" : 0};
function getTravelDurationsAndDistances(row){
	var travelDetails = {};
	//console.log(row);
	if((typeof row == "undefined") || (typeof row.elements == "undefined") || (row.elements.length === 0))
		travelDetails = emptyTD;
	else{
		if(row.elements[0].status == "OK"){
			travelDetails.dist1 = row.elements[0].distance.value;
			travelDetails.time1 = row.elements[0].duration.value;
		}
		else{
			travelDetails.dist1 = 0;
			travelDetails.time1 = 0;
		}
		if(row.elements[1].status == "OK"){
			travelDetails.dist2 = row.elements[1].distance.value;		
			travelDetails.time2 = row.elements[1].duration.value;
		}
		else{
			travelDetails.dist2 = 0;		
			travelDetails.time2 = 0;
		}
	}
	return travelDetails;
}

function setFakeTravelDetails(houses){
	
	for(var i = 0; i < houses.length; i++){
		houses[i].travel_details = {};
		houses[i].travel_details.dist1 = 0;
		houses[i].travel_details.dist2 = 0;
		houses[i].travel_details.time1 = 0;
		houses[i].travel_details.time2 = 0;
	}
	
}

/**/
async function getAllTravelDetails(houseData, address1, address2){
	
	var toAddresses = [
		address1, address2
		];
		
	var remainingHouses = houseData.ids.length;
	
	var house_counter = 0;
	
	while(remainingHouses > 0){
		
		var n_from_addresses = restrictNumberOfHouseToProcess(remainingHouses);			
		remainingHouses -= n_from_addresses;
		
		var msg = "[GMAPS] processing " +  n_from_addresses.toString() + " houses.";
		msg += "(remaining " + remainingHouses.toString() + " houses)";
		console.log(msg);
		
		var house_index = {
			start : house_counter, 
			end   : house_counter + n_from_addresses};
			
		house_counter += n_from_addresses;
		
		var fromAddresses = [];
		var index_map = [];
		var valid_address_counter = 0;
		
		for(i = house_index.start; i < house_index.end; i++){
			
			var id   = houseData.ids[i];
			var addr = houseData.houses[id].address;
			
			if("travel_details" in houseData.houses[id] || typeof addr == "undefined"){
				index_map.push(-1);
				n_from_addresses--;
			}
			else{
				fromAddresses.push(addr);
				index_map.push(valid_address_counter++);
			}
		}
			
		if(fromAddresses.length > 0){
			
			var travelDetailsTransit = await gmaps.getTravelDetails(toAddresses, fromAddresses, "transit");
			var travelDetailsDriving = await gmaps.getTravelDetails(toAddresses, fromAddresses, "driving");
			//console.log(JSON.stringify(travelDetails,0,2));
			
			if(travelDetailsTransit.rows.length != n_from_addresses){
				console.log("Warning: there are unequal number of travel details and processed houses (in getAllTravelDetails())");
				console.log("\t n_to_addresses            = " + n_from_addresses);
				console.log("\t travelDetails.rows.length = " + travelDetailsTransit.rows.length);
			}
					
			var counter = 0;
			for(var i = house_index.start; i < house_index.end; i++){
				
				var j = index_map[counter++];
				
				var id = houseData.ids[i]
				houseData.houses[id].travel_details = {}			
				
				if(j >= 0){
					var tdTransit = getTravelDurationsAndDistances(travelDetailsTransit.rows[j]);
					var tdDriving = getTravelDurationsAndDistances(travelDetailsDriving.rows[j]);
					houseData.houses[id].travel_details.transit = tdTransit;
					houseData.houses[id].travel_details.driving = tdDriving;
				}
				else{
					houseData.houses[id].travel_details.transit = emptyTD;
					houseData.houses[id].travel_details.driving = emptyTD;
				}
			}	
		}
	}
	
}

function real(x){
	return Number.parseFloat(x).toFixed(2)
}
function time(s) {
	return new Date(s*1000).toISOString().slice(11, -5);
}

function readJSONfile(filepath){
	var data = fs.readFileSync(filepath);
	var jsonobj = JSON.parse(data);
	if(!("houses" in jsonobj)){
		jsonobj.houses = {};
	}
	if(!("ids" in jsonobj)){
		jsonobj.ids = [];
	}	
	return jsonobj;	
}

function writeJSONfile(obj, filepath){
	fs.writeFileSync(filepath, JSON.stringify(obj,0,2), 'utf-8');
	console.log("JSON data written to " + filepath);
}
function writeCSVfile(obj, filepath){
	
	var csvcontent = "id,url,address,price,area,";
	csvcontent += "time1 (transit),time1 (drive), dist1,";
	csvcontent += "time2 (transit),time2 (drive), dist2\n";
		
	for(var id of obj.ids){
		var el = obj.houses[id]
		
		var addr = el.address.replace(/,/g," ");
		csvcontent += (el.id 							+ ",");
		csvcontent += (el.url 							+ ",");
		csvcontent += (addr 							+ ",");
		csvcontent += (real(el.price/1.0e6) 			+ ",");
		csvcontent += (real(el.area) 					+ ",");
	
		csvcontent += (time(el.travel_details.transit.time1)		+ ",");
		csvcontent += (time(el.travel_details.driving.time1)		+ ",");
		csvcontent += (real(el.travel_details.driving.dist1/1000)   + ",");

		csvcontent += (time(el.travel_details.transit.time2)		+ ",");
		csvcontent += (time(el.travel_details.driving.time2)		+ ",");
		csvcontent += (real(el.travel_details.driving.dist2/1000)   + "");
		
		csvcontent+="\n";
		
	}	
		
	fs.writeFile(filepath, csvcontent, function (err) {
		if (err) return console.log(err);
		console.log("CSV data written to " + filepath);
	});
	
	
}

async function run(data_input){
	
	var search_url = base_url;	
	search_url += ("&radius=" 				+ Math.round(data_input.maxDistance * 1000));
	search_url += ("&price_collective_to=" 	+ data_input.maxPrice);
	search_url += ("&area_from=" 			+ data_input.minArea);
		
	console.log("RUN");
	var headless_state 	= true;
	const browser 		= await puppeteer.launch({headless: headless_state});
	const page 			= await browser.newPage({timeout: 0});
	
	maxPages = await getNumberOfPages(page, search_url);
	console.log("Max pages: " + maxPages.toString());
	
	var house_data = await getAllHouseLinksAndIDs(page, search_url, maxPages);
		
	console.log("Total houses: " + (house_data.ids.length).toString());
	
	var prevHouseData = readJSONfile("house_data.json");
	
	await getHousesDetails(page, house_data, prevHouseData);
	
	if(USE_GMAPS)
		await getAllTravelDetails(house_data, data_input.address1, data_input.address2);
	else
		setFakeTravelDetails(house_data.houses);
	
	var house_data_all = prevHouseData;
	for(var id of house_data.ids){
		
		if(!(id in house_data_all.houses)){			
			house_data_all.houses[id] = house_data.houses[id];
			house_data_all.ids.push(id);			
		}
		
	}
	
	writeJSONfile(house_data_all, "house_data.json");
	writeCSVfile(house_data, "locations.csv");
	
	//console.log(JSON.stringify(house_data.houses,0,2));
	browser.close();
	return house_data;
}


/*************************************************************
Temporary test function.
**************************************************************/
async function testFinnScrape1(){
	console.log("TEST START");
	var headless_state = true;
	const browser 	= await puppeteer.launch({headless: headless_state});
	const page 		= await browser.newPage();
	

	var test_url = "https://www.finn.no/realestate/homes/ad.html?finnkode=157668614";
	test_data = [];
	test_data[0] = {"id" : "0", "url" : test_url};
	await getHousesDetails(page, test_data);
	
	console.log(test_data);
	
	console.log("TEST END");
}

async function testFinnScrape2(){
	console.log("TEST START");
	var headless_state = true;
	const browser 	= await puppeteer.launch({headless: headless_state});
	const page 		= await browser.newPage();	

	var test_urls =[ 
		"https://www.finn.no/realestate/newbuildings/ad.html?finnkode=151176430", 
		"https://www.finn.no/realestate/newbuildings/ad.html?finnkode=156674333",
		"https://www.finn.no/realestate/newbuildings/ad.html?finnkode=133926055",
		"https://www.finn.no/realestate/newbuildings/ad.html?finnkode=147436380",
		"https://www.finn.no/realestate/homes/ad.html?finnkode=158406979",
		"https://www.finn.no/realestate/homes/ad.html?finnkode=158256567" 
		];
	
	
	var houses = [];
	for(var i = 0; i < test_urls.length; i++){
		var house = {"id" : "0", "url" : test_urls[i]};
		houses.push(house);
	}
	await getHousesDetails(page, houses);
	console.log(JSON.stringify(houses,0,2));
	console.log("Details map");
	console.log(details_map);

	var house_data = {"houses" : houses};
	writeToFile(house_data, "house_data.json");
	
	console.log("TEST END");
}


module.exports = {
	run:run	
}
//testFinnScrape2();
//run([800]);




