var wrench = require('wrench');

var fs = require('fs');
var glob = require('glob');
var path = require('path');

require('../utilities/utils.js');


// the following functions provide actions to execute as the dependency
// graph is traversed during a build

// generate dependency information for .cpp files using g++ -MM
var dependencies = {
  type: 'dependency',
  exec: function(args) {
    var node = args.node;
    var g = args.graph;
    var cb = args.cb;

    var include_paths = {};
    recursive_visit(g, node, function(node) {
      if (node.type === 'publish') {
        include_paths[path.dirname(node.target)] = true;
      }
      else if(node.type === 'external') {
        node.include_path.forEach(function(p) {
          include_paths[p] = true;
        });
      }
    });

    var paths = [];
    for (p in include_paths)
      paths.push('-I' + p);

    var flags = node.compile_flags || [];

    var dep_func = function() {
      wrench.mkdirSyncRecursive(path.dirname(node.target));

      var dep_args = ['-c', node.source, '-MM'].concat(flags).concat(paths);
      launch({
        cmd: 'g++',
        args: dep_args,
        opts: {cwd: node.root}
      }, function(err, data) {
        var dep_info = data.stdout + '';

        // first element is the .o file target
        // second element is the .cpp source
        var split = dep_info.replace(/[\\\n]/g, '')
                            .split(' ')
                            .filter(empty);
        split.shift();

        var implicit_deps = split.map(function(dep) {
          return g.target_map[dep];
        });

        if (err) {
          console.log(data.stderr + '');
          throw (err);
        }

        cache(node.target, split, cb);
      });
    }

    var triggers = [node.source];
    var cache_file = path.join(node.__dir, '.cache');

    invalidate(cache_file, triggers, function(check) {
      if (check === true)
        dep_func();
      else
        cb();
    });
  }
};

// compile a source file after loading generated dependencies
var compile = {
  type: 'compile',
  exec: function(args) {
    var node = args.node;
    var g = args.graph;
    var cb = args.cb;

    var include_paths = {};
    recursive_visit(g, node, function(node) {
      if (node.type === 'publish') {
        include_paths[path.dirname(node.target)] = true;
      }
      else if(node.type === 'external') {
        node.include_path.forEach(function(p) {
          include_paths[p] = true;
        });
      }
    });

    var paths = [];
    for (p in include_paths)
      paths.push('-I' + p);

    var flags = node.compile_flags || [];

    // compile the compilation unit via g++
    var compile_func = function() {
      wrench.mkdirSyncRecursive(path.dirname(node.target));

      var compile_args = ['-c', node.source, '-o', node.target].concat(flags).concat(paths);

      launch({
        cmd: 'g++',
        args: compile_args,
        opts: {cwd: node.root}
      }, cb);
    };

    var load_triggers = function(file) {
      retrieve(file, function(err, triggers) {
        var cache_file = path.join(node.__dir, '.cache');

        invalidate(cache_file, triggers, function(check) {
          if (check === true)
            compile_func();
          else
            cb();
        });
      });
    };

    load_triggers(node.__depfile);
  }
};

// link a set of object files into a library or executable
var link = {
  type: 'link',
  exec: function(args) {
    var node = args.node;
    var g = args.graph;
    var cb = args.cb;

    var lib_paths = {};
    var lib_names = {};
    var obj_files = {};
    recursive_visit(g, node, function(node) {
      if (node.type === 'link') {
        lib_paths[path.dirname(node.target)] = true;
        lib_names[path.basename(node.target)] = true;
      }
      else if(node.type === 'compile') {
        obj_files[node.target] = true;
        return false;
      }
      else if(node.type === 'external') {
        node.lib_path.forEach(function(p) {
          lib_paths[p] = true;
        });
        node.libs.forEach(function(l) {
          lib_names[l] = true;
        });
      }
    });

    var paths = [];
    for (p in lib_paths)
      paths.push('-L' + p);

    var rpaths = [];
    for (p in lib_paths)
      rpaths.push('-Wl,-rpath,' + p);

    var libs = [];
    for (l in lib_names)
      libs.push('-l' + l);

    var objs = [];
    for (o in obj_files)
      objs.push(o);

    var target_dir = path.dirname(node.target);
    var target_name = path.basename(node.target);

    var flags = node.link_flags || [];
    if (node.subtype === 'shared') {
      flags.push('-shared');
      target_name = 'lib' + target_name + '.so';
    }

    var link_func = function() {
      var target = path.join(target_dir, target_name);
      wrench.mkdirSyncRecursive(path.dirname(target));

      var args = ['-o', target].concat(flags).concat(objs).concat(paths).concat(rpaths).concat(libs);

      launch({
        cmd: 'g++',
        args: args,
        opts: {cwd: node.root}
      }, cb);
    }

    var triggers = objs;
    var cache_file = path.join(node.__dir, '.cache');
    invalidate(cache_file, triggers, function(check) {
      if (check === true)
        link_func();
      else
        cb();
    });
  }
};

// copy an include file to an install location
var publish = {
  type: 'publish',
  exec: function(args) {
    var node = args.node;
    var cb = args.cb;

    var publish_func = function() {
      wrench.mkdirSyncRecursive(path.dirname(node.target));
      fs.copy(node.source, node.target, cb);
    };

    var cache_file = path.join(node.__dir, '.cache');
    var triggers = [node.source];

    invalidate(cache_file, triggers, function(check) {
      if (check === true)
        publish_func();
      else
        cb();
    });
  }
};

// register the processing actions for the toolset in the global registry
GlobalRegistry.add_process_action(dependencies);
GlobalRegistry.add_process_action(compile);
GlobalRegistry.add_process_action(link);
GlobalRegistry.add_process_action(publish);



// the following functions provide actions to execute as nodes are initially registered
// in the dependency graph during the traversal of .dep files
//
// these hooks allow for modifying registered nodes, as well as generating any implicit information


// generate nodes matching the subtype of the template from either a list of sources, or a glob
//
// nodes are generated by substiting fields from the list of sources
//into the target string of the template
var template = {
  type: 'template',
  exec: function(node) {
    if (typeof node.source === 'string')
      var sources = glob.sync(node.source, {cwd: node.src_root});
    else
      var sources = node.source;

    var deps = [];
    var count = 0;
    sources.forEach(function(src) {
      var info = path.info(src);
      var inst = clone(node);
      inst.source = path.resolve(inst.src_root, src);

      var replacements = {
        '${file}': info.file,
        '${ext}': info.ext,
        '${dir}': info.dir,
        '${base}': info.__dir,
        '${root}': inst.root
      };
      inst.target = replace(inst.target, replacements);

      inst.target = path.resolve(inst.target_root, inst.target);
      inst.id = inst.id + '/' + info.file + info.ext;
      inst.type = node.subtype;
      deps.push(inst.id);
      register(inst);
    });

    // template nodes don't actually have a source or target
    // and depend on all nodes they have generated
    delete node.source;
    delete node.target;
    node.deps = node.deps.concat(deps);
  }
};

// external dependencies which are not being built should
// contain lib_path, include_path, and libs for consumers to reference
var external = {
  type: 'external',
  exec: function(node) {
    node.lib_path = node.lib_path || [];
    node.include_path = node.include_path || [];
    node.libs = node.libs || [];
  }
};

// all nodes aside from template and external nodes should fully resolve their
// source and target paths
var general = {
  type: '*',
  exec: function(node) {
    if (node.type === 'template' || node.type === 'external')
      return;

    // resolve the source and target paths for the node
    node.source = path.resolve(node.src_root, node.source);
    node.target = path.resolve(node.target_root, node.target);
  }
};

// compilation nodes need to implicitly generate dependency information
// this creates a new node for a .d file alongside the .o
var compile_register = {
  type: 'compile',
  exec: function(node) {
    node.compile_flags = node.compile_flags || __env.compile_flags || [];

    var src = path.info(node.source);
    var target = path.info(node.target);

    var dep_node = clone(node);
    dep_node.target = target.join({ext: '.d'});
    dep_node.type = 'dependency';
    dep_node.id = node.id + '/dep';
    register(dep_node);

    node.deps = [dep_node.id];
    node.__depfile = dep_node.target;
  }
};

// link flags default to those defined in the __env during processing
// unless directly specified
var link_register = {
  type: 'link',
  exec: function(node) {
    node.link_flags = node.link_flags || __env.link_flags;
  }
};

// register the registration actions for the toolset in the global registry
GlobalRegistry.add_register_action(template);
GlobalRegistry.add_register_action(general);
GlobalRegistry.add_register_action(compile_register);
GlobalRegistry.add_register_action(link_register);
