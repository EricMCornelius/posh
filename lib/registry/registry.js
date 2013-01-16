var glob = require('glob');
var async = require('async');
var path = require('path');

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

  var nodes = [];
  var processors = load_processors(args.root, args.pattern);

  this.nodes = nodes;
  this.register = function(node) {
    async.map(
      processors,
      function(processor, cb) {
        processor.process(node, cb);
      },
      function(err, results) {
        nodes.push(node);
      }
    );
  }
};

module.exports.registry = registry;