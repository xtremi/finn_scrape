const express 		= require('express');
const scraper 		= require('./scrape.js');
const path 			= require('path');
const bodyParser 	= require('body-parser');

//2020-10-02: these arguments are not used, they are not sent to index.html,
//			  which is where these values are taken from now.
var myArgs = process.argv.slice(2);
console.log("Arguments: ", myArgs);
var data_input = {};

if(myArgs.length > 0){ data_input.maxDistance 	= myArgs[0];}
else { data_input.maxDistance = 3000; }
if(myArgs.length > 1){ data_input.minArea 		= myArgs[1];}
else { data_input.minArea = 100; }
if(myArgs.length > 2){ data_input.maxPrice 	= myArgs[2];}
else { data_input.maxPrice = 4000000; }

data_input.address1 = "Helsfyr T-bane, Oslo, Norway";
data_input.address2 = "Stortinget T-bane, Oslo, Norway";


var app = express();
app.use(bodyParser.urlencoded({extended : true}));

app.get('/index.html', function(req, res){	
	res.sendFile(path.join(__dirname + '/index.html'));	
});
app.get('/styles.css', function(req, res){	
	res.sendFile(path.join(__dirname + '/styles.css'));	
});

app.get('/', function(req, res){
	res.redirect('index.html');
});

app.post('/run_finn_scrape', async function(req, res){	
	
	data_input = {
		address1 	: req.body.address1,
		address2 	: req.body.address2,
		maxDistance : req.body.maxDistance,
		minArea 	: req.body.minArea,
		maxPrice 	: req.body.maxPrice		
	}
	
	console.log("Received input:");
	console.log(JSON.stringify(data_input,0,2));
	
	console.log("START: app get run_finn_scrape");
	var time_start = new Date().getTime();
	var all_houses = await scraper.run(data_input);	
	var time_end   = new Date().getTime();
	res.json(all_houses);
	
	console.log("END  : app get run_finn_scrape");
	var time = new Date(time_end-time_start).toISOString().slice(11,-5);
	console.log("\t completed in " + time);
});

// Listen to port 5000
var server = app.listen(5000, function () {
	console.log('Dev app listening on port 5000!');
	//gmaps.testGMAPS();
	//scraper.testFinnScrape();
	//scraper.run();
});
server.timeout = 600000;


