{
  "providers": [
    {
      "id": "miner",
      "name": "Miner XIX",
      "tagline": "Movy Multi-City 4K Server",
      "category": "movie_tv",
      "status": "available"
    },
    {
      "id": "headhunter",
      "name": "Headhunter XXXI",
      "tagline": "VidLink Server",
      "category": "movie_tv",
      "status": "available"
    },
    {
      "id": "valkyrie",
      "name": "Valkyrie VI",
      "tagline": "4K Ultra Multi-Server",
      "category": "movie_tv",
      "status": "available"
    },
    {
      "id": "hog_rider",
      "name": "Hog Rider XI",
      "tagline": "4K Pilled Server",
      "category": "movie_tv",
      "status": "available"
    },
    {
      "id": "lavahound",
      "name": "Lava Hound XII",
      "tagline": "4K Fast Multi-Server Stream",
      "category": "movie_tv",
      "status": "available"
    },
    {
      "id": "super_barbarian",
      "name": "Super Barbarian XVI",
      "tagline": "Direct Auto HLS Stream",
      "category": "movie_tv",
      "status": "available"
    },
    {
      "id": "bowler",
      "name": "Bowler XVIII",
      "tagline": "Multi-Language",
      "category": "movie_tv",
      "status": "available"
    },
    {
      "id": "titan",
      "name": "Titan VII",
      "tagline": "Films365 Direct MP4 1080p Server",
      "category": "movie_tv",
      "status": "available"
    }
  ]
}


[2026-10-17T22:13:15.287Z] [LOG] [diagnostic] post-start setImmediate fired
[2026-10-17T22:13:25.782Z] [LOG] [Anikoto] REQUEST TMDB=1218925 type=movie S1E1
[2026-10-17T22:13:27.232Z] [LOG] [Anikoto] HTTP 400 https://anikoto-nuvio.netlify.app/.netlify/functions/anime-lazy-mapping
[2026-10-17T22:13:27.232Z] [LOG] [registry] anikoto fetch duration 1451ms
[2026-10-17T22:13:39.515Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:39.515Z] extract.start {"tmdbId":"385687","mediaType":"movie","season":null,"episode":null}
[2026-10-17T22:13:39.516Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:39.516Z] lookup.start {"tmdbId":"385687","mediaType":"movie","season":1,"episode":1,"allowedServers":["Lisbon","Riga","Athens"]}
[2026-10-17T22:13:39.517Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:39.517Z] resolver.selected {"resolver":"https://cinejoy-phi.vercel.app"}
[2026-10-17T22:13:39.518Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:39.518Z] request.start {"requestId":1,"url":"https://cinejoy.pk","method":"GET"}
[2026-10-17T22:13:39.524Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:39.524Z] request.start {"requestId":2,"url":"https://api.themoviedb.org/3/movie/385687?api_key=8476a7ab80ad76f0936744df0430e67c&append_to_response=external_ids","method":"GET"}
[2026-10-17T22:13:40.082Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:40.082Z] request.response {"requestId":2,"url":"https://api.themoviedb.org/3/movie/385687?api_key=8476a7ab80ad76f0936744df0430e67c&append_to_response=external_ids","status":200,"ok":true,"elapsedMs":558,"contentType":"application/json;charset=utf-8"}
[2026-10-17T22:13:40.085Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:40.085Z] response.parsed {"requestId":2,"parser":"json","elapsedMs":561}
[2026-10-17T22:13:40.443Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:40.443Z] request.response {"requestId":1,"url":"https://cinejoy.pk/","status":200,"ok":true,"elapsedMs":925,"contentType":"text/html"}
[2026-10-17T22:13:40.457Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:40.456Z] request.start {"requestId":3,"url":"https://api.wing.st/servers","method":"GET"}
[2026-10-17T22:13:40.484Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:40.483Z] request.start {"requestId":4,"url":"https://subs.wing.st/subtitles?type=movie&tmdb=385687","method":"GET"}
[2026-10-17T22:13:40.504Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:40.504Z] request.start {"requestId":5,"url":"https://sub.vdrk.site/v1/movie/385687","method":"GET"}
[2026-10-17T22:13:40.511Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:40.511Z] request.start {"requestId":6,"url":"https://natsuki.hls.lol/subs?imdbId=tt5433140&season=1&episode=1","method":"GET"}
[2026-10-17T22:13:40.538Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:40.538Z] request.start {"requestId":7,"url":"https://opensubtitles-v3.strem.io/subtitles/movie/tt5433140.json","method":"GET"}
[2026-10-17T22:13:40.675Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:40.675Z] request.response {"requestId":7,"url":"https://opensubtitles-v3.strem.io/subtitles/movie/tt5433140.json","status":200,"ok":true,"elapsedMs":137,"contentType":"application/json; charset=utf-8"}
[2026-10-17T22:13:40.687Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:40.687Z] response.parsed {"requestId":7,"parser":"json","elapsedMs":149}
[2026-10-17T22:13:41.051Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:41.051Z] request.response {"requestId":3,"url":"https://api.wing.st/servers","status":200,"ok":true,"elapsedMs":595,"contentType":"application/json; charset=utf-8"}
[2026-10-17T22:13:41.057Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:41.057Z] response.parsed {"requestId":3,"parser":"json","elapsedMs":601}
[2026-10-17T22:13:41.088Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:41.088Z] request.response {"requestId":4,"url":"https://subs.wing.st/subtitles?type=movie&tmdb=385687","status":200,"ok":true,"elapsedMs":605,"contentType":"application/json; charset=utf-8"}
[2026-10-17T22:13:41.100Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:41.100Z] response.parsed {"requestId":4,"parser":"json","elapsedMs":617}
[2026-10-17T22:13:42.392Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:42.392Z] request.response {"requestId":6,"url":"https://natsuki.hls.lol/subs?imdbId=tt5433140&season=1&episode=1","status":200,"ok":true,"elapsedMs":1881,"contentType":"application/json; charset=utf-8"}
[2026-10-17T22:13:42.393Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:42.393Z] response.parsed {"requestId":6,"parser":"json","elapsedMs":1882}
[2026-10-17T22:13:43.038Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.038Z] request.response {"requestId":5,"url":"https://sub.vdrk.site/v1/movie/385687","status":200,"ok":true,"elapsedMs":2534,"contentType":"application/json; charset=utf-8"}
[2026-10-17T22:13:43.040Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.040Z] response.parsed {"requestId":5,"parser":"json","elapsedMs":2536}
[2026-10-17T22:13:43.043Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.043Z] sources.discovered {"domain":"https://cinejoy.pk","apiHost":"https://api.wing.st","servers":["Lisbon","Athens","Riga"],"subtitles":153}
[2026-10-17T22:13:43.049Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.049Z] server.start {"server":"Lisbon"}
[2026-10-17T22:13:43.050Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.050Z] request.start {"requestId":8,"url":"https://cinejoy-phi.vercel.app/api/stream?tmdb=385687&type=movie&server=Lisbon&season=1&episode=1&imdb=tt5433140&title=Fast%20X&year=2023","method":"GET"}
[2026-10-17T22:13:43.053Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.053Z] server.start {"server":"Athens"}
[2026-10-17T22:13:43.053Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.053Z] request.start {"requestId":9,"url":"https://cinejoy-phi.vercel.app/api/stream?tmdb=385687&type=movie&server=Athens&season=1&episode=1&imdb=tt5433140&title=Fast%20X&year=2023","method":"GET"}
[2026-10-17T22:13:43.054Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.054Z] server.start {"server":"Riga"}
[2026-10-17T22:13:43.055Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.055Z] request.start {"requestId":10,"url":"https://cinejoy-phi.vercel.app/api/stream?tmdb=385687&type=movie&server=Riga&season=1&episode=1&imdb=tt5433140&title=Fast%20X&year=2023","method":"GET"}
[2026-10-17T22:13:43.720Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.720Z] request.response {"requestId":10,"url":"https://cinejoy-phi.vercel.app/api/stream?tmdb=385687&type=movie&server=Riga&season=1&episode=1&imdb=tt5433140&title=Fast%20X&year=2023","status":200,"ok":true,"elapsedMs":665,"contentType":"application/json"}
[2026-10-17T22:13:43.721Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.721Z] resolver.response {"server":"Riga","status":200,"url":"https://cinejoy-phi.vercel.app/api/stream?tmdb=385687&type=movie&server=Riga&season=1&episode=1&imdb=tt5433140&title=Fast%20X&year=2023"}
[2026-10-17T22:13:43.757Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.757Z] response.parsed {"requestId":10,"parser":"json","elapsedMs":702}
[2026-10-17T22:13:43.847Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.847Z] request.start {"requestId":11,"url":"https://api.wing.st/g","method":"POST"}
[2026-10-17T22:13:43.874Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.874Z] request.response {"requestId":9,"url":"https://cinejoy-phi.vercel.app/api/stream?tmdb=385687&type=movie&server=Athens&season=1&episode=1&imdb=tt5433140&title=Fast%20X&year=2023","status":200,"ok":true,"elapsedMs":821,"contentType":"application/json"}
[2026-10-17T22:13:43.874Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.874Z] resolver.response {"server":"Athens","status":200,"url":"https://cinejoy-phi.vercel.app/api/stream?tmdb=385687&type=movie&server=Athens&season=1&episode=1&imdb=tt5433140&title=Fast%20X&year=2023"}
[2026-10-17T22:13:43.883Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.883Z] response.parsed {"requestId":9,"parser":"json","elapsedMs":830}
[2026-10-17T22:13:43.896Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:43.896Z] request.start {"requestId":12,"url":"https://api.wing.st/g","method":"POST"}
[2026-10-17T22:13:44.049Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.049Z] request.response {"requestId":8,"url":"https://cinejoy-phi.vercel.app/api/stream?tmdb=385687&type=movie&server=Lisbon&season=1&episode=1&imdb=tt5433140&title=Fast%20X&year=2023","status":200,"ok":true,"elapsedMs":1000,"contentType":"application/json"}
[2026-10-17T22:13:44.049Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.049Z] resolver.response {"server":"Lisbon","status":200,"url":"https://cinejoy-phi.vercel.app/api/stream?tmdb=385687&type=movie&server=Lisbon&season=1&episode=1&imdb=tt5433140&title=Fast%20X&year=2023"}
[2026-10-17T22:13:44.052Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.052Z] request.response {"requestId":11,"url":"https://api.wing.st/g","status":200,"ok":true,"elapsedMs":205,"contentType":"application/octet-stream"}
[2026-10-17T22:13:44.052Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.052Z] gateway.response {"server":"Riga","status":200,"url":"https://api.wing.st/g"}
[2026-10-17T22:13:44.063Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.063Z] server.complete {"server":"Riga","streams":0}
[2026-10-17T22:13:44.065Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.065Z] response.parsed {"requestId":8,"parser":"json","elapsedMs":1016}
[2026-10-17T22:13:44.071Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.071Z] request.start {"requestId":13,"url":"https://api.wing.st/g","method":"POST"}
[2026-10-17T22:13:44.087Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.087Z] request.response {"requestId":12,"url":"https://api.wing.st/g","status":200,"ok":true,"elapsedMs":191,"contentType":"application/octet-stream"}
[2026-10-17T22:13:44.087Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.087Z] gateway.response {"server":"Athens","status":200,"url":"https://api.wing.st/g"}
[2026-10-17T22:13:44.089Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.089Z] server.complete {"server":"Athens","streams":0}
[2026-10-17T22:13:44.564Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.564Z] request.response {"requestId":13,"url":"https://api.wing.st/g","status":200,"ok":true,"elapsedMs":493,"contentType":"application/octet-stream"}
[2026-10-17T22:13:44.565Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.564Z] gateway.response {"server":"Lisbon","status":200,"url":"https://api.wing.st/g"}
[2026-10-17T22:13:44.567Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.566Z] server.complete {"server":"Lisbon","streams":0}
[2026-10-17T22:13:44.567Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.567Z] lookup.complete {"streams":0}
[2026-10-17T22:13:44.567Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.567Z] extract.complete {"streams":0,"requests":13,"elapsedMs":5053}
[2026-10-17T22:13:44.567Z] [LOG] [CineJoyTV-1][2026-10-17T22:13:44.567Z] extract.end {"elapsedMs":5053}
[2026-10-17T22:13:44.567Z] [LOG] [registry] cinejoytv fetch duration 5054ms