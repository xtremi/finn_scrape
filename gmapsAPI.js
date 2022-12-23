const gmapskey = require('./gmapskey.js');
console.log(gmapskey.apiKey)

var googleMapsClient = require('@google/maps').createClient({
  key: gmapskey.apiKey,
  Promise : Promise
});

/**
 * /
 * @param {Array<String>} to Addresses to
 * @param {Array<String>} from Addresses from
 * @param {String} travelMode "transit" or "driving"
 * @param {integer} dateUTCms
 */
async function getTravelDetails(to, from, travelMode, dateUTCms){
	
	var req = {
		origins		   : from,
		destinations   : to,
        mode           : travelMode,
        departure_time : dateUTCms / 1000
		//departure_time : Date.UTC(2020,11,16,7-1,30)/1000
	};
	//console.log(req);
	var results;
	await googleMapsClient.distanceMatrix(req)
		.asPromise()
		.then((response) => {
			results = response.json;
			console.log("got response (" + travelMode + ")");
		})
		.catch((err) =>{
			console.log("err (" + travelMode + ")");
			console.log(err);
		});	
	return results;
}


module.exports = {
	getTravelDetails:getTravelDetails
}




