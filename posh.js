var glob = require('glob');
var assert = require('assert');
var path = require('path');

require('./lib/registry.js');
require('./lib/dependency_graph.js');
require('./lib/file_processor.js');
require('./utilities/utils.js');
require('./utilities/globals.js');

GlobalRegistry = new RegistryType();

register = function(node) {
  node.__file = path.basename(__file);
  node.__dir = path.dirname(__file);
  node.root = path.resolve(node.__dir, node.root);
  node.src_root = node.src_root || '';
  node.target_root = node.target_root || '';
  node.deps = node.deps || [];
  node.src_root = path.resolve(node.root, node.src_root);
  node.target_root = path.resolve(node.root, node.target_root);
  GlobalRegistry.register_node(node);
};

// execute the steps associated with this node
// and execute callback when finished
process_node = function(args) {
  args.registry.process(args);
};

// run concurrent build with up to concurrency number of simultaneous executors
process_graph = function(args) {
  // default to 4 concurrent actions
  concurrency = args.concurrency || 4;
  registry = args.registry;
  callback = args.cb || function() {};

  // if g isn't defined, load from the registry
  g = args.g || DependencyGraph(registry.nodes);

  // associate node id to remaining dependency count
  var counts = {};

  // generate array of nodes with out-degree 0
  g.nodes.forEach(function(node){ counts[node.id] = node.deps.length; });
  var active = g.nodes.filter(function(node){ return node.deps.length === 0; });
  var concurrent = 0;

  // tracks the number of nodes which have finished execution
  var executed = 0;
  var termination = g.nodes.length;

  var process_next = function() {
    // if concurrency has been exceeded, ignore this invocation
    if (concurrent >= concurrency)
      return;

    var next = active.shift();
    if (exists(next)) {
      ++concurrent;

      process_node({
        registry: registry,
        graph: g,
        node: next,
        cb: function(err) {
          --concurrent;

          // if all nodes are finished executing, call termination callback
          ++executed;
          if (executed === termination)
            return callback();

          g.parents[next.id].forEach(function(id) {
            --counts[id];
            if (counts[id] === 0)
              active.push(g.node_map[id]);
          });

          process_next();
        }
      });

      process_next();
    }
  };

  process_next();
};

function initialize(args) {
  console.log(args);
}

function build(root, cb) {
  ScanDepFiles(root, function() {
    ProcessDepFiles(function() {
      process_graph({
        registry: GlobalRegistry,
        cb: function() {
          //console.log(this.g);
          //console.log(cache_files);
          save_cache_files(function(){});
        }
      });
    });
  });
};

var gcc = require('./toolchains/gcc.js');

exports.initialize = initialize;
exports.build = build;