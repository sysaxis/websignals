'use strict';

let http = require('http');
let express = require('express');
let wsi = require('../../node-wsi');
let port = 8080;

let app = express();

app.use('/api', function(req, res, next) {
    res.send('hi, api here!');
});

app.use('/test3', function(req, res, next) {
    var donothing = 1;
});

app.use(function(err, req, res, next) {
    console.error(err);
    res.status(500).send('ERROR');
});


let server = http.createServer(app);


let clid1 = "";

let wsiInstance = wsi.create(server, {
    isDebug: true,
    onAuth:  function(cid, auth, cb) {
        if (auth.token === '123') cb({
            user: 'Joe',
            acl: 'admin'
        });
    },
    onClient: function(cid, auth) {
        console.log('new connection', cid, auth.user);
        clid1 = cid;
    },
    path: '/wsi',
    loglevel: 10,
    modes: ['http', 'websocket']
});

const qry = module.exports.query = wsiInstance.Qry;
const def = module.exports.def = wsiInstance.Def;

// tests

def.BEEP = () => { return {messsage: "BOOP"}; };

def.reflect("obj").$ = (_) => {
    return _.obj;
};

var products = {};

def.product("id")._ = {
    add: {
        "@": ["product"],
        $: (_) => {
            if (products[_.id]) return {error: "already exists"};
            var newP = _.product || {};
            newP.id = _.id || Object.keys(products).length;
            products[newP.id] = newP;
            products[newP.id].subs = [];
            return newP;
        }
    },
    del: (_, cb) => {
        var delRes = delete products[_.id];
        cb({success: delRes});
    }
};

def.product().mod("product").$ = (_) => {
    products[_.id] = Object.assign(products[_.id], _.product);
    return products[_.id];
};

def.product()._ = (_) => {
    if (_.id == null || !(_.id > -1)) return;
    var p = products[_.id];
    _.product = p;
    if (!p) return {error: "no such product"};
}

def.product("id").sub(".Id", ".Prod")._ = {
    get: (_) => {
        return _.product.subs[_.subId] || 
            {error: "no such sub product"};
    },
    add: (_) => {
        var id = _.subId || _.product.subs.length;
        var subProd = _.subProd || {};
        subProd.createdAt = new Date().toISOString();
        _.product.subs[id] = subProd;
        return subProd;
    },
    list: (_) => {
        return new Promise(function(res, rej) {
            if (!_.product.subs.length) res({error: "no subproducts"})
            res(_.product.subs);
        });
    }
};

// although we can allow any set from function, just that the 
// args remains empty
def.product().subproducts("fromDate")._ = {
    list: (_) => {
        if (!_.fromDate) return [];
        var fromDate = new Date(_.fromDate);
        return _.product.subs.filter(c => new Date(c.createdAt) >= fromDate);
    }
};

def.tests().test1 = (_, auth, cb) => {
    console.log(auth);
    cb({message: "OK"});
    qry().tests().test2().$(auth, function(err, res) {
        console.log("tests.test2", res);
    });
};

def.tests().complex().$ = (_, auth, cb) => {
    cb({message: "testing complex"});
    qry().tests().test3(21).t31().$(auth, function(err, res) {
        console.log("tests.test3.t31", res);
    });
}

def.tests().loop("count").$ = (_, auth, cb) => {
    cb({count: _.count + 1});
    qry().tests().loop(_.count + 1).$(auth, function(err, res) {
        if (err) {
            console.log("loop error. stopping", err);
            return;
        }
        console.log("looped", res);
    });
}

server.listen(port, function() {
    console.log('Listening on port', port);
});


/**
 * For example, in client console, run:
 * wsi.Qry().BEEP().$(console.log)
 * 
 * wsi.Qry().tests().complex().$(console.log)
 * 
 * wsi.Qry().product().add({type: "kitchen"}).$(console.log)
 * wsi.Qry().product(0).sub(null, {name: "microwave", price: 200}).$add().$(console.log)
 * 
 */