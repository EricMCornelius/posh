var util = require('util');
var events = require('events');
var fs = require('fs');

var glob = require('glob');
var assert = require('assert');
var path = require('path');
var async = require('async');

var gcc = require('../toolchains/gcc.js');
var utils = require('../utilities/utils.js');

require('./registry.js');
require('./dependency_graph.js');
require('../utilities/globals.js');

function BuildSystemType(args) {
  var self = this;
  self.registry = new RegistryType();
  self.build_files = new RegistryType();
  self.dependency_graph = null;

  self.register = BuildSystemType.prototype.register.bind(self);
  self.generate = BuildSystemType.prototype.generate.bind(self);
  self.build = BuildSystemType.prototype.build.bind(self);
  self.clean = BuildSystemType.prototype.clean.bind(self);

  self.graphviz = BuildSystemType.prototype.graphviz.bind(self);

  self.add_build_file = BuildSystemType.prototype.add_build_file.bind(self);
  self.process_node = BuildSystemType.prototype.process_node.bind(self);
  self.scan_build_files = BuildSystemType.prototype.scan_build_files.bind(self);
  self.process_build_files = BuildSystemType.prototype.process_build_files.bind(self);

  args = args || {};
  self.cache = {};
  self.updated = {};
  self.root = args.root;
  self.dotfile = args.dotfile || path.join(self.root, '.dot');
  self.dgraphfile = args.dgraphfile || path.join(self.root, '.dgraph');
  self.concurrency = args.concurrency || 4;
  self.cache_path = args.cache_path || path.join(self.root, '.cache');

  gcc.attach(self.registry);

  events.EventEmitter.call(self);
};

util.inherits(BuildSystemType, events.EventEmitter);

BuildSystemType.prototype.emit_dependency_graph = function(graph) {
  this.emit('dependency_graph', graph);
};

BuildSystemType.prototype.emit_file_graph = function(graph) {
  this.emit('file_graph', graph);
};

BuildSystemType.prototype.emit_begin_dependency = function(node) {
  this.emit('begin_dependency', node);
};

BuildSystemType.prototype.emit_end_dependency = function(node) {
  this.emit('end_dependency', node);
};

BuildSystemType.prototype.emit_fail_dependency = function(node) {
  this.emit('fail_dependency', node);
};

BuildSystemType.prototype.emit_graph_svg = function(svg) {
  this.emit('graph_svg', svg);
};

BuildSystemType.prototype.emit_clean = function() {
  this.emit('clean', {});
};

BuildSystemType.prototype.register = function(node) {
  this.registry.register_node(node);
};

BuildSystemType.prototype.add_build_file = function(node) {
  this.build_files.register_node(node);
};


BuildSystemType.prototype.graphviz = function(g) {
  var self = this;

  var dot = 'digraph {\n';
  var count = 0;
  var id_map = {};
  for (id in g.children) {
    id_map[id] = 'N' + (++count);
    dot += '  ' + id_map[id] + ' [id=' + id_map[id] + ' label="' + id + '"];\n';
  }

  for (id in g.children) {
    g.children[id].forEach(function(child_id) {
      dot += '  ' + id_map[id] + ' -> ' + id_map[child_id] + ' [id=' + id_map[id] + id_map[child_id] + '];\n';
    });
  }
  dot += '}';

  write(self.dotfile, dot, function() {
    launch({
      cmd: 'dot',
      args: [self.dotfile, '-Tsvg'],
      opts: {cwd: this.root}
    }, function(err, data) {
      self.emit_graph_svg({
        svg: data.stdout,
        id_map: id_map
      });
    });
  });
};

// execute the steps associated with this node
// and execute callback when finished
BuildSystemType.prototype.process_node = function(args) {
  args.ctx = {
    cache: this.cache,
    updated: this.updated,
    root: this.root
  };
  args.registry.process(args);
};

// run concurrent build with up to concurrency number of simultaneous executors
BuildSystemType.prototype.process_graph = function(args) {
  var self = this;

  callback = args.cb || function() {};
  registry = args.registry;
  g = args.g;
  begin = args.begin || function() {};
  end = args.end || function() {};
  fail = args.fail || function() {};

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
    if (concurrent >= self.concurrency)
      return;

    var next = active.shift();
    if (exists(next)) {
      begin(next);
      ++concurrent;

      self.process_node({
        graph: g,
        registry: registry,
        node: next,
        cb: function(err) {
          if (err) {
            next.error = err;
            fail(next, err);
          }
          else {
            end(next);
          }
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

// scan all subdirectories from root for *.dep files and add them to the DepRegistry
//
// dep files will have a dependency on the first .dep file found in a parent directory
// allowing subsequent processing to descend from the root and pass environment information
BuildSystemType.prototype.scan_build_files = function(cb) {
  var self = this;
  var root = self.root;

  glob.Glob(path.join(root, '**/.dep'), null, function(err, results) {
    // sort the .dep files lexicographically by directory
    // this ensures that all parent directory nodes will preceed child directory nodes
    results.sort(function(p1, p2){ return path.dirname(p1) > path.dirname(p2); });
    results = results.map(function(p) { return path.resolve(root, p); });

    // iterate through list of paths, and for each directory
    // set deps to the first dep file encountered iterating towards root
    // if nothing is found, set a dependency on the global dep file
    // TODO: improve efficiency
    var deps = {};
    results.forEach(function(p) {
      var dir = path.dirname(p);
      deps[dir] = [];
      var split = path.split(dir);
      while (split.length > 0) {
        split.pop();
        var joined = path.join_arr(split);
        if (joined in deps) {
          deps[dir].push(joined);
          break;
        }
        else if(joined === root) {
          break;
        }
      }
      if (deps[dir].length === 0)
        deps[dir].push('global');
    });

    // create nodes for each .dep file and add them
    // to the dependency registry
    for (var id in deps) {
      self.add_build_file({
        id: id,
        type: 'dep_file',
        deps: deps[id],
        file: id + '/.dep'
      });
    }

    self.add_build_file({
      id: 'global',
      type: 'dep_file',
      deps: [],
      file: path.join(__dirname, 'global.dep')
    });

    cb();
  })
};

// process the tree of *.dep files
//
// each .dep file inherits its parent environment and
// may pass a modified __env object to all its children
BuildSystemType.prototype.process_build_files = function(cb) {
  // map of .dep directory name to corresponding env
  // initialize with the 'global' environment
  envs = {
    'global': __env
  };

  // action to trigger for each dep_file node in the DepRegistry graph (tree)
  var process = {
    type: 'dep_file',
    exec: function(args) {
      var node = args.node;
      var graph = args.graph;
      var post = args.cb;

      if (node.id === 'global')
        return post();

      // look up the first .dep file detected
      // when iterating from current to root directory
      var dep = graph.children[node.id][0];

      // load the source code for this file, and before
      // executing it set the __file and __env markers
      // afterwards, save the environment back into the envmap
      // for this .dep file
      include({
        path: node.file,
        prerun: function() {
          __file = node.file;
          if (dep)
            __env = clone(envs[dep]);
        },
        postrun: function() {
          envs[node.id] = __env;
          post();
        }
      });
    }
  };

  // register the dep_file node processing action, and process the graph
  this.build_files.add_process_action(process);
  this.process_graph({
    registry: this.build_files,
    cb: cb,
    g: DependencyGraph(this.build_files.nodes)
  });
}

BuildSystemType.prototype.generate = function(cb) {
  var self = this;
  self.scan_build_files(function() {
    self.process_build_files(function() {
      // generate dependency graph
      var g = DependencyGraph(self.registry.nodes);

      // write the graph to disk asynchronously
      utils.cache(self.dgraphfile, g, function() { });

      // emit the dependency graph signal
      self.emit_dependency_graph(g);

      // clone and reduce the graph
      reduced = transitive_reduction(clone(g));

      // generate graphviz svg
      self.graphviz(reduced);

      // set dependency graph
      self.dependency_graph = g;
    });
  });
};

BuildSystemType.prototype.build = function(cb) {
  var self = this;
  utils.retrieve(self.cache_path, function(err, cache) {
    self.cache = err ? {} : cache;
    self.updated = {};
    self.process_graph({
      registry: self.registry,
      g: self.dependency_graph,
      cb: function() {
        utils.cache(self.cache_path, self.cache);
      },
      begin: function(node) { self.emit_begin_dependency(node); },
      end: function(node) { self.emit_end_dependency(node); },
      fail: function(node) { self.emit_fail_dependency(node); }
    });
  });
};

BuildSystemType.prototype.clean = function(cb) {
  var self = this;
  var targets = Object.keys(self.dependency_graph.target_map);

  async.forEach(
    targets,
    function(target, cb) {
      fs.unlink(target, cb);
    },
    function(err) {
      self.emit_clean();
    }
  );
};

BuildSystem = function(args) {
  __build_system = new BuildSystemType(args);
  return __build_system;
}

register = function(node) {
  __build_system.register(node);
};
