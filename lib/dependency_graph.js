var error = require('../utilities/errors.js');

var path = require('path');

// passed a set of node objects
// each node may have an id, list of deps,
// and any other arbitrary fields
DependencyGraphType = function(nodes) {
  var self = this;

  self.nodes = nodes;
  self.node_map = {};

  // maps node id to dependents
  self.parents = {};

  // maps node id to dependencies
  self.children = {};

  // maps targets (outputs) to nodes
  self.target_map = {};

  generate_node_map(self);
  generate_target_map(self);
  generate_dependency_graph(self);
};

// generate the node map for the graph, and check for duplicate node ids
generate_node_map = function(g) {
  g.nodes.forEach(function(node) {
    if (node.id in g.node_map)
      throw new DuplicateIdError({message: 'Duplicate node id', id: node.id});

    g.node_map[node.id] = node;
  });
};

// generate the output map for the graph, and check for duplicate outputs
generate_target_map = function(g) {
  g.nodes.forEach(function(node) {
    if (!exists(node.target))
      return;

    var target_path = path.resolve(node.root, node.target);
    if (target_path in g.target_map)
      throw new DuplicateTargetError({message: 'Duplicate target', target: target_path});

    g.target_map[target_path] = node.id;
  });
};

generate_dependency_graph = function(g) {
  g.nodes.forEach(function(node) {
    if (!exists(node.deps))
      node.deps = [];

    g.parents[node.id] = [];
    g.children[node.id] = [];
  });

  g.nodes.forEach(function(node) {
    if (!exists(node.deps))
      node.deps = [];

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
dag_assert = function(g) {
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
generational_sort = function(g) {
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

// visits all dependent nodes starting from root, executing cb at each location
recursive_visit = function(g, node, cb) {
  node.deps.forEach(function(dep) {
    var dep = g.node_map[dep];
    if (cb(dep) !== false)
      recursive_visit(g, dep, cb);
  });
};

DependencyGraph = function(nodes) {
  return new DependencyGraphType(nodes);
}
