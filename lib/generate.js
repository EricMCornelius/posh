#!/usr/bin/env node

var fs = require('fs');
var path = require('path');

var scan = require('./scan').scan;
var serialize = require('./serialize').serialize;
var registry = require('./registry/registry').registry;

var node_registry = new registry();

scan(node_registry);

var preamble = path.resolve(__dirname, 'preamble.js');
var postamble = path.resolve(__dirname, 'postamble.js');
var output = path.resolve(__dirname, 'build.js');

process.on('exit', function() {
  var text = fs.readFileSync(preamble) + '\n\n' + 'var nodes = ' + serialize(node_registry.nodes) + '\n\n' + fs.readFileSync(postamble);
  fs.writeFileSync(output, text);
  fs.chmodSync(output, '777');
});