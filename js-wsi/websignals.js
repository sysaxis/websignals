/**
 * Frontend implementation of websignals protocol using the dynamically
 * definable query/call structure.
 */

// defTree class
class defTree {
    constructor(handler, name, par_argv) {
        this.elems = {};
        this.handler = handler;
        this.name = name || "root";
        this.argv = Object.assign({}, par_argv);

        var This = this;
        var proxy = new Proxy({}, this);
        //var proxy = Proxy.create(this); // when using node-proxy for debugging

        // if root object return proxy
        if(!name) return proxy;
        else return function() {

            // definition mode (otherwise nav mode)
            if (!This.argv[This.name])
                This.argv[This.name] = arguments || {};
            
            return proxy;
        }
    }

    get(tgt, prop) {

        const fncSel = "$";
        const callSel = "$callable"

        if (~defTree.ownFunctions().indexOf(prop)) {
            var This = this;
            return function() {
                return defTree.prototype[prop].apply(This, arguments);
            } 
        }

        if (prop === callSel) 
            return this.callable;

        // caller property
        if (prop === fncSel && this.handler) {
            var This = this;
            var addr = Object.keys(This.argv).join('.');

            return function() {
                var args = arguments;
                var aE = args.length - 1;
                var cb = args[aE];
                
                if (typeof(cb) === "function") {
                    // callback based
                    var info = Object.assign({ addr }, args[aE - 1]);
                    This.handler.call(null, This.argv, info, cb);
                } else {
                    // promise based
                    var info = Object.assign({ addr }, cb);
                    return new Promise(function(res, rej) {
                        This.handler.call(null, This.argv, info, function(err, result) {
                            if (err) {
                                rej(err);
                                return;
                            }
                            res(result);
                        });
                    });
                }
            }
        }

        if (!this.elems[prop]) {
            this.elems[prop] = new defTree(this.handler, prop, this.argv);
        }
        return this.elems[prop];
    }

    set(tgt, prop, val) {
        
        var This = this;

        const argSel = "@";
        const extSel = "_";
        const fncSel = "$";

        // enable args definitions from Array
        if (prop === argSel && Array.isArray(val)) {
            var props = {};
            Object.keys(val).forEach(function(k) { props[k] = val[k]; });
            
            if (this.argv[this.name].length)
                throw new Error("Tree node's args already defined!");

            this.argv[this.name] = props;
            
            return true;
        }

        // enable definitions from Object
        if (prop === extSel && typeof(val) === "object") {

            function next(node, obj) {
                var _obj = obj.self();
                Object.keys(node).forEach(function(k) {
                    var n = node[k];
                    if (typeof(n) === "function") {
                        defTree.prototype.set.call(_obj, null, k, n);

                    } else if (k === argSel && Array.isArray(n)) {
                        defTree.prototype.set.call(_obj, null, k, n);

                    } else if (k === extSel &&  typeof(n) === "function") {
                        defTree.prototype.set.call(_obj, null, k, n);

                    } else if (k[0] === fncSel && typeof(n) === "function") {
                        defTree.prototype.set.call(_obj, null, k, n);

                    } else if (typeof(n) === "object") {
                        var child = defTree.prototype.get.call(_obj, null, k);
                        if (typeof(child) === "function") {
                            child = child();
                        }
                        next(n, child.self());

                    }  else {
                        throw new Error("Unexpected object");
                    }
                });
            }
            next(val, this);
            return true;
        }

        // enable passthrough function definitions
        if (prop === extSel && typeof(val) === "function") {
            function passThrough(args, cb) {

                return val.call(null, args, cb);

            }

            this._passThrough = passThrough;
            return true;
        }

        // end function
        if (typeof(val) === "function") {

            // set final function without args
            if (prop !== fncSel) {
                var fobj = defTree.prototype.get.call(this, null, prop);
                fobj = fobj();

                defTree.prototype.set.call(fobj.self(), null, fncSel, val);
                return true;
            }
        
            function callable(argvals, extras, callback) {
                // argvals must be a mapped args object
    
                if (!callback && typeof(extras) === "function")
                    callback = extras;
    
                var cbDone = false;
                function callableCb(result) {
                    if (cbDone) return;
                    callback(result);
                }
    
                var result = val.call(null, argvals, extras, callback);
                if (cbDone) return;
    
                if (defTree.isPromise(result))
                    return result.then(callableCb);
                else {
                    cbDone = true;
                    return result;
                }
            };
    
            this.callable = callable;
    
            return true;
        }
            
        throw new Error("Unknown selector / definition combination!");

    }

    self() {
        return this;
    }

    mapArgs(src, tgt) {
        var This = this;

        if (!tgt) tgt = {};
        var a = tgt;

        // compilation of the parameter object
        Object.keys(This.argv).forEach(function(tn) {
            var treevals = src[tn];
            if (!treevals) throw new Error("Defined arguments do not have corresponding values");
            // tree keys
            var defTreeKeys = Object.keys(This.argv[tn]);
            defTreeKeys.forEach(function(k) {
                var da = This.argv[tn][k]; // defined arg
                var av = treevals[k];   // arg value
                if (av === undefined) return;
                
                if (da[0] === '.')
                    a[tn + da.substr(1)] = av;
                else
                    a[da] = av;

                delete treevals[k];
            });
            
            // assing passthrough values
            var undefTreeKeys = Object.keys(treevals).filter(
                function(tn) { return !defTreeKeys.includes(tn); }
            );
            if (!undefTreeKeys.length) return;
            var passThroughVals = {};
            undefTreeKeys.forEach(function(k) { passThroughVals[k] = treevals[k]; });
            a[tn] = passThroughVals;
        });
        
        return a;
    }

    passThrough() {
        return this._passThrough;
    }

    static ownFunctions() {
        return ['self', 'mapArgs', 'passThrough'];
    }

    static isPromise(f) {
        return f && f.__proto__ && 
            Object.getOwnPropertyNames(f.__proto__).includes('then');
    }
}

window.defTree = defTree;

// Websignals Communication Layer
(function() {
    var connectionTypes = ["ws", "http"];
    const defaultPort = 8080;

    var isDebug = false;
    var log = console.log;

    var wscl = {
        req: function noop() {},
        qry: function noop(a, cb) { cb(); },
        onconnect: function noop() {}
    };

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
    function createHttp(port, path, qs) {
        // http implementation
        var url = "http://localhost:" + port + (path || "/") + (qs || "");

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
                if (!body) return; // ends the loop
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
    function createWebSocket(port, path, qs) {
        if (!window.WebSocket) return;

        var url = "ws://localhost:" + port + (path || "/") + (qs || "");

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
            socket.onopen = function() { cb(); wscl.onconnect(); };
            socket.onmessage = messageHandler;
            socket.onclose = function() { debug('socket closed'); };
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
        var port, path, qs;
        
        port = opts.port || defaultPort;
        path = opts.path || "";
        qs = opts.query ? ('?' + Object.keys(opts.query).map(
            function(k) { 
                return encodeURIComponent(k) + '=' + encodeURIComponent(opts.query[k]);
            }).join('&')) : ''
        isDebug = opts.debug || false;
        log = opts.log || console.log;


        if (opts.path && opts.path.length && opts.path[0] !== '/')
            throw new Error('Path must begin with "/"');

        createHttp(port, path, qs);
        createWebSocket(port, path, qs);

        if (!window.WebSocket || opts.mode === "http") {
            reconnect.http();
        } else {
            reconnect.ws();
        }
    };

    window.wscl = wscl;
})();

// Websignals Interface
(function() {

    if (!window.defTree) throw "Cannot initialize Websignals Interface: Missing defTree.js"

    if (!window.wscl) throw "Cannot initialize Websignals Interface: Make sure Websignals Communications Layer (wscl.js) is appended before wsi.js";

    const wsi = window.wsi = {};

    const logLevels = {
        debug: 20,
        info: 30,
        error: 50
    }

    const log = {
        debug: function noop() {},
        info:  function noop() {},
        error: function noop() {}
    }
    
    function createLogger(logger, loglvl, log) {
        if (!logger) logger = {};
        if (!loglvl) loglvl = 100;
        function createLog(type) {
            return function() {
                if (loglvl <= logLevels[type])
                    (console[type] || console.log).apply(null, arguments);
            }
        }
        Object.keys(logLevels).forEach(function(k) { log[k] = logger[k] || createLog(k) });
    }

    wsi.init = function(opts) {
        createLogger(opts.logger, opts.loglevel, log);

        window.wscl.init({
            http:   opts.http   || 80,
            ws:     opts.ws     || 8080,
            debug:  opts.debug  || false,
            path:   opts.path   || '/',
            query:  opts.query  || {},
            mode:   opts.mode   || null
        });
    }

    const wscl = window.wscl;

    function rawreq(j, cb) {
        var jstr = JSON.stringify(j);
        wscl.req(jstr, function(res) {
            cb(res);
        });
    }

    function callHandler(_, c, cb) {
        var call = {
            func: c.addr,
            args: _
        };

        function handle(callback) {
            rawreq(call, function(raw) {
                var body;
                try {
                    body = JSON.parse(raw);
                } catch (e) {
                    callback(e);
                    return;
                }
                callback(null, body);
            });
        }

        if (cb) // callback based
            handle(cb);
        else // promise based
            return new Promise(function(res, rej) {
                handle(function(err, result) {
                    if (err) return rej(err);
                    else return res(result);
                });
            });
    }

    var Def = wsi.Def = new defTree();
    
    wscl.qry = function(body, callback) {
        log.info('incoming message body', body);

        function cb(res) {
            log.debug('final result', res);
            try {
                var rawRes = JSON.stringify(res);
                callback(rawRes);
            } catch (e) {
                callback('{"error":"Returned value was not Object"');
            }
        }

        var q;
        try {
            q = JSON.parse(body);
        } catch(e) { 
            return cb({error: 'Invalid message body'});
        }

        var func = q.func || '';
        var args = q.args || {};
        var mappedArgs = {};

        if (typeof(func) !== "string")
            return cb({error: 'Function address must be string'});

        var addr = func.split('.').filter(function(a) { return a; });

        var node = Def;

        var k = -1;
        function nextBranch(cb) {
            // navigate / passthrough
            k++;
            var branch = addr[k];

            log.debug('branch', branch);

            node = node[branch];
            if (!node) return cb({error: 'Invalid function'});

            if (k < addr.length - 1) {
                node = node();
                if (!node) return cb({error: 'Invalid function'});    

                node.mapArgs(args, mappedArgs);

                var ptFunc = node.passThrough();
                if (ptFunc) {
                    log.debug('passthrough', branch);

                    var ptcbDone = false;
                    function ptfCb(passObj) {
                        if (ptcbDone) return;
                        ptcbDone = true;
                        if (!passObj)
                            return nextBranch(cb);
                        else
                            cb(passObj);
                    }
                    var passObj = ptFunc(mappedArgs, ptfCb);

                    if (ptcbDone) return;

                    if (defTree.isPromise(passObj)) {
                        return passObj.then(ptfCb);
                    } else {
                        return ptfCb(passObj);
                    }
                } else {
                    log.debug('no passthrough', branch);
                    // navigate
                    return nextBranch(cb);
                }
            } else {
                log.debug('final call', branch);

                // final call
                var cbDone = false;
                function fnCb(nr) {
                    if (cbDone) return;
                    cbDone = true;
                    cb(nr);
                }

                node = node(); // get the proxy
                node.mapArgs(args, mappedArgs);

                var callable = node.$callable;
                if(!callable)
                    return cb({error: 'Invalid function'});

                var result = callable(mappedArgs, fnCb);
                if (cbDone) return;

                if (defTree.isPromise(result)) {
                    return result.then(fnCb);
                } else if (result !== undefined) {
                    return fnCb(result);
                }

                return cb({error: 'Invalid function'});
            }
        }

        nextBranch(cb);
    };

    wsi.Qry = function() {
        return new defTree(callHandler);
    }

})();