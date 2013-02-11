var glob = require('glob');
var async = require('async');
var path = require('path');
var util = require('util');
var assert = require('assert');

var force = util.force;
var exists = util.exists;

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
  var nodes = [];
  var processors = load_processors(args.root, args.pattern);

  self.nodes = nodes;
  self.register = function(node) {
    assert(exists(node.id), "Node must specify an id");
    node.deps = node.deps || [];

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
};

function create_processor_map() {
  var processors = load_processors();
  var obj = {};
  processors.forEach(function(processor) {
    obj[processor.name] = processor;
  });
  return obj;
}

module.exports.registry = registry;
module.exports.processors = create_processor_map();