apiKey = "AIzaSyCx4TAE6BQDwALfrJeuapxLDnryAWc9uhE"

var googleMapsClient = require('@google/maps').createClient({
  key: apiKey,
  Promise : Promise
});


async function getTravelDetails(to, from, travelMode){
	
	var req = {
		origins		   : from,
		destinations   : to,
		mode		   : travelMode,
		departure_time : Date.UTC(2020,10,12,7-2,30)/1000
	};
	//console.log(req);
	var results;
	await googleMapsClient.distanceMatrix(req)
		.asPromise()
		.then((response) => {
			results = response.json;
			console.log("got response");
		})
		.catch((err) =>{
			console.log("err");
			console.log(err);
		});	
	return results;
}

async function testGMAPS(){
	
	var from1 = "Trolldalsveien 24B, 0672 Oslo, Norway";
	var from2 = "Helsfyr T-bane, Oslo, Norway";
	var to1 = "Oslo, Jernbanetorget, T-bane";
	var to2 = "Stortinget, T-bane, Oslo";
	var to3 = "Tveita T-bane, Oslo";
	
	var origins = [from1, from2];
	var destinations = [to1, to2, to3];
	
	var res = await getTravelDetails(origins, destinations, "transit");
	console.log(JSON.stringify(res, 0, 2));
}


module.exports = {
	testGMAPS:testGMAPS,
	getTravelDetails:getTravelDetails
}




