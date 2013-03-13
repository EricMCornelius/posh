require('node_extensions');

var fs = require('fs');
var async = require('async');
var util = require('util');
var path = require('path');
var colors = require('colors');

// disable colors if output is not going to terminal
if (!require('tty').isatty(process.stdout.fd))
  colors.mode = 'none';

var exec = require('child_process').exec;
var spawn = require('child_process').spawn;

var dgraph = require('./dependency_graph');
var DependencyGraph = dgraph.DependencyGraph;
var execute = dgraph.execute;
var read_graph = dgraph.read_graph;
var write_graph = dgraph.write_graph;

var registry = require('./registry/registry').registry;

var exists = util.exists;
var retrieve = util.retrieve;
var cache = util.cache;
var hash = util.hash;

var rebuild_targets = {};
var missing_targets = {};

function check_for_updates(cmd, cb) {
  if (!exists(cmd.target)) return cb();

  fs.stat(cmd.target, function(err, target) {
    if (err) {
      rebuild_targets[cmd.target] = true;
      missing_targets[cmd.target] = true;
      return cb();
    }

    for (var idx in cmd.sources) {
      if (exists(rebuild_targets[cmd.sources[idx]])) {
        rebuild_targets[cmd.target] = true;
        return cb();
      }
    }

    async.map(cmd.sources, fs.stat, function(err, results) {
      for (var idx in results) {
        var stat = results[idx];
        if (stat.mtime.getTime() > target.mtime.getTime()) {
          rebuild_targets[cmd.target] = true;
          return cb();
        }
      };
      cb();
    });
  });
}

var posh_root = path.resolve('.posh');
var fingerprint_path = path.resolve(posh_root, 'fingerprints.json');
var graph_path = path.resolve(posh_root, 'graph.gen');
var nodes_path = path.resolve(posh_root, 'nodes.gen');
var dot_path = path.resolve(posh_root, 'graph.dot');
var svg_path = path.resolve(posh_root, 'graph.svg');

var new_fingerprints = {};
var old_fingerprints = {};

// cb(null, true) if file is unchanged, otherwise cb(null, false)
function fingerprint(file, cb) {
  // use relative path entries for caching fingerprints
  var relative = path.relative(process.cwd(), file);

  var cached = new_fingerprints[relative];
  if (exists(cached)) return cb(null, old_fingerprints[relative] === cached);

  try {
    hash(file, function(err, newval) {
      if (err) return cb(null, false);
      new_fingerprints[relative] = newval;
      cb(null, newval === old_fingerprints[relative]);
    })
  }
  catch(err) {
    cb(null, false);
  }
}

function touch(file) {
  fs.utimes(file, new Date(), new Date());
}

function colored_exec(cmd, args, cb) {
  if (!exists(cb)) {
    cb = args;
    args = null;
  }

  exec(cmd, args, function(err, stdout, stderr) {
    if (err) {
      console.log(cmd.red);
      console.error(stderr.red);
      return cb(err);
    }
    console.log(cmd.green);
    return cb();
  });
};

function build(graph, node, cmd, cb) {
  cmd.action = cmd.action || 'build';
  if (cmd.action !== 'build') return cb();

  // TODO: refactor
  if (!exists(cmd.target)) {
    var current = cmd;
    current.sources = current.sources.map(async.apply(path.resolve, cmd.cwd || node.base || process.cwd()).only(1));
    async.map(current.sources, fingerprint, function(err, results) {
      var no_update = true;
      results.forEach(function(result) {
        if (!result) no_update = false;
      });
      if (no_update)
        return cb();

      console.log(current.cmd.yellow);
      var cwd = current.cwd || node.base || process.cwd();
      var args = current.cmd.split(/ +/g);

      var proc = spawn(args.shift(), args, {stdio: 'inherit', cwd: cwd});
      proc.on('exit', function(err) {
        if (err) throw new Error('Command: ' + current.cmd + ' failed with error code: ' + err);
        cb();
      });
    });
    return;
  }

  // if this target does not need to be rebuilt, skip it
  if (!exists(rebuild_targets[cmd.target]))
    return cb();

  // if the target is missing, we *must* rebuild it
  if (exists(missing_targets[cmd.target])) {
    return async.series([
      async.apply(colored_exec, cmd.cmd),
      async.apply(async.map, cmd.sources, fingerprint),
      async.apply(fingerprint, cmd.target)
    ], cb);
  }

  // fingerprint the input sources against cached values
  async.map(cmd.sources, fingerprint, function(err, results) {
    var no_update = true;
    results.forEach(function(result) {
      if (!result) no_update = false;
    });
    if (no_update) {
      // update the timestamp on the target to exceed the sources
      touch(cmd.target);
      return cb();
    }

    // needs rebuilding... so rebuild and add anything which depends on
    // this to the set of rebuild targets
    colored_exec(cmd.cmd, {cwd: cmd.cwd || node.base || process.cwd()}, cb);
  });
}

function execute_cmd(action, graph, node, cmd, cb) {
  if (cmd.action !== action) return cb();
  
  console.log(cmd.cmd.yellow);
  var cwd = cmd.cwd || node.base;
  var args = cmd.cmd.split(/ +/g);
  var cmd = args.shift();

  var proc = spawn(cmd, args, {stdio: 'inherit', cwd: cwd});
  proc.on('exit', function(err) {
    cb(err);
  });
}

function print_sources(cmd, cb) {
  if (cmd.action === 'update') return cb();

  cmd.sources = cmd.sources || [];
  async.forEach(cmd.sources, function(source, cb) { console.log(source.yellow);  cb(); }, cb);
}

function print_target(cmd, cb) {
  if (!exists(cmd.target) || cmd.action === 'update') return cb();

  console.log(cmd.target.yellow);
  cb();
}

function clean(cmd, cb) {
  if (!exists(cmd.target) || cmd.action === 'update') return cb();

  var cmd_str = 'rm -rf ' + cmd.target;
  console.log('rm -rf'.red, cmd.target.yellow);
  exec(cmd_str, cb);
}

function wordwrap( str, width, brk, cut ) {
 
    brk = brk || '\n';
    width = width || 75;
    cut = cut || false;
 
    if (!str) { return str; }
 
    var regex = '.{1,' +width+ '}(\\s|$)' + (cut ? '|.{' +width+ '}|.+$' : '|\\S+?(\\s|$)');
 
    return str.match( RegExp(regex, 'g') ).join( brk );
 
}

function render_graph(g, action) {
  var dot = 'digraph {\n';
  dot += '  compound=true;\n';
  dot += '  node[shape=record];\n';

  var node_count = 0;
  var cmd_count = 0;

  var collapsed = {};

  g.nodes.forEach(function(node) {
    node.cmds = node.cmds.filter(function(cmd) { return cmd.action === action; });
    if (node.cmds.length === 0) {
      collapsed[node.id] = true;
      return;
    }

    dot += '  "' + node.id + '";\n';

    dot += '  subgraph "cluster' + node.id + '"{\n';
    dot += '    style=filled;\n';
    dot += '    color=lightgrey;\n';
    dot += '    node [style=filled,color=white];\n';
    dot += '    label = "' + node.id + ' commands";\n';

    var idx = 0;
    node.cmds.forEach(function(cmd) {
      dot += '    "' +  node.id + '.' + idx + '" [label="' + node.id + '.' + idx + '",tooltip="' + cmd.cmd + '"];\n';
      ++idx;
    });
    dot += '  }\n';
    dot += '  "' + node.id + '" -> "' + node.id + '.0" [lhead="cluster' + node.id + '"];\n';
  });

  g.nodes.forEach(function(node) {
    if (collapsed[node.id])
      return;

    var children = g.children[node.id];
    children.forEach(function(child_id) {
      dot += '  "' + node.id + '" -> "' + child_id + '" [id="' + node.id + '.' + child_id + '"];\n';
    });
  });

  dot += '}';
  return dot;
}

function get_nodes() {
  return new registry(nodes_path).nodes;
}

function register(cb) {
  cb = cb || function() {};
  console.log('Scanning .dep files in'.cyan, process.cwd().yellow);
  var proc = spawn(path.resolve(__dirname, 'register.js'), null, {stdio: 'inherit'});
  proc.on('exit', function(code) {
    console.log('Done'.cyan);
    console.log('Writing node list to:'.cyan, nodes_path.yellow);
    cb(code);
  });
}

function generate(cb) {
  cb = cb || function() {};

  register(function(err) {
    if (err) return cb(err);

    // construct dependency graph of nodes which have the specified action name
    var nodes = get_nodes().filter(function(node) { return exists(node.generate); });

    console.log('Constructing command graph for nodes'.cyan);
    var graph = new DependencyGraph(nodes);
    graph.generated = [];

    execute(graph, {action: 'generate', begin: function(node) { console.log('Generating commands for node:'.cyan, node.id.yellow); }}, function(cb) {
      var cmd_graph = new DependencyGraph(graph.generated);
      console.log('Writing command graph to'.cyan, graph_path.yellow);
      write_graph(cmd_graph, graph_path);
      console.log('Done'.cyan);
    });
  });
}

function generic(name, cb) {
  cb = cb || function() {};

  console.log('Loading command graph from'.cyan, graph_path.yellow);
  var graph = read_graph(graph_path);

  dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, async.apply(execute_cmd, name, g, node), cb); }}, function(err) {
    console.log('Done'.cyan);
  });
}

function posh(action) {
  switch(action) {
    case 'scan':
      register();
      break;
    case 'generate':
      generate();
      break;
    case 'status':
      console.log('Loading command graph from'.cyan, graph_path.yellow);
      var graph = read_graph(graph_path);
      console.log('Calculating outdated targets'.cyan);
      dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, check_for_updates, cb)}},
        function() {
          Object.keys(rebuild_targets).forEach(function(target) {
            console.log(target.yellow);
          });
          console.log('Done'.cyan);
        }
      );
      break;
    case 'build':
      console.log('Loading command graph from'.cyan, graph_path.yellow);
      var graph = read_graph(graph_path);

      console.log('Loading fingerprints from'.cyan, fingerprint_path.yellow);
      try {
        old_fingerprints = retrieve(fingerprint_path);
      } catch(err) {
        console.log('Unable to load fingerprint file: '.red + fingerprint_path.yellow);
      }

      console.log('Building potentially outdated dependencies'.cyan);
      async.series([
        async.apply(dgraph.execute, graph, {action: function(node, g, cb) { async.map(node.cmds, check_for_updates, cb)}}),
        async.apply(dgraph.execute, graph, {action: function(node, g, cb) { async.map(node.cmds, async.apply(build, g, node), cb); }})
      ], function(err, cb) {
        Object.keys(new_fingerprints).forEach(function(file) {
          old_fingerprints[file] = new_fingerprints[file];
        });
        cache(fingerprint_path, old_fingerprints);
        console.log('Done'.cyan);
      })
      break;
    case 'clean':
      console.log('Loading command graph from'.cyan, graph_path.yellow);
      var graph = read_graph(graph_path);
      console.log('Removing targets'.cyan);
      dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, clean, cb)}}, function(err) {
        console.log('Done'.cyan);
      });
      break;
    case 'sources':
      console.log('Loading command graph from'.cyan, graph_path.yellow);
      var graph = read_graph(graph_path);
      console.log('Sources:'.cyan);
      dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, print_sources, cb); }}, function(err) {
        console.log('Done'.cyan);
      });
      break;
    case 'targets':
      console.log('Loading command graph from'.cyan, graph_path.yellow);
      var graph = read_graph(graph_path);
      console.log('Targets:'.cyan);
      dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, print_target, cb); }}, function(err) {
        console.log('Done'.cyan);
      });
      break;
    case 'graph':
      console.log('Loading command graph from'.cyan, graph_path.yellow);
      var graph = read_graph(graph_path);
      console.log('Rendering graph in .dot format'.cyan);
      var action = process.argv[3] || 'build';
      var dot = render_graph(graph, action);
      console.log('Writing .dot file:'.cyan, dot_path.yellow);
      fs.writeFileSync(dot_path, dot);
      async.series([
        async.apply(colored_exec, 'dot ' + dot_path + ' -Tsvg -o' + svg_path),
        async.apply(colored_exec, '/usr/bin/google-chrome ' + svg_path)
      ], function(err) {
        console.log('Done'.cyan);
      });
      break;
    default:
      generic(action);
  }
}

process.on('uncaughtException', function(err) {
  console.log(err.stack.red);
});

module.exports.posh = posh;
