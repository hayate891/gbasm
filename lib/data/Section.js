// Dependencies ---------------------------------------------------------------
// ----------------------------------------------------------------------------
var Label = require('./Label');


// ROM/RAM Sections -----------------------------------------------------------
// ----------------------------------------------------------------------------
function Section(file, name, segment, bank, offset) {

    this.file = file;
    this.name = name.value;

    this.segment = segment.value;
    this.offset = offset;
    this.bank = bank;

    this.bankOffset = 0;
    this.endOffset = 0;
    this.isRam = false;
    this.isRam = false;

    this.entries = [];

    // TODO check for overlapping entries across sections

    // Check for valid segment name
    if (Section.Segments.hasOwnProperty(this.segment)) {

        var segmentDefaults = Section.Segments[this.segment];

        // Default Bank
        if (this.bank === null && segmentDefaults.isBanked) {
            this.bank = 1;

        } else if (this.bank === null) {
            this.bank = 0;
        }

        // Check if the segment is banked
        if (this.bank > 0 && !segmentDefaults.isBanked) {
            // TODO fix column index in error message
            file.parseError(
                'section bank index on non-bankable section', null,
                name.line, name.col
            );

        // Check for negative bank indicies
        } else if (this.bank < 0) {
            // TODO fix column index in error message
            file.parseError(
                'negative bank index', null,
                name.line, name.col
            );

        // Check for max bank
        } else if (segmentDefaults.isBanked && (this.bank < 1 || this.bank > segmentDefaults.maxBank)) {
            // TODO fix column index in error message
            file.resolveError(
                'Section bank index out of range', 'Must be in range 1-' + segmentDefaults.maxBank,
                name.line, name.col
            );
        }


        // Set default offset if not specified
        if (this.offset === null) {

            // If we're in bank 0 we just use the base offset
            if (this.bank === 0) {
                this.bankOffset = 0;
                this.offset = segmentDefaults.baseOffset;

            // Otherwise we use the base offset + bank * bankSize
            // and also setup our bankOffset in order to correct label offsets
            } else {
                this.offset = segmentDefaults.baseOffset + this.bank * segmentDefaults.bankSize;
                this.bankOffset = this.offset - segmentDefaults.baseOffset;
            }

            // Caculate end of segment als data must lie in >= offset && <= endOffset
            this.endOffset = this.offset + segmentDefaults.size;

        // For sections with specified offsets we still need to correct for banking
        } else {

            if (this.bank === 0) {
                this.bankOffset = 0;
                this.endOffset = segmentDefaults.baseOffset + segmentDefaults.size;

                if (this.offset < segmentDefaults.baseOffset || this.offset > this.endOffset) {
                    // TODO fix column index in error message
                    file.resolveError(
                        'Section offset out of range', 'Must be in range ' + segmentDefaults.baseOffset + '-' + this.endOffset,
                        name.line, name.col
                    );

                }

            } else {

                var baseBankOffset = segmentDefaults.baseOffset + this.bank * segmentDefaults.bankSize;
                this.endOffset = segmentDefaults.baseOffset + this.bank * segmentDefaults.bankSize + segmentDefaults.size;
                this.bankOffset = this.offset - segmentDefaults.baseOffset - (this.offset - baseBankOffset);

                if (this.offset < baseBankOffset || this.offset > this.endOffset) {
                    // TODO fix column index in error message
                    file.resolveError(
                        'Section offset out of range', 'Must be in range ' + baseBankOffset + '-' + this.endOffset,
                        name.line, name.col
                    );
                }

            }

        }

        // Copy storage flags
        this.isRam = segmentDefaults.isRam;
        this.isRom = segmentDefaults.isRom;

        //console.log(this.name, this.segment, ' from ', this.offset.toString(16), ' to ' ,this.endOffset.toString(16), '( address base is', (this.offset - this.bankOffset).toString(16), ')');

    } else {
        file.parseError(
            'section name "' + this.segment + '"', 'one of ' + Section.SegmentNames.join(', '),
            segment.line, segment.col
        );
    }

}


// Section Definitions --------------------------------------------------------
Section.Segments = {

    HRAM: {
        baseOffset: 0xFF00,
        size: 0xFF,
        isRam: true,
        isRom: false,
        isBanked: false,
    },

    ROM0: {
        baseOffset: 0x0000,
        size: 0x7FFF,
        isRam: false,
        isRom: true
    },

    ROMX: {
        baseOffset: 0x4000,
        bankSize: 0x4000,
        maxBank: 128,
        size: 0x7FFF,
        isRam: false,
        isRom: true,
        isBanked: true
    },

    WRAM0: {
        baseOffset: 0xC000,
        size: 0x0FFF,
        isRam: true,
        isRom: false
    },

    WRAMX: {
        baseOffset: 0xD000,
        size: 0x0FFF,
        bankSize: 0x0000,
        maxBank: 8,
        isRam: true,
        isRom: false,
        isBanked: true
    }

};

Section.SegmentNames = Object.keys(Section.Segments).sort();


// Section Methods ------------------------------------------------------------
Section.prototype = {

    add: function(entry) {
        // TODO check if data.offset is in range of section
        // TODO check if data.offset + size is in range of section
        // TODO for data and instructions check if section can contain data
        // TODO for variables check if section is writable
        this.entries.push(entry);
    },

    calculateOffsets: function() {

        var offset = this.offset,
            labelOffset = this.bankOffset;

        this.entries.forEach(function(entry) {

            if (entry instanceof Label) {
                // Remove bank offsets when calculating label addresses
                entry.offset = offset - labelOffset;

            } else {
                entry.offset = offset;
                offset += entry.size;
            }

        });

    }
};


// Exports --------------------------------------------------------------------
module.exports = Section;
