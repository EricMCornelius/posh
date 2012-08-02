var wrench = require('wrench');
var glob = require('glob');

var fs = require('fs');
var path = require('path');

var utils = require('../utilities/utils.js');

// invalidate file hashes to determine changed files
// if dependent files have changed or the target file doesn't exist
// trigger a rebuild... otherwise execute the callback
var invalidate = function(ctx, triggers, target, exec, cb) {
  var triggers = triggers.map(function(trigger) {
    if (trigger.indexOf(ctx.root) === 0)
      return trigger.slice(ctx.root.length + 1);
  });

  var invalidate_func = function(err, rebuild) {
    if (err)
      return cb(err);

    if (rebuild) {
      exec();
    }
    else {
      fs.exists(target, function(exists) {
        exists ? cb() : exec();
      });
    }
  };

  utils.invalidate({
    cache: ctx.cache,
    updated: ctx.updated,
    root: ctx.root,
    triggers: triggers,
    cb: invalidate_func
  });
}

// the following functions provide actions to execute as the dependency
// graph is traversed during a build

// generate dependency information for .cpp files using g++ -MM
var dependencies = {
  type: 'dependency',
  exec: function(args) {
    var node = args.node;
    var g = args.graph;
    var cb = args.cb;
    var ctx = args.ctx;

    var include_paths = {};
    recursive_visit(g, node, function(node) {
      if (node.type === 'publish') {
        var full_target = path.resolve(node.root, node.target);
        include_paths[path.dirname(full_target)] = true;
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

    var full_source = path.resolve(node.root, node.source);
    var full_target = path.resolve(node.root, node.target);

    var dep_func = function() {

      wrench.mkdirSyncRecursive(path.dirname(full_target));

      var dep_args = ['-c', full_source, '-MM'].concat(flags).concat(paths);
      launch({
        cmd: 'g++',
        args: dep_args,
        opts: {cwd: node.root}
      }, function(err, data) {
        node.__cmdinfo = data;
        var dep_info = data.stdout;

        // first element is the .o file target
        // second element is the .cpp source
        var split = dep_info.replace(/[\\\n]/g, '')
                            .split(' ')
                            .filter(empty);
        split.shift();
        split = split.map(function(dep) {
          return dep.replace(ctx.root + path.sep, '');
        });

        if (err)
          return cb(err);

        utils.cache(full_target, split, cb);
      });
    }

    var triggers = [path.resolve(node.root, node.source)];

    invalidate(ctx, triggers, full_target, dep_func, cb);
  }
};

// compile a source file after loading generated dependencies
var compile = {
  type: 'compile',
  exec: function(args) {
    var node = args.node;
    var g = args.graph;
    var cb = args.cb;
    var ctx = args.ctx;

    var full_source = path.resolve(node.root, node.source);
    var full_target = path.resolve(node.root, node.target);

    var include_paths = {};
    recursive_visit(g, node, function(node) {
      if (node.type === 'publish') {
        var include_target = path.resolve(node.root, node.target);
        include_paths[path.dirname(include_target)] = true;
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
      wrench.mkdirSyncRecursive(path.dirname(full_target));
      var compile_args = ['-c', full_source, '-o', full_target].concat(flags).concat(paths);

      launch({
        cmd: 'g++',
        args: compile_args,
        opts: {cwd: node.root}
      }, function(err, data) {
        node.__cmdinfo = data;
        cb(err);
      });
    };

    var load_triggers = function(file) {
      utils.retrieve(file, function(err, triggers) {
        if (err)
          return cb('Failed loading file: ' + file);

        triggers = triggers.map(function (trigger) {
          return path.join(ctx.root, trigger);
        });
        invalidate(ctx, triggers, full_target, compile_func, cb);
      });
    };

    load_triggers(path.resolve(node.root, node.__depfile));
  }
};

// link a set of object files into a library or executable
var link = {
  type: 'link',
  exec: function(args) {
    var node = args.node;
    var g = args.graph;
    var cb = args.cb;
    var ctx = args.ctx;

    var full_source = path.resolve(node.root, node.source);
    var real_target = node.real_target;
    var full_target = path.resolve(node.root, real_target);

    var lib_paths = {};
    var lib_names = {};
    var obj_files = {};

    recursive_visit(g, node, function(node) {
      var node_target = path.resolve(node.root, node.target);

      if (node.type === 'link') {
        lib_paths[path.dirname(node_target)] = true;
        lib_names[path.basename(node_target)] = true;
      }
      else if(node.type === 'compile') {
        var id_root = args.node.id.split('.')[0];
        var dep_id_root = node.id.split('.')[0];
        if (id_root === dep_id_root)
          obj_files[node_target] = true;
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

    var flags = node.link_flags || [];
    if (node.subtype === 'shared')
      flags.push('-shared');

    var link_func = function() {
      wrench.mkdirSyncRecursive(path.dirname(full_target));

      var args = ['-o', full_target].concat(flags).concat(objs).concat(paths).concat(rpaths).concat(libs);

      launch({
        cmd: 'g++',
        args: args,
        opts: {cwd: node.root}
      }, function(err, data) {
        node.__cmdinfo = data;
        cb(err);
      });
    }

    var triggers = objs;
    invalidate(ctx, triggers, real_target, link_func, cb);
  }
};

// copy an include file to an install location
var publish = {
  type: 'publish',
  exec: function(args) {
    var node = args.node;
    var cb = args.cb;
    var ctx = args.ctx;

    var full_source = path.resolve(node.root, node.source);
    var full_target = path.resolve(node.root, node.target);

    var publish_func = function() {
      wrench.mkdirSyncRecursive(path.dirname(full_target));
      launch({
        cmd: 'cp',
        args: [full_source, full_target],
        opts: {cwd: node.root}
      }, function(err, data) {
        node.__cmdinfo = data;
        cb(err);
      });
      //fs.copy(full_source, full_target, cb);
    };

    var triggers = [path.resolve(node.root, node.source)];

    invalidate(ctx, triggers, full_target, publish_func, cb);
  }
};

var postbuild = {
  type: '*',
  exec: function(args) {
    var node = args.node;

    if (exists(node.postbuild))
      node.postbuild();
  }
}


// the following functions provide actions to execute as nodes are initially registered
// during the traversal of .dep files
//
// these hooks allow for modifying registered nodes, as well as generating any implicit information


// generate nodes matching the subtype of the template from either a list of sources, or a glob
//
// nodes are generated by substiting fields from the list of sources
// into the target string of the template
var template = {
  type: 'template',
  exec: function(node) {
    if (typeof node.source === 'string')
      var sources = glob.sync(node.source, {cwd: node.root});
    else
      var sources = node.source;

    var deps = [];
    var count = 0;
    sources.forEach(function(src) {
      var info = path.info(src);
      var inst = clone(node);
      inst.source = src;

      var replacements = {
        '${file}': info.file,
        '${ext}': info.ext,
        '${dir}': info.dir,
        '${base}': info.__dir,
        '${root}': inst.root
      };
      inst.target = replace(inst.target, replacements);

      inst.target = inst.target;
      inst.id = inst.id + '/' + info.file + info.ext;
      inst.type = node.subtype;
      delete inst.subtype;
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
    delete dep_node.subtype;
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

    var target_name = node.target;
    var target_dir = path.dirname(node.target);
    if (node.subtype === 'shared')
      target_name = 'lib' + path.basename(node.target) + '.so';
    node.real_target = path.join(target_dir, target_name);
  }
};

// registers a project, which implicitly registers a
// publish, compile, and build node
var project_register = {
  type: 'project',
  exec: function(node) {
    var deps = {
      publish: node.deps.publish || [],
      compile: node.deps.compile || [],
      link: node.deps.link || []
    };
    node.deps = [];

    node.source = node.source || 'src/*';
    node.include = node.include || 'include/*';
    node.build_dir = node.build_dir || 'build';
    node.install_dir = node.install_dir || 'install';
    node.publish_dir = node.publish_dir || 'include';
    node.target = node.target || node.id;
    node.subtype = node.subtype || 'application';

    var default_targetdir = 'bin';
    if (node.subtype === 'shared')
      default_targetdir = 'lib';

    node.target_dir = node.target_dir || default_targetdir;

    var publish_node = {
      id: node.id + '.publish',
      type: 'template',
      subtype: 'publish',
      source: node.include,
      target: path.join(node.install_dir, node.publish_dir, '${file}${ext}'),
      deps: deps.publish.map(function(dep) { return dep + '.publish'; })
    };
    register(publish_node);
    node.deps = [publish_node.id];

    if (node.subtype !== 'header_only') {
      var compile_node = {
        id: node.id + '.compile',
        type: 'template',
        subtype: 'compile',
        source: node.source,
        target: path.join(node.build_dir, '${file}.o'),
        deps: deps.compile.map(function(dep) { return dep + '.publish'; }).concat(node.id + '.publish')
      };
      register(compile_node);

      var link_node = {
        id: node.id + '.link',
        type: 'link',
        subtype: node.subtype,
        target: path.join(node.install_dir, node.target_dir, node.target),
        deps: deps.link.map(function(dep) { return dep + '.link'; }).concat(node.id + '.compile')
      };
      register(link_node);
      node.deps = [link_node.id];
    }

    delete node.target;
    delete node.source;
  }
};

var prebuild = {
  type: '*',
  exec: function(node) {
    node.__file = path.basename(__file);
    node.__dir = path.dirname(__file);
    node.root = node.root || node.__dir;
    node.deps = node.deps || [];
    if (exists(node.prebuild))
      node.prebuild();
  }
};

// attaches the toolchain to a provided node registry
exports.attach = function(registry) {
  // register the processing actions for the toolset in the global registry
  registry.add_process_action(dependencies);
  registry.add_process_action(compile);
  registry.add_process_action(link);
  registry.add_process_action(publish);
  registry.add_process_action(postbuild);

  // register the registration actions for the toolset in the global registry
  registry.add_register_action(prebuild);
  registry.add_register_action(template);
  registry.add_register_action(compile_register);
  registry.add_register_action(link_register);
  registry.add_register_action(project_register);
}
