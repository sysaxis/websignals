"use strict"

/** 
    Object for used for dynamic definitions and function calls.
    
    Define a tree handler:
        function handler(args, addr, cb) {
            console.log(args);
            cb("1");
        }
    Initialize root object: 
        var tree = new deftree(handler);

    1) Using the tree for handling defined calls.
    Define branches:
        tree.branch1("param1").branch12("param2", ".param2") = function(_) {
            return _.param1 + ' ' + _.param2 + ' ' + _.branch12param2;
        }

    Define from an object:
        tree._ = {
            branch2: {
                "@": ["param3"],
                branch21: function(_, cb) {
                    cb(_.param3 + ' ' + _.uparam3);
                }
            }
        }

    Define a passthrough function, that can be used to modify the args object "_" before it is passed on to the final handler:
        tree.branch2()._ = function(_) {
            return { uparam3: _.param3.split().reverse().join() };
        }

    Once args are defined they can't be overwritten!

    Map raw args for the given node:
        var source = { branch1: { 0: "what" }, branch2: { 0: "is", 1: "up?" } };
        var mappedArgs = {};
        tree.branch1().mapArgs(source, mappedArgs);
    
    Value for mapped args: { param1: "what", param2: "is", branch12param2: "up?" }

    Call a defined branch:
        var return_value = tree.branch1().branch2(mappedArgs);

    2) Using the tree for dynamically constructing calls to undefined paths.
        tree.branch1("what").branch2("is", "up?").$(function (_) {
            // "_" value is same as "source" defined above
        });

    Branch handlers can return values directly, use callbacks or return Promises:

        tree.branch1("what").branch2("is up?").$(function(_, cb) {
            cb();
            // or return new Promise();
        });

    The tree cannot be used for both instances at the same time. Every instance stores
    the values of args given to every branch. Therefore for multiple use you must supply
    a new instance for every call constructor.
*/

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

        if (prop === callSel)  {
            return this.callable;
        }

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

module.exports = defTree;