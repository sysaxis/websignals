
# WebSignals 

*Declare Client<>Server communication functionality  on both Client and Server side.*


#### Features:
* Supports both WebSocket and HTTP.
* Can be used in parallel with express.
* Built -n keep-alive system.
* Dynamically declarable and callable API logic.
* Can be used with Promises, callbacks or returns.
* Built-in authentication mechanism (debatable in practice).

#### In-development:
* Automatic reconnection.
* Server-side in NET Standard (incomplete).

## Usage (NodeJS)
```javascript
let http = require('http');
let express = require('express');

let app = express();
let server = http.createServer(app); // or aquire server somehow

let ws = require('websignals');

// Attach websignals to a server.
let wsi = ws.create(server, {
    onAuth:  function(cid, auth, cb) { // optional
        if (auth.token === '123') cb({
            user: 'Joe',
            acl: 'admin'
        });
    },
    onClient: function(cid, auth) { // optional
        console.log('new connection', cid, auth.user);
    },
    path: '/wsi',
    modes: ['http', 'websocket'] // optional (defaults to websocket)
});

// Declare an endpoint.
wsi.Def.BEEP().$ = function(_, callback) {
	// handle query:
	callback({message: "BOOP"});
	// or
	return {messsage: "BOOP"};
	// or
	return new Promise((res, rej) => {
		res({message: "BOOP"});
	});
};

// Call an endpoint on client.
wsi.Qry().areYouThere().$({cid: "connection id"}, function(err, res) {
	// handle response
});
```
## Usage (web)
```javascript
// Once websignals.js has been attached to window...
wsi.init({
    http: 80, // defaults to 8080
    path: '/wsi',
    query: { // authentication query
        user: 10,
        token: '123'
    },
    mode: "websocket" // options: "websocket", "http", defaults to "websocket"
});

var Def = wsi.Def;
var Qry = wsi.Qry;
```
## Making API calls
```javascript
// This is a dynamic query builder.
// A query can be constructed from the object that it returns.
const Qry = wsi.Qry;

// Server-side:
Qry().node1("var1", 2).node2("var21", {}).$({cid: "connection id"}, function(err, res) {
	// handle response
});

// Client-side:
Qry().node1("var1", 2).node2("var21", {}).$(function(err, res) { });
```
## Declaring endpoints
```javascript
wsi.Def.BEEP().$ = function(_, callback) { };
// Same as above.
wsi.Def.BEEP = () => { };

// Endpoint with predefined arguments.
wsi.Def.when("time", ".If").$ = function(_) {
	var a = _.time;
	var b = _.whenIf;
}

// Define a passthrough function.
wsi.Def.why("explanation")._ = (_) => {
	// modify arguments (will be passes on to the handler)
	_.explanationOK = true;
	// returning anything will be counted as query response
	// and the call tree will stop here
	return { error: "This explanation won't suffice." };
}

// Using the arguments after passthrough.
// No need to define the argument "explanation" again, this will have no effect.
wsi.Def.why().what("info").$ = (_, cb) => {
	var isOk = _.explanationOK;
	var info = _.info;
	cb({ message: "Alright then."});
};

// Defining endpoints from Object.
wsi.Def = {
	node1: {
		'@': ['.a'],
		_: function(_) {
			// handle passthrough
		}
		node2: {
			'@': ["a", "b"]
			$: function(_) {
				var a = _.node1a,
					b = _.a,
					c = _.b;
			}
		}
	}
}
```

