require('node_extensions');

var util = require('util');
var error = require('./errors');

var public = util.public;
var exists = util.exists;
var clone = util.clone;

var path = require('path');
var assert = require('assert');

// passed a set of node objects
// each node may have an id, list of deps,
// and any other arbitrary fields
function DependencyGraphType(nodes) {
  var self = this;

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
    node.deps.map(function(dep) {
      if (!exists(g.node_map[dep]))
        throw new Error("Unrecognized dependency: " + dep);

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
    if (cb(dep) !== false)
      recursive_visit(g, dep, cb);
  });
};

var exports = [{DependencyGraph: DependencyGraphType}, recursive_visit, transitive_reduction];

public(exports, module);
