require('node_extensions');

var util = require('util');
var fs = require('fs');
var async = require('async');

var serialize = require('./serialize').minify;
var error = require('./errors');

var public = util.public;
var exists = util.exists;
var clone = util.clone;

var path = require('path');
var assert = require('assert');
var os = require('os');

// passed a set of node objects
// each node may have an id, list of deps,
// and any other arbitrary fields
function DependencyGraphType(nodes, onMissingDependency) {
  var self = this;

  self.on_missing_dependency = onMissingDependency || function(dep) {};

  self.nodes = nodes;
  self.node_map = {};

  // maps node id to dependents
  self.parents = {};

  // maps node id to dependencies
  self.children = {};

  // maps targets (outputs) to nodes
  self.target_map = {};

  reduce(self);
  generate_node_map(self);
  generate_target_map(self);
  generate_dependency_graph(self);
  transitive_reduction(self);
};

// remove all discarded nodes from the graph, and remap corresponding dependencies
function reduce(g) {
  // holds mapping of discarded node id to dependencies
  var discard_deps = {};

  // remove all discarded nodes
  g.nodes = g.nodes.filter(function(node) {
    if (!exists(node.deps))
      node.deps = [];

    if (node.discard) {
      discard_deps[node.id] = node.deps;
      return false;
    }
    return true;
  });

  // remove all collapsable nodes which only depend on discarded nodes
  g.nodes = g.nodes.filter(function(node) {
    if (node.collapse) {
      var check = node.deps.every(function(dep) {
        return (exists(discard_deps[dep]));
      });
      if (check)
        discard_deps[node.id] = node.deps;
      return !check;
    }
    return true;
  });

  // remap the dependencies for all nodes to eliminated discarded nodes
  g.nodes.forEach(function(node) {
    var new_deps = [];
    while (node.deps.length > 0) {
      var dep = node.deps.shift();
      var expansion = discard_deps[dep];
      if (exists(expansion))
        node.deps = node.deps.concat(expansion);
      else
        new_deps.push(dep);
    }
    node.deps = new_deps;
  });
}

// generate the node map for the graph, and check for duplicate node ids
function generate_node_map(g) {
  g.node_map = g.node_map || {};
  g.nodes.forEach(function(node) {
    // symlinks might wind up registering the same node multiple times under different roots
    if (node.id in g.node_map) {
      var other = g.node_map[node.id];

      var t1 = clone(node);
      var t2 = clone(other);
      delete t1.env;
      delete t2.env;

      t1.root = t2.root;
      assert.deepEqual(t1, t2, 'Duplicate node id: ' + node.id);
    }

    g.node_map[node.id] = node;
  });
};

// generate the output map for the graph, and check for duplicate outputs
function generate_target_map(g) {
  g.nodes.forEach(function(node) {
    if (!exists(node.target))
      return;

    var target = node.real_target || node.target;
    var target_path = path.resolve(node.root, target);

    if (target_path in g.target_map)
      throw new DuplicateTargetError({message: 'Duplicate target', target: target_path});

    g.target_map[target_path] = node.id;
  });
};

function generate_dependency_graph(g) {
  g.nodes.forEach(function(node) {
    g.parents[node.id] = [];
    g.children[node.id] = [];
  });

  g.nodes.forEach(function(node) {
    node.deps.forEach(function(dep) {
      if (!exists(g.node_map[dep])) {
        g.on_missing_dependency(dep);
        return;
      }

      g.children[node.id].push(dep);
      g.parents[dep].push(node.id);
    });
  });

  dag_assert(g);
  //generational_sort(g);
};

// assert that the graph is infact a DAG
function dag_assert(g) {
  var check_cycle = function(id, colors, trace) {
    if (!exists(trace))
      trace = [];

    trace.push(id);
    if (colors[id] === 'forward') {
      trace = trace.reverse();
      var front = trace.shift();
      var message = front;
      var cycle = [front];
      while(next = trace.shift()) {
        cycle.push(next);
        message += ' -> ' + next;
        if (next === front)
          throw new CycleError({message: message, cycle: cycle});
      }
    }

    colors[id] = 'forward';

    g.parents[id].forEach(function(id) {
      if (colors[id] !== 'back')
        check_cycle(id, colors, trace);
    });

    trace.pop();
    colors[id] = 'back';
  }

  var roots = g.nodes.filter(function(node){ return (node.deps.length === 0); });
  var colors = {};
  roots.forEach(function(root){ check_cycle(root.id, colors); });

  // if we have an independent cycle which
  // is not reachable from any root, then
  // it will exist in the node_map but not colors
  for (var x in g.node_map)
    if (!(x in colors))
      check_cycle(x, {});
}

// uses DAG property for efficient longest path calculation
// for every node in the dependency graph
function generational_sort(g) {
  // associate node id to remaining dependency count
  var counts = {};

  // generate array of nodes with out-degree 0
  g.nodes.forEach(function(node){ counts[node.id] = node.deps.length; });
  var active = g.nodes.filter(function(node){ return node.deps.length === 0; });

  // for a given generation with 0 out-degree
  // iterate over all nodes, decrementing parent node dependency counts
  // and appending to the subsequent generation if all deps are satisfied
  var process_generation = function(arr) {
    var output = [];
    while (arr.length > 0) {
      var next = arr.shift();
      g.parents[next.id].forEach(function(id) {
        --counts[id];
        if (counts[id] === 0)
          output.push(g.node_map[id]);
      });
    }
    return output;
  };

  // iteratively process all generations, and assign the results
  // for each to the graph object for subsequent build ordering
  g.generations = [];
  do {
    g.generations.push(active.map(function(node){ return node.id; }));
    active = process_generation(active);
  } while(active.length > 0)
};

// given a DAG, perform the transitive reduction
function transitive_reduction(g) {
  // holds map of generated edge id to [parent, child]
  var discarded = {};

  // depth-first recursive edge removal
  dfs = function(vertex0, child0) {
    g.children[child0].forEach(function(child) {
      if (g.children[vertex0.id].indexOf(child) !== -1) {
        // construct a unique key for this edge
        var key = vertex0.id + ' -> ' + child;

        // if we haven't already added this edge to the discard set
        // then insert it and continue with the dfs
        if (!exists(discarded[key])) {
          discarded[key] = [vertex0.id, child];
          dfs(vertex0, child);
        }
      }
      else {
        dfs(vertex0, child);
      }
    });
  };

  // remove unnecessary edges in transitive closure for each vertex
  g.nodes.forEach(function(vertex) {
    g.children[vertex.id].forEach(function(child) {
      dfs(vertex, child);
    });
  });

  // for each discarded edge, remove the child and parent table entries
  for (key in discarded) {
    var edge = discarded[key];
    g.children[edge[0]] = g.children[edge[0]].filter(function(child) {
      return (child != edge[1]);
    });
    g.parents[edge[1]] = g.parents[edge[1]].filter(function(parent) {
      return (parent != edge[0]);
    });
  }
  return g;
};

// visits all dependent nodes starting from root, executing cb at each location
function recursive_visit(g, node, cb) {
  node.deps.forEach(function(dep) {
    var dep = g.node_map[dep];
    if (exists(dep) && cb(dep) !== false)
      recursive_visit(g, dep, cb);
  });
};

// executes the graph
function execute(g, args, cb) {
  assert(exists(args.action), 'Must provide action to execute');

  action = args.action;
  concurrency = args.concurrency || os.cpus;
  begin = args.begin || function(node) {};
  end = args.end || function(node) {};
  error = args.error || function(err, node) {};
  cb = cb || function(err) {};

  // associate node id to remaining dependency count
  var counts = {};

  // generate array of nodes with out-degree 0
  var active = [];
  g.nodes.forEach(function(node) { 
    var deps = g.children[node.id].length;
    counts[node.id] = deps;
    if (deps === 0)
      active.push(node); 
  });
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
      begin(next);
      ++concurrent;

      function post_exec(err) {
        if (err)
          error(err, next);
        else
          end(next);
        --concurrent;

        // if all nodes are finished executing, call termination callback
        ++executed;
        if (executed === termination)
          return cb();

        var parents = g.parents[next.id];
        if (exists(parents)) {
          parents.forEach(function(id) {
            --counts[id];
            if (counts[id] === 0)
              active.push(g.node_map[id]);
          })
        }

        process_next();
      };

      if (typeof action === 'function')
        action(next, g, post_exec);
      else
        next[action](g, post_exec);

      process_next();
    }
  };

  process_next();
};

function write_graph(g, file) {
  // node_map is removed prior to serialization, and regenerated on deserialization
  var node_map = g.node_map;
  delete g.node_map;
  var preamble = fs.readFileSync(path.resolve(__dirname, 'preamble.js')).toString().replace(/\$\{POSH\}/g, __dirname + '/..');
  fs.writeFileSync(file, preamble + 'var graph = ' + serialize(g) + ';\nmodule.exports.graph = graph;\n\n');
  g.node_map = node_map;
};

function read_graph(file) {
  var graph = require(file).graph;
  generate_node_map(graph);
  return graph;
}

var exports = [{DependencyGraph: DependencyGraphType}, recursive_visit, transitive_reduction, execute, read_graph, write_graph];
public(exports, module);
