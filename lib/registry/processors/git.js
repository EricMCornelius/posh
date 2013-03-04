require('node_extensions');

var assert = require('assert');
var util = require('util');
var mkdirp = require('mkdirp');
var async = require('async');
var path = require('path');
var fs = require('fs');

var exists = util.exists;

function succeed(action) {
  return function(cb) {
    action(function() { cb(); });
  }
}

function message(msg) {
  return function(cb) {
    console.log(msg);
    cb();
  }
}

function register(node, registry, cb) {
  var config = node.git;

  if (exists(config)) {
    assert(exists(config.repo), 'No git repository specified');
    config.target = path.resolve(node.env.base, config.target || '.');
    config.branch = config.branch || 'master';

    node.generate = function(graph, cb) {
      processors['git'].generate(graph, this, cb);
    }
  }

  cb();
}

function generate(graph, node, cb) {
  var config = node.git;

  fs.stat(path.join(config.target, '.git'), function(err, info) {
    if (err) {
      graph.generated.push({
        id: node.id + '.gen_dirs',
        cmds: [create_directory_command(config.target)],
        deps: []
      });

      graph.generated.push({
        id: node.id + '.git_init',
        cmds: [create_git_init_command(config)],
        deps: []
      });

      graph.generated.push({
        id: node.id + '.git_add_remote',
        cmds: [create_git_add_remote_command(config)],
        deps: [node.id + '.git_init']
      });
    }
    var deps = (err) ? [node.id + '.git_add_remote'] : [];
    graph.generated.push({
      id: node.id + '.git_fetch',
      cmds: [create_git_fetch_command(config)],
      deps: deps
    });
    if (err) {
      graph.generated.push({
        id: node.id + '.git_checkout',
        cmds: [create_git_checkout_track_command(config)],
        deps: [node.id + '.git_fetch']
      });
    }
    else {
      graph.generated.push({
        id: node.id + '.git_add_remote',
        cmds: [create_git_checkout_command(config)],
        deps: [node.id + '.git_fetch']
      });
    }

    return cb();
  });
}

function create_directory_command(path) {
  return {
    sources: [],
    target: path,
    cmd: 'mkdir -p ' + path,
    action: 'update'
  };
}

function create_git_init_command(config) {
  return {
    sources: [],
    cmd: 'git init',
    cwd: config.target,
    action: 'update'
  };
};

function create_git_add_remote_command(config) {
  return {
    sources: [],
    cmd: 'git remote add origin ' + config.repo,
    cwd: config.target,
    action: 'update'
  };
}

function create_git_fetch_command(config) {
  return {
    sources: [],
    cmd: 'git fetch',
    cwd: config.target,
    action: 'update'
  };
}

function create_git_checkout_track_command(config) {
  return {
    sources: [],
    cmd: 'git checkout -b ' + config.branch + ' --track origin/' + config.branch,
    cwd: config.target,
    action: 'update'
  };
}

function create_git_checkout_command(config) {
  return {
    sources: [],
    cmd: 'git checkout ' + config.branch,
    cwd: config.target,
    action: 'update'
  };
}

module.exports.register = register;
module.exports.generate = generate;
module.exports.name = 'git';