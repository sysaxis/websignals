"use strict";

/**
 * Websignals Interface (WSI). Adds declarative functionality to Websignals Communication Layer.
 */

const wscl = require('./lib/wscl');
const utils = require('./lib/utils');
const defTree = require('./lib/defTree');

module.exports.create = create;

const logLevels = {
    debug: 20,
    info: 30,
    error: 50
}

function createLogger(logger, loglvl) {
    if (!logger) logger = {};
    if (!loglvl) loglvl = 100;
    function createLog(type) {
        return function() {
            if (loglvl <= logLevels[type])
                (console[type] || console.log).apply(null, arguments);
        }
    }
    const _logger = {};
    Object.keys(logLevels).forEach(k => _logger[k] = logger[k] || createLog(k));
    return _logger;
}

/**
 * Runs a WSI instance on a given server
 * @param {*} server 
 * @param {*} options WSI options (log, loglevel)
 * @returns {{Def, Qry}} dynamic definitions and caller object
 */
function create(server, options) {

    var opts = options || {};

    const log = createLogger(opts.logger, opts.loglevel);
    /**
     * deftree is used both in WSI backend to dynamically define endpoints
     * and in WSI frontend to dynamically call endpoints (without prior mapping)
     */
    const Def = new defTree();

    opts.onQuery = function(body, auth, callback) {
        log.info('incoming message body', body);

        var q;
        try {
            q = JSON.parse(body);
        } catch(e) { return {error: 'Invalid message body'}; }

        var func = q.func || '';
        var args = q.args || {};
        var mappedArgs = {};

        if (typeof(func) !== "string")
            return {error: 'Function address must be string'};

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
                            cb(passObj); // denied by passthrough
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

                var result = callable(mappedArgs, auth, fnCb);
                if (cbDone) return;

                if (defTree.isPromise(result)) {
                    return result.then(fnCb);
                } else if (result !== undefined) {
                    return fnCb(result);
                }

                if (callable.length < 3)
                    return cb({error: 'Invalid function'});
            }
        }

        function cb(res) {
            log.debug('final result', res);
            callback(res);
        }

        nextBranch(cb);
    }

    const wsil = wscl(server, opts);

    const querer = wsil.querer;

    const callHandler = function(_, c, cb) {
        log.info(c.addr + '@' + c.cid);

        var call = {
            func: c.addr,
            args: _
        };

        if (cb)
            return querer(c.cid, JSON.stringify(call), (err, res) => {
                if (err) log.error('call error', err);
                if (res) log.debug('call result', res);

                if (err)
                    return cb(err);
                else
                    try {
                        var body = JSON.parse(res);
                        cb(null, body);
                    } catch (e) {
                        cb(e);
                    }
            });
        else
            return querer(c.cid, JSON.stringify(call)).then(res => {
                return JSON.parse(res);
            });
    };

    const Qry = function() {
        return new defTree(callHandler);
    }

    return { Def, Qry };
}