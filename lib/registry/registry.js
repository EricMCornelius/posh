var async = require('async');
var path = require('path');
var util = require('util');
var uuid = require('uuid');
var mkdirp = require('mkdirp');
var fs = require('fs');
var _ = require('lodash');

var serialize = require('../serialize').minify;
var plugin_loader = require('../plugin_loader');

var force = require('../utils').force;
var public_ = require('../utils').public;

function get_processors() {
  return plugin_loader.load(path.resolve(__dirname, 'processors'));
}

function registry(args) {
  args = args || {};

  var self = this;

  // optionally load nodes from file
  var nodes = _.isString(args) ? read(args) : [];

  var processors = _.values(get_processors());
  self.nodes = nodes;

  self.register = function(node) {
    node.id = node.id || node.env.id || uuid.v4();
    node.deps = node.deps || node.env.deps || [];

    async.map(
      processors,
      function(processor, cb) {
        processor.register(node, self, force(cb, 'in ' + processor.name));
      },
      function(err) {
        if (err) throw err;
        nodes.push(node);
      }
    );
  };

  self.read = read.bind(self);
  self.write = write.bind(self);
}

function read(file) {
  delete require.cache[file];
  return require(file).nodes;
}

function write(file) {
  mkdirp.sync(path.dirname(file));
  var preamble = fs.readFileSync(path.resolve(__dirname, '../preamble.js.tmpl')).toString().replace(/\$\{POSH\}/g, __dirname + '/../..');
  var str = preamble + 'var nodes = ' + serialize(this.nodes) + ';\nmodule.exports.nodes = nodes;\n\n';
  str = str.replace(/\\/g, '\\\\');
  fs.writeFileSync(file, str);
}

var exports = [registry, {processors: get_processors()}];
public_(exports, module);
