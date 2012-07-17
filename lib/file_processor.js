var glob = require('glob');

var path = require('path');



DepRegistry = new RegistryType();

add_dep = function(node) {
  DepRegistry.register_node(node);
};

// scan all subdirectories from root for *.dep files and add them to the DepRegistry
//
// dep files will have a dependency on the first .dep file found in a parent directory
// allowing subsequent processing to descend from the root and pass environment information
ScanDepFiles = function(root, cb) {
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
      add_dep({
        id: id,
        type: 'dep_file',
        deps: deps[id],
        file: id + '/.dep'
      });
    }

    add_dep({
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
ProcessDepFiles = function(cb) {
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
  DepRegistry.add_process_action(process);
  process_graph({
    registry: DepRegistry,
    cb: cb
  });
}
