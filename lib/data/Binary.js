// Dependencies ---------------------------------------------------------------
// ----------------------------------------------------------------------------
var fs = require('fs'),
    path = require('path'),
    includeError = require('../Errors').IncludeError;


// Binary Includes ------------------------------------------------------------
// ----------------------------------------------------------------------------
function Binary(file, src, section, index) {

    this.file = file;

    if (src.charCodeAt(0) === 47) {
        this.src = path.join(this.file.compiler.base, src.substring(1));

    } else {
        this.src = path.join(path.dirname(this.file.path), src);
    }

    this.section = section;
    this.offset = -1;

    try {
        this.size = fs.statSync(this.src).size;

    } catch(err) {
        includeError(this.file, err, 'include binary data', this.src, index);
    }

    this.section.add(this);

}


Binary.prototype = {

    getBuffer: function() {
        return fs.readFileSync(this.src);
    },

    toJSON: function() {
        return {
            type: 'Binary',
            src: this.src,
            offset: this.offset,
            size: this.size
        };
    }

};


// Exports --------------------------------------------------------------------
module.exports = Binary;

