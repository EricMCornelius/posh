require('node_extensions');

var glob = require('glob');
var async = require('async');
var path = require('path');
var util = require('util');
var assert = require('assert');
var uuid = require('uuid');
var mkdirp = require('mkdirp');
var fs = require('fs');

var serialize = require('../serialize').minify;
var plugin_loader = require('../plugin_loader');

var force = util.force;
var exists = util.exists;
var public = util.public;

function get_processors() {
  return plugin_loader.load(path.resolve(__dirname, 'processors'));
}

function registry(args) {
  args = args || {};

  var self = this;

  // optionally load nodes from file
  var nodes = (typeof args === 'string') ? read(args) : [];

  var processors = Object.values(get_processors());
  self.nodes = nodes;
  
  self.register = function(node) {
    node.id = node.id || node.env.id || uuid.v4();
    node.deps = node.deps || node.env.deps || [];

    async.map(
      processors,
      function(processor, cb) {
        processor.register(node, self, force(cb, 'in ' + processor.name));
      },
      function(err, results) {
        if (err) throw err;
        nodes.push(node);
      }
    );
  }

  self.read = read.bind(self);
  self.write = write.bind(self);
};

function read(file) {
  util.invalidate_module(file);
  return require(file).nodes;
}

function write(file) {
  mkdirp.sync(path.dirname(file));
  var preamble = fs.readFileSync(path.resolve(__dirname, '../preamble.js')).toString().replace(/\$\{POSH\}/g, __dirname + '/../..');
  fs.writeFileSync(file, preamble + 'var nodes = ' + serialize(this.nodes) + ';\nmodule.exports.nodes = nodes;\n\n');
}

var exports = [registry, {processors: get_processors()}];
public(exports, module);
