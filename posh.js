#!/usr/bin/env node

var posh = require('./lib/actions').posh;

var name = process.argv[2];
posh(name);
