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
            secure: opts.secure || false,
            host:   opts.host   || null,
            path:   opts.path   || '/',
            query:  opts.query  || {},
            debug:  opts.debug  || false,
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