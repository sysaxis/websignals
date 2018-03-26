"use strict";

module.exports = {
    mapDef,
    mapDefAsString,
    isPromise
}

/**
 * Maps the definitions for client side import.
*/
function mapDef(def) {
    var map = {};
    function iter(src, dst) {
        Object.keys(src).forEach(k => {
            dst[k] = {};
            if (typeof(src[k]) === "function") dst[k]._func = true;
            else iter(src[k], dst[k]);
        });
    }
    iter(def, map);
    
    return JSON.stringify(map);
}

/**
 * Maps the definitions into human readable string.
 */
function mapDefAsString(def) {
    var map = "";
    var newLine = "\r\n";
    var pad = Array(4).join(' ');
    var prepends = [];
    function iter(node, name, isLast) {
        if (isLast)
            map += prepends.slice(0, prepends.length - 1).join('') + pad + '└';
        else
            map += prepends.join('');

        map += "──> " + name + newLine;

        var children = Object.keys(node);
        
        children.forEach((k, i) => {
            var child = node[k];
            var isLastChild = i === children.length - 1;
            prepends.push(isLastChild ? (pad + " ") : (pad + "│"));
            iter(child, k, isLastChild);
            prepends.pop();
        });
    }

    iter(def, "root");
    return map;
}

function isPromise(f) {
    return f && f.__proto__ && Object.getOwnPropertyNames(f.__proto__).includes('then');
}
