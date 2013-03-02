#!/usr/bin/env node

require('node_extensions');

var graph = require('./.posh/graph.gen').graph;
var dgraph = require('./lib/dependency_graph');
var fs = require('fs');

var async = require('async');
var exec = require('child_process').exec;
var util = require('util');

var exists = util.exists;
var retrieve = util.retrieve;
var cache = util.cache;
var hash = util.hash;

var rebuild_targets = {};
var missing_targets = {};
function check_for_updates(cmd, cb) {
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

var fingerprint_path = '.posh/fingerprints.json';
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
  // if this target does not need to be rebuilt, skip it
  if (!exists(rebuild_targets[cmd.target]))
    return cb();

  // if the target is missing, we *must* rebuild it
  if (exists(missing_targets[cmd.target])) {
    console.log(cmd.cmd);
    return async.series([
      async.apply(exec, cmd.cmd),
      async.apply(fingerprint, cmd.sources),
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
  console.log(cmd.target);
  cb();
}

function clean(cmd, cb) {
  var cmd = 'rm -rf ' + cmd.target;
  console.log(cmd);
  exec(cmd, cb);
}

var action = process.argv[2];

switch(action) {
  case 'rebuild_targets':
    dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, check_for_updates, cb)}},
      function() {
        console.log(Object.keys(rebuild_targets));
      }
    );
    break;
  case 'build':
    try {
      old_fingerprints = retrieve(fingerprint_path);
    } catch(err) {
      console.log('Unable to load fingerprint file: ' + fingerprint_path);
    }

    async.series([
      async.apply(dgraph.execute, graph, {action: function(node, g, cb) { async.map(node.cmds, check_for_updates, cb)}}),
      async.apply(dgraph.execute, graph, {action: function(node, g, cb) { async.map(node.cmds, async.apply(execute_cmd, g, node), cb); }})
    ], function(err, cb) {
      Object.keys(new_fingerprints).forEach(function(file) {
        old_fingerprints[file] = new_fingerprints[file];
      });
      cache(fingerprint_path, old_fingerprints);
      console.log('done');
    })
    break;
  case 'clean':
    dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, clean, cb)}});
    break;
  case 'print_sources':
    dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, print_sources, cb); }});
    break;
  case 'print_targets':
    dgraph.execute(graph, {action: function(node, g, cb) { async.map(node.cmds, print_target, cb); }});
    break;
}
