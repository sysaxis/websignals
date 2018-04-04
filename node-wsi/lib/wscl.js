'use strict';

module.exports = init;

/**
 * Websignals Communication Layer for NodeJS.
 */

const WS = require('ws');
const MemoryStream = require('./streams').MemoryStream;

// { cid: { auth, send, activeMessages, cid, disconnect } }
const connections = {};

// activeMessages:
// { mid: {qy<Promise|function>, cb<function>} }

/**
 * Attaches WSCL to given server.
 * @param {*} server http server
 * @param {function|Promise} param1.onQuery Handler for incoming queries:
 * function(query<string>) { return response<string> }
 * @param {function|Promise} [param1.onAuth]
 * Provide for additional authentication during handshake. Return nothing if unauthorized.
 * function(params<object>) { return auth<object> }
 * @param {function} [param1.onError] Handler for errors.
 * @param {function} [param1.onClient] Callback for client connections
 * @param {function} [param1.onClientClosed] Callback for client disconnections. 
 * @param {*} [param1.log] Bunyan logger.
 * @param {Array<string>} param1.modes List of wscl modes from ("websocket", "http"). Defaults to "websocket".
 * @returns {{querer, onQuery, onError, onAuth, onClient, onClientClosed, log}} returns the passed options + querer function to be used when making calls to a specific client.
 */
function init(server, {
    querer,
    onQuery, onError, onAuth, onClient, onClientClosed,
    log, path, modes }) {

    if (!server) throw new Error("HTTP server must be specified");

    const opts = arguments[1];
    const keepAliveInterval = 30 * 1000; // 30 s

    function cl(m) {
        if (log) log.info(m);
    }
    function ce(m, args) {
        if (log) log.error(m, args);
    }

    /**
     * 
     * @param {*} cb (error<boolean>)
     */
    const authorize = function(req, cb) {

        var cid = req.cid = Math.random().toString(36).substr(2, 18);

        var params = getParams(req.url);

        if (!onAuth) {
            cb(true);
            return;
        }

        cl('authenticating ' + cid);

        function authorize(auth) {
            if (auth) {
                auth.cid = cid;
                req.auth = auth;
                cb(true);
                return;
            }

            cl('unauthorized: ' + cid);
            cb(false);
        }

        var authDone = false;
        function authCb(res) {
            if (authDone) return;
            authDone = true;
            authorize(res);
        }

        var authRes = onAuth(cid, params, authCb);
        if (authDone) return;

        if (isPromise(authRes))
            return authRes.then(authCb);
        else
            return authCb(authRes);
    };

    const initializers = {
        websocket: function() {
            const wss = new WS.Server({
                server,
                path: path || '/',
                verifyClient: function({origin, req, secure}, cb) {
                    authorize(req, function(authorized) {
                        if (authorized) return cb(true);
                        else cb(false, 401, "unauthorized");
                    });
                }
            });
        
            wss.on('listening', function() {
                cl('WS listening');
            });

            wss.on('connection',  function(ws, req) {

                var cid = req.cid;
        
                var connection = {
                    cid,
                    ws,
                    activeMessages: {},
                    auth: req.auth,
                    disconnect: function() {
                        delete connections[cid];
                        ws.close();
                    },
                    _lastTicks: +(new Date()),
                    _isAlive: true
                };

                connection.send = function(mid, m) {
                    var msg = compileMessage(mid, m);
                    try {
                        ws.send(msg);
                        connection._lastTicks = +(new Date());
                    } catch (e) {
                        ce(e, 'message not delivered')
                    }
                };

                connection.ping = function() {
                    try {
                        ws.send("BEEP");
                    } catch (e) {
                        connection._isAlive = false;
                        ce(e, 'ping failed');
                    }
                };
        
                ws.on('message', function(m) {
                    connection._lastTicks = +(new Date());
                    processMessage(connection, m);
                });

                ws.on('close', function() {
                    connection._isAlive = false;
                    processDisconnect(connection);
                });

                processConnection(connection, req);

            });
        },
        http: function() {

            function shouldHandle(req) {
                return req.url.startsWith(path) && 
                    ['OPTIONS', 'POST', 'GET', 'PUT'].includes(req.method);
            }

            function setDefaultHeaders(res) {
                res.setHeader("Access-Control-Allow-Origin", "*");
                res.setHeader("Access-Control-Expose-Headers", "id, session");
                res.setHeader("Access-Control-Allow-Headers", "id, session");
                res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT");
            }

            function httpResponse(res, code, message, id) {

                res._header = null;
                setDefaultHeaders(res);
                if (id) res.setHeader("id", id);

                res.on('error', function(err) {
                    ce('response error', err);
                });
        
                res.statusCode = code;

                var m = compileMessage(null, message);

                res.end(m);
            }

            server.on('request', function(req, res) {
                if (!shouldHandle(req)) return;

                // start pinging operation once connected
                // ping every 30 seconds such that new getter would be set
                // for queueResponder (i.e queueResponder refresh)
                // needs a frontend impl as well

                var method = req.method;
        
                if (method === "OPTIONS") {
                    return httpResponse(res, 200);
                }

                function _authorize() {
        
                    if (req.method !== "POST") {
                        return httpResponse(res, 401, "Invalid method for authorization!");
                    }
                    authorize(req, function(authorized) {
                        if (!authorized) {
                            return httpResponse(res, 401);
                        }
                        
                        const cid = req.cid;

                        var connection = {
                            cid,
                            activeMessages: {},
                            auth: req.auth,
                            queuedMessages: [],
                            queueResponder: null,
                            _lastTicks: +(new Date()),
                            _isAlive: true
                        };

                        connection.send = function(mid, m) {

                            // a message with mid has been added to
                            // activeMessages
                            // must run a looper that sends it once the
                            // next request of GET comes

                            // push to queued messages
                            // signal the queue reader

                            var res = connection.queueResponder;
                            if (!res)
                                connection.queuedMessages.push({
                                    id: mid, m
                                });
                            else {
                                httpResponse(res, 200, m, mid);
                                connection.queueResponder = null;
                            }
                        }

                        connection.disconnect = function() {
                            delete connections[cid];
                            // disconnect http looper querer
                            var res = connection.queueResponder;
                            if (res) {
                                httpResponse(res, 400, "DSC");
                            }
                        }

                        connection.ping = function() {
                            var res = connection.queueResponder;
                            if (res)
                                httpResponse(res, 200, "BEEP");
                        }
                        

                        processConnection(connection, req);
        
                        httpResponse(res, 200, cid);
                    });
                }
        
                var cid = req.headers['session'];
                if (!cid) return _authorize();
        
                var connection = connections[cid];
                if (!connection) return _authorize();
        
                res._header = true; // override for finalhandler

                cl('incoming #' + cid + ' ' + method);

                function handle(method, _body) {
                    var body = _body.toString('utf8');

                    switch (method) {
                        case "GET":
                            // handle for server -> client queries

                            req.connection.on('timeout', function() {
                                connection._isAlive = false;
                                connection.queueResponder = null;
                                processDisconnect(connection);
                            });

                            req.connection.on('close', function() {
                                connection._isAlive = false;
                                connection.queueResponder = null;
                                processDisconnect(connection);
                            });

                            connection._lastTicks = +(new Date());

                            // if queuedMessages has entries, then respond with them
                            // otherwise leave hanging

                            var queuedMessage = connection.queuedMessages.shift();
                            if (!queuedMessage) {
                                res._header = true;
                                connection.queueResponder = res;
                                return;
                            } else {
                                queueResponder = null;
                                httpResponse(res, 200, queuedMessage.m, queuedMessage.id);
                            }
                            break;
                        case "PUT":
                            // response for server -> client queries
                            var id = req.headers.id;
                            var message = "#" + id + "@" + body;
                            processMessage(connection, message);
                            httpResponse(res, 200);
                            break;
                        case "POST":
                            // client -> server query
                            var id = req.headers.id;
                            var message = "#" + id + "@" + body;
                            processMessage(connection, message, function(mid, qr) {
                                httpResponse(res, 200, qr, id);
                            });
                            break;
                    }
                }
        
                var ms = new MemoryStream();
        
                ms.readToEnd(function(buffer) {
                    handle(method, buffer.toString("utf8"));
                });
        
        
                req.on('error', function(err) {
                    ce('request error', err);
        
                    //delete ms;
                });
        
                req.pipe(ms);
        
            });
        }
    }


    /**
     * Only authenticated connections will pass here.
     */
    function processConnection(connection, req) {

        var cid = req.cid;

        connections[cid] = connection;
        cl('new connection: ' + cid);

        if (onClient) onClient(cid, connection.auth);

        startPingLoop(connection);
    }

    function processDisconnect(connection) {
        if (onClientClosed) onClientClosed(connection.cid, connection.auth);
    }

    /**
     * Processes message from a given connection
     */
    function processMessage(connection, message, response) {
        if (!message) return;

        var mStartPos = message.indexOf('@');
        if (message[0] !== '#' || mStartPos === -1) return;

        var mid = message.substring(1, mStartPos);
        var body = message.substring(mStartPos + 1);
        var activeMessages = connection.activeMessages;

        if (activeMessages[mid]) { // request's response

            var req = activeMessages[mid];
            delete activeMessages[mid];

            var messageCb = req.cb;
            messageCb(body);
        } else { // incoming request

            var cbDone = false;
            function onQueryCb(qr) {
                if (cbDone) return;
                cbDone = true;
                if (response)
                    response(mid, qr);
                else
                    connection.send(mid, qr);
            }
            var qr = onQuery(body, connection.auth, onQueryCb);

            if (cbDone) return;
            if (isPromise(qr))
                qr.then(onQueryCb);
            else if (qr) {
                onQueryCb(qr);
            }
        }
    }

    /**
     * Compiles the raw message string and passes it to handler
     * @param {*} mid message id
     * @param {*} m message
     */
    function compileMessage(mid, m) {
        if (typeof(m) === "object") {
            try { m = JSON.stringify(m); }
            catch(e) {
                ce(e, 'invalid object for message');
                return '{"error":"Unable to compile response!"}'; 
            }
        }

        return mid ? ('#' + mid + '@' + m) : m;
    }

    function startPingLoop(connection) {
        const looper = setInterval(function(connection) {
            return process.nextTick(function(connection) {
                if (!connection._isAlive) {
                    processDisconnect(connection);
                    clearInterval(looper);
                    return;
                }

                var ticks = +(new Date());
                var ticksDiff = ticks - connection._lastTicks;
                if (ticksDiff >= keepAliveInterval) {
                    connection._lastTicks = ticks;
                    connection.ping();
                }

            }, connection);
        }, keepAliveInterval, connection);

    }

    /**
     * Query handler (this will be called by server to send messages to specific client)
     * @param {string} cid connection id
     * @param {string} qy query
     * @param {function} cb query callback
     */
    function query(cid, qy, cb) {

        var connection = connections[cid];
        var mid = Math.random().toString(36).substr(2, 18);

        if (cb) {
            // callback based
            if (!connection) 
                return cb(new Error(`Connection '${cid}' not present`));
            
            function callback(result) {
                cb(null, result);
            }

            // set response handler
            connection.activeMessages[mid] = { qy, cb: callback };

            // send query signal
            try {
                connection.send(mid, qy);
            } catch (e) {
                delete connection.activeMessages[mid];
                cb(e);
            }
        } else {
            // Promise based
            return new Promise((res, rej) => {
                if (!connection) {
                    rej(new Error('Connection not present'));
                    return;
                }
                
                function callback(result) {
                    res(result);
                }
                
                // set response handler
                connection.activeMessages[mid] = { qy, cb: callback };

                // send query signal
                try {
                    connection.send(mid, qy);
                } catch (e) {
                    delete connection.activeMessages[mid];
                    rej(e);
                }
            });
        }
    }

    // assign query handler
    opts.querer = query;

    if (!modes) modes = ["websocket"];

    for(var mode of modes) {
        var init = initializers[mode];
        if (!init) throw new Error(`Mode '${mode}' does not exist in WSCL!`);
        init();
    }

    return opts;
}

function isPromise(f) {
    return f && f.__proto__ && Object.getOwnPropertyNames(f.__proto__).includes('then');
}

function getParams(raw) {
    var params;
    try {
        params = JSON.parse('{"' + raw
            .substr(raw.indexOf('?') + 1)
            .replace(/^\?/g, '')
            .replace(/"/g, '\\"')
            .replace(/&(?!amp;)/g, '","')
            .replace(/=/g,'":"') + '"}');
        Object.keys(params).forEach(param => {
            params[param] = decodeURIComponent(params[param]);
        });
        return params;
    } catch (e) {
        return {};
    }
}