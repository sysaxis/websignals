
# WebSignals 

*Dynamically declare and use Client <-> Server communication functionality.*


#### Features:
* Supports both WebSocket and HTTP.
* Can be used in parallel with express.
* Built in keep-alive system.
* Dynamically declarable and callable API logic.
* Can be used with Promises, callbacks or returns.
* Built-in authentication mechanism (debatable in practice).
* Enables parallel messaging.

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
		// auth object will contain any properties passed by the client in connection query
        if (auth.token === '123') cb({
            user: 'Joe',
            acl: 'admin'
        });
    },
    onClient: function(cid, auth) { // optional
        console.log('new connection', cid, auth.user);
    },
    onClientClosed: function(cid, auth) { // optional
        console.log('closed connection', cid, auth.user);
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
Once [websignals.js](https://github.com/sysaxis/websignals/blob/master/js-wsi/websignals.js) has been attached to window...
```javascript
wsi.init({
	secure: false, // if secure connetions should be used (optional, defaults to false)
	host: 'localhost:8080', // this is also the default value
	path: '/wsi',
    query: { // authentication query (this will be mapped to the auth object in server's onAuth callback)
        user: 10,
        token: '123'
    },
	mode: "websocket", // options: "websocket", "http", defaults to "websocket",
	onconnect: function(error) { } // (optional) will be called once connection succeeded or failed
});

var Def = wsi.Def;
var Qry = wsi.Qry;

// to forcefully terminate the connection call
wsi.disconnect();
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
Client-side endpoint handlers accept up to two arguments: _ (args object) and *callback*.
Server-side endpoint handlers accept *auth* as a second argument and *callback* as third.
The argument *auth* is used when making server -> client calls.

```javascript
// Simple client side endpoint.
wsi.Def.BEEP().$ = function(_, callback) { };
// Shorthand version when you don't need to specify parameters on the last node.
wsi.Def.BEEP = () => { };

// Server side
wsi.Def.BEEP().$ = function(_, auth, callback) { };

// Endpoint with predefined arguments.
wsi.Def.when("time", ".If").$ = function(_) {
	var a = _.time;
	var b = _.whenIf;
}

// Echo messages (server) to specific client endpoint.
wsi.Def.echo("message").$ = function(_, auth) {
	wsi.Qry().echos(_.message).$(auth, function(err, res) { });
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

