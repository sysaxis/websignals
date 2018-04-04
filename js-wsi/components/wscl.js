/**
 * Websignals Communication Layer connects to a custom WSCL server.
 * WSCL can utilize both HTTP and WebSocket standards where available.
 * Provides a basic async callback-based functionality for client <-> server requests.
 * Basically string in, string out.
 * Author: sysaxis (Eduard Kotov)
 * Licence: MIT
 */

(function() {
    var connectionTypes = ["ws", "http"];
    const defaultPort = 8080;

    var isDebug = false;
    var log = console.log;
    var connectionType = "ws";
    var messages = [];

    function debug() {
        if (isDebug) log.apply(this, arguments);
    }

    function uuid() {
        function part() {
            return Math.floor((1 + Math.random()) * 0x10000).toString(16);
        }
        return part() + '-' + part();
    }

    var reconnect = {
        ws: function noop() {},
        http: function noop() {}
    };

    var disconnect = {
        ws: function noop() {},
        http: function noop() {}
    }

    var wscl = {
        req: function noop() {},
        qry: function noop(a, cb) { cb(); },
        onconnect: function noop() {},
        ondisconnect: function noop() {},
        disconnect: function() {
            disconnect[connectionType]();
        }
    };

    wscl.reconnect = function(type) {
        
        if (!~connectionTypes.indexOf(type)) return;
        messages = [];

        // disconnect all others
        connectionTypes.filter(function(ct) { return ct !== type; }).forEach(function(ct) {
            disconnect[ct]();
        });

        reconnect[type]();
    };

    // http implementation (if ws not available)
    function createHttp(host, path, qs, secure) {
        // http implementation
        var url = (secure ? 'https://' : 'http://') + host + path + (qs || "");

        debug("using http");

        var isconnected = false;
        var session = null;
        var sentXhrs = [];

        function delXhr(xhr) {
            var ind = sentXhrs.indexOf(xhr);
            if (ind > -1) delete sentXhrs[ind];
        }

        function httpreq(method, id, plain, cb) {
            var xhr = new XMLHttpRequest();

            xhr.open(method, url);
            xhr.setRequestHeader("session", session);

            if (!cb) cb = function noop() {};
            if (id) xhr.setRequestHeader("id", id);

            xhr.onreadystatechange = function() {
                if (xhr.readyState === XMLHttpRequest.DONE && xhr.status === 400 && xhr.responseText === "DSC") {
                    cb(null);
                    delXhr(xhr);
                    return;
                }
                if (xhr.readyState !== XMLHttpRequest.DONE || xhr.status !== 200) return;
                
                var rid = xhr.getResponseHeader("id");
                cb(xhr.responseText, rid);
                delXhr(xhr);
            };
            xhr.onerror = function(ev, e) {
                debug('http_error@' + id);
                cb(null);
                delXhr(xhr);
            };

            sentXhrs.push(xhr);
            xhr.send(plain);
        }

        var receiveNext = function() {
            httpreq("GET", undefined, undefined, function(body, id) {
                if (!body) {
                    // ends the loop
                    wscl.ondisconnect();
                    return;
                }
                receiveNext();

                if (body === "BEEP") return; // keep-alive operation

                // query for answer
                wscl.qry(body, function(resp) {
                    // repond with answer
                    httpreq("PUT", id, resp);
                });

            });
        };

        function httpStop() {
            for(var k in sentXhrs) if (sentXhrs[k]) sentXhrs[k].abort();
            isconnected = false;
        }

        function httpStart() {
            debug("starting http");

            httpStop();

            wscl.req = function(plain, cb) {
                var id = uuid();
                httpreq("POST", id, plain, function(body, id) {
                    cb(body);
                });
            }
            
            if (!isconnected) {

                httpreq("POST", null, null, function(body, id) {
                    if (!body) {
                        debug("authentication unsuccessful");
                        wscl.onconnect({error: "unauthorized"});
                        return;
                    }
                    session = body;
                    debug("authenticated. session id " + session);

                    isconnected = true;
                    receiveNext();
                    wscl.onconnect();
                });
            }
        }

        reconnect.http = httpStart;
        disconnect.http = httpStop;

    };

    // websocket implementation (default)
    function createWebSocket(host, path, qs, secure) {
        if (!window.WebSocket) return;

        var url = (secure ? 'wss://' : 'ws://') + host + path + (qs || "");

        debug("using websocket");

        var socket = { close: function noop() {}, send: function noop() {} }; // empty construct

        
        function errorHandler(cb) {
            socket.onerror = function(err) {
                debug('socket error', err);
                cb(err);
            }
        }

        function send(message) {
            status(function(err) {
                if (err) return;
                socket.send(message);
            })
        }

        function messageHandler(ev) {
            var msg = ev.data || "";
            var msgBeginPos = msg.indexOf('@');
            if (msg[0] === 'B' && msg === 'BEEP') {
                return;
            }
            else if (msg[0] !== '#' || msgBeginPos == -1) {
                debug('invalid socket message', msg);
                return;
            }
            var id = msg.substring(1, msgBeginPos);
            var body = msg.substring(1 + msgBeginPos);
            
            var message;
            for (var k in messages) if (messages[k].id === id) { message = messages[k]; break; } 
            if (!message) { // incoming request

                setTimeout(function(id, body) {
                    wscl.qry(body, function(resp) {
                        send("#" + id + "@" + resp);
                    });
                }, 0, id, body);

            } else { // request's response
                message.cb(body);
            }
        }

        function init(cb) {
            socket.close();
            socket = new WebSocket(url);
            socket._opening = true;
            socket.onopen = function() {
                socket._opening = false;
                cb(); wscl.onconnect();
            };
            socket.onmessage = messageHandler;
            socket.onclose = function(ev) { 
                debug('socket closed');
                if (socket._opening) {
                    socket._opening = false;
                    wscl.onconnect({error: "unauthorized"});
                    return;
                }
                wscl.ondisconnect();
            };
            errorHandler(cb);
        }

        function status(cb) {
            if (socket.readyState === WebSocket.OPEN) return cb();
            init(cb);
        }

        function socketStop() {
            socket.close();
        }

        // start socket connection
        
        function socketStart() {
            debug("starting socket");

            socketStop(); // force close

            wscl.req = function(plain, cb) {
                var id = uuid();
                messages.push({
                    id: id,
                    cb: cb
                });
                send('#' + id + '@' + plain);
            }

            status(function(err) {
                if (isDebug) {
                    if (!err) debug('socket started');
                    else debug('socket not started', err.data);
                }
            });
    
        }

        reconnect.ws = socketStart;
        disconnect.ws = socketStop;
        
    };

    wscl.init = function (opts) {
        var host, path, qs, secure;
        
        host = opts.host || ("localhost:" + defaultPort);
        path = opts.path || defaultPort;
        qs = opts.query ? ('?' + Object.keys(opts.query).map(
            function(k) { 
                return encodeURIComponent(k) + '=' + encodeURIComponent(opts.query[k]);
            }).join('&')) : '';
        secure = opts.secure || false;
        isDebug = opts.debug || false;
        log = opts.log || console.log;

        if (typeof(opts.onconnect) === "function")
            wscl.onconnect = opts.onconnect;

        if (typeof(opts.ondisconnect) === "function")
            wscl.ondisconnect = opts.ondisconnect;

        if (opts.path && opts.path.length && opts.path[0] !== '/')
            throw new Error('Path must begin with "/"');

        createHttp(host, path, qs, secure);
        createWebSocket(host, path, qs, secure);

        if (!window.WebSocket || opts.mode === "http") {
            connectionType = "http";
            reconnect.http();
        } else {
            connectionType = "ws";
            reconnect.ws();
        }
    };

    window.wscl = wscl;
})();