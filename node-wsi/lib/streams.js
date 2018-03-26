"use strict";

const stream = require('stream');

/**
 * A duplex stream that reads/writes from memory.
 * A special function readToEnd() returns all the data in callback once flush() or end()
 * has been called by the data generator.
 * Use when data is not generated consistently (i.e. in Interprocess Communications)
 */
class MemoryStream extends stream.Duplex {

    constructor(options) {
        super(options);

        this.chunkSize = 4096;
        this.capasity = this.chunkSize;

        this.writePos = 0;
        this.wbufPos = 0;
        this.wbufInd = 0;

        this.readPos = 0;
        this.rbufPos = 0;
        this.rbufInd = 0;

        this.buffers = [];
        this.buffers.push(Buffer.alloc(this.chunkSize));
        this.writeDone = false;
    }

    _write(chunk, encoding, callback) {
        if (typeof(chunk) === 'string') chunk = Buffer.from(chunk, encoding);

        // check capasity and allocate if neccessary
        if (this.writePos + chunk.length > this.capasity) {
            var allocNeed = this.writePos + chunk.length - this.capasity;
            var allocLength = Math.ceil(allocNeed / this.chunkSize);
            for (var i = 0; i < allocLength; i++)
                this.buffers.push(Buffer.alloc(this.chunkSize));

            this.capasity += allocLength * this.chunkSize;
        }

        var chunkPos = 0;
        var remaining = chunk.length;
        var bufRoom;

        while (remaining > 0) {
            bufRoom = this.chunkSize - this.wbufPos;
            if (remaining >= bufRoom) {
                chunk.copy(this.buffers[this.wbufInd], this.wbufPos, chunkPos, chunkPos + bufRoom);
                remaining -= bufRoom;
                chunkPos += bufRoom;
                this.writePos += bufRoom;
                this.wbufInd++;
                this.wbufPos = 0;
            }
            else {
                chunk.copy(this.buffers[this.wbufInd], this.wbufPos, chunkPos, chunk.length);
                this.writePos += remaining;
                this.wbufPos += remaining;
                remaining = 0;
            }
        }

        callback();

        this._resumeRead(); 
    }

    flush() {
        this.writeDone = true;
        this._resumeRead();
        if (this.dataCallback) 
            this.dataCallback(Buffer.concat(this.buffers, this.writePos));
    }

    _resumeRead() {
        if (this._events.data && this._readableState.reading 
            && this.readPos <= this.writePos) {
            this._readableState.reading = false;
            this.read(0); 
        }
    }

    _read(size) {
        var remaining = size;
        if (this.readPos + size > this.writePos) 
            remaining = this.writePos - this.readPos;

        var bufRoom;

        while (remaining > 0) {
            bufRoom = this.chunkSize - this.rbufPos;
            if (remaining >= bufRoom) {
                this.push(this.buffers[this.rbufInd].slice(this.rbufPos));
                remaining -= bufRoom;
                this.readPos += bufRoom;
                this.rbufInd++;
                this.rbufPos = 0;
            }
            else {
                this.push(this.buffers[this.rbufInd].slice(this.rbufPos, this.rbufPos + remaining));
                this.readPos += remaining;
                this.rbufPos += remaining;
                remaining = 0;
            }
        }

        if (this.writeDone) this.push(null);
    }

    end() {
        this.flush();
    }

    readToEnd(callback) {
        if (this.writeDone)
            callback(Buffer.concat(this.buffers, this.writePos));
        else
            this.dataCallback = callback;
    }

}


/**
 * A passthrough stream that adds appendix to the data while passing through.
 */
class OutputStream extends stream.PassThrough {

    constructor(mods) {
        super();

        if (mods.appendix) {
            if (typeof(mods.appendix) === 'function') this.appendix = mods.appendix;
            else this.appendix = function() { return mods.appendix; };
        }
        
        if (mods.prependix) {
            if (typeof(mods.prependix) === 'function') this.prependix = mods.prependix;
            else this.prependix = function() { return mods.prependix; };
        }
    }

    _transform(data, encoding, callback) {
        if (this.prependix) this.push(this.prependix(data));
        this.push(data);
        if (this.appendix) this.push(this.appendix(data));
        callback();
    };
    
    writeToEnd(data) {
        this.write(data);
        this.end();
    }
}

module.exports = {
    MemoryStream: MemoryStream,
    OutputStream: OutputStream
}
