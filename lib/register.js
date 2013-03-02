#!/usr/bin/env node

require('node_extensions');

var fs = require('fs');
var path = require('path');
var async = require('async');
var mkdirp = require('mkdirp');

var scan = require('./scan').scan;
var serialize = require('./serialize').serialize;
var registry = require('./registry/registry').registry;

var node_registry = new registry();

var output = path.resolve(process.cwd, '.posh/nodes.gen');

scan(node_registry);

process.on('exit', function() {
  mkdirp.sync(path.dirname(output));
  var preamble = fs.readFileSync(path.resolve(__dirname, 'preamble.js')).toString();
  fs.writeFileSync(output, preamble + 'var nodes = ' + serialize(node_registry.nodes) + ';\nmodule.exports.nodes = nodes;\n\n');
});