require('node_extensions');

var fs = require('fs');
var async = require('async');
var util = require('util');
var path = require('path');

var exec = require('child_process').exec;
var spawn = require('child_process').spawn;

var dgraph = require('./dependency_graph');
var DependencyGraph = dgraph.DependencyGraph;
var execute = dgraph.execute;
var write_graph = dgraph.write_graph;

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

var posh_root = path.resolve(process.cwd(), '.posh');
var fingerprint_path = path.resolve(posh_root, 'fingerprints.json');
var graph_path = path.resolve(posh_root, 'graph.gen');
var nodes_path = path.resolve(posh_root, 'nodes.gen');

var new_fingerprints = {};
var old_fingerprints = {};

// cb(null, true) if file is unchanged, otherwise cb(null, false)
function fingerprint(file, cb) {
  var cached = new_fingerprints[file];
  if (exists(cached)) return cb(null, cached);

  try {
    hash(file, function(err, newval) {
      if (err) return cb(null, false);
      new_fingerprints[file] = newval;
      cb(null, newval === old_fingerprints[file]);
    })
  }
  catch(err) {
    cb(null, false);
  }
}

function touch(file) {
  fs.utimes(file, new Date(), new Date());
}

function execute_cmd(graph, node, cmd, cb) {
  if (!exists(cmd.target)) {
    console.log('+', cmd.cmd);
    var args = cmd.cmd.split(/ +/g);
    var cmd = args.shift();
    var proc = spawn(cmd, args, {stdio: 'inherit'});
    proc.on('exit', function(err) {
      cb(err);
    });
    return;
  }

  // if this target does not need to be rebuilt, skip it
  if (!exists(rebuild_targets[cmd.target]))
    return cb();

  // if the target is missing, we *must* rebuild it
  if (exists(missing_targets[cmd.target])) {
    console.log(cmd.cmd);
    return async.series([
      async.apply(exec, cmd.cmd),
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

    console.log(cmd.cmd);
    exec(cmd.cmd, null, cb);
  });
}

function print_sources(cmd, cb) {
  async.forEach(cmd.sources, function(source, cb) { console.log(source);  cb(); }, cb);
}

function print_target(cmd, cb) {
  if (!exists(cmd.target)) return cb();

  console.log(cmd.target);
  cb();
}

function clean(cmd, cb) {
  if (!exists(cmd.target)) return cb();

  var cmd = 'rm -rf ' + cmd.target;
  console.log(cmd);
  exec(cmd, cb);
}

function get_nodes() {
  util.invalidate_module(nodes_path);
  return require(nodes_path).nodes;
}

function register(cb) {
  cb = cb || function() {};
  console.log('Scanning .dep files in', process.cwd());
  var proc = spawn(path.resolve(__dirname, 'register.js'), null, {stdio: 'inherit'});
  proc.on('exit', function(code) {
    console.log('Done scanning');
    console.log('Writing node list to:', nodes_path);
    cb(code);
  });
}

function generate(cb) {
  cb = cb || function() {};

  register(function(err) {
    if (err) return cb(err);

    // construct dependency graph of nodes which have the specified action name
    var nodes = get_nodes().filter(function(node) { return exists(node.generate); });

    console.log('Constructing command graph for nodes');
    var graph = new DependencyGraph(nodes);
    graph.generated = [];

    execute(graph, {action: 'generate', begin: function(node) { console.log('Generating commands for node:', node.id); }}, function(cb) {
      var cmd_graph = new DependencyGraph(graph.generated, true);
      console.log('Writing command graph to', graph_path);
      write_graph(cmd_graph, graph_path);
      console.log('Done');
    });
  });
}

function generic(name, cb) {
  cb = cb || function() { };

  // construct dependency graph of nodes which have the specified action name
  console.log('Running custom action:', name);
  nodes = get_nodes().filter(function(node) { return exists(node[name]); });
  console.log('Constructing dependency graph');
  var graph = new DependencyGraph(nodes);
  var filename = path.resolve(posh_root, name + '_graph.gen');
  console.log('Writing', name, 'graph to', filename);
  write_graph(graph, filename);

  console.log('Beginning graph execution');
  execute(graph, {action: name, begin: function(node) { console.log('Executing', name, 'for node:' + node.id); }});
}

function posh(action) {
  switch(action) {
    case 'scan':
      register();
      break;
    case 'generate':
      generate();
      break;
    case 'outdated':
      console.log('Loading command graph from', graph_path);
      var graph = require(graph_path).graph;
      console.log('Calculating outdated targets');
      dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, check_for_updates, cb)}},
        function() {
          console.log(Object.keys(rebuild_targets));
          console.log('Done');
        }
      );
      break;
    case 'build':
      console.log('Loading command graph from', graph_path);
      var graph = require(graph_path).graph;

      console.log('Loading fingerprints from', fingerprint_path);
      try {
        old_fingerprints = retrieve(fingerprint_path);
      } catch(err) {
        console.log('Unable to load fingerprint file: ' + fingerprint_path);
      }

      console.log('Building outdated dependencies');
      async.series([
        async.apply(dgraph.execute, graph, {action: function(node, g, cb) { async.map(node.cmds, check_for_updates, cb)}}),
        async.apply(dgraph.execute, graph, {action: function(node, g, cb) { async.map(node.cmds, async.apply(execute_cmd, g, node), cb); }})
      ], function(err, cb) {
        Object.keys(new_fingerprints).forEach(function(file) {
          old_fingerprints[file] = new_fingerprints[file];
        });
        cache(fingerprint_path, old_fingerprints);
        console.log('Done');
      })
      break;
    case 'clean':
      console.log('Loading command graph from', graph_path);
      var graph = require(graph_path).graph;
      console.log('Removing targets');
      dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, clean, cb)}}, function(err) {
        console.log('Done');
      });
      break;
    case 'sources':
      console.log('Loading command graph from', graph_path);
      var graph = require(graph_path).graph;
      console.log('Sources:');
      dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, print_sources, cb); }}, function(err) {
        console.log('Done');
      });
      break;
    case 'targets':
      console.log('Loading command graph from', graph_path);
      var graph = require(graph_path).graph;
      console.log('Targets:');
      dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, print_target, cb); }}, function(err) {
        console.log('Done');
      });
      break;
    default:
      generic(action);
  }
}

module.exports.posh = posh;
