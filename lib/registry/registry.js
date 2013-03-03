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

var force = util.force;
var exists = util.exists;
var public = util.public;

function load_processors(root, pattern) {
  root = root || path.resolve(__dirname, 'processors');
  pattern = pattern || '*.js';

  var processors = glob.sync(pattern, {cwd: root});
  var files = processors.map(async.apply(path.resolve, root));
  var modules = files.map(require);
  
  return modules;
}

function registry(args) {
  args = args || {};

  var self = this;

  // optionally load nodes from file
  var nodes = (typeof args === 'string') ? read(args) : [];

  var processors = load_processors(args.root, args.pattern);

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

function create_processor_map() {
  var processors = load_processors();
  var obj = {};
  processors.forEach(function(processor) {
    obj[processor.name] = processor;
  });
  return obj;
}

function read(file) {
  util.invalidate_module(file);
  return require(file).nodes;
}

function write(file) {
  mkdirp.sync(path.dirname(file));
  var preamble = fs.readFileSync(path.resolve(__dirname, '../preamble.js')).toString().replace(/\$\{POSH\}/g, __dirname + '/../..');
  fs.writeFileSync(file, preamble + 'var nodes = ' + serialize(this.nodes) + ';\nmodule.exports.nodes = nodes;\n\n');
}

var exports = [registry, {processors: create_processor_map()}];
public(exports, module);
