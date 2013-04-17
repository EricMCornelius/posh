require('node_extensions');

var assert = require('assert');
var util = require('util');
var path = require('path');
var fs = require('fs');

var exists = util.exists;

function register(node, registry, cb) {
  var config = node.git;

  if (exists(config)) {
    assert(exists(config.repo), 'No git repository specified');
    config.target = path.resolve(node.base, config.target || '.');
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
        deps: node.deps,
        base: node.base
      });

      graph.generated.push({
        id: node.id + '.git_init',
        cmds: [create_git_init_command(config)],
        deps: [node.id + '.gen_dirs'],
        base: node.base
      });

      graph.generated.push({
        id: node.id + '.git_add_remote',
        cmds: [create_git_add_remote_command(config)],
        deps: [node.id + '.git_init'],
        base: node.base
      });

      graph.generated.push({
        id: node.id + '.git_fetch',
        cmds: [create_git_fetch_command(config)],
        deps: [node.id + '.git_add_remote'],
        base: node.base
      });

      graph.generated.push({
        id: node.id + '.git_checkout',
        cmds: [create_git_checkout_track_command(config)],
        deps: [node.id + '.git_fetch'],
        base: node.base
      });

      if (node.submodule) {
        graph.generated.push({
          id: node.id + '.git_submodule',
          cmds: [create_git_submodule_init_command(config)],
          deps: [node.id + '.git_checkout'],
          base: node.base
        });
      }
      
      graph.generated.push({
        id: node.id,
        cmds: [],
        deps: node.deps.concat(node.id + '.git_checkout'),
        base: node.base
      });
    }
    else {
      graph.generated.push({
        id: node.id + '.git_pull',
        cmds: [create_git_pull_command(config)],
        deps: node.deps,
        base: node.base
      });

      graph.generated.push({
        id: node.id + '.git_checkout',
        cmds: [create_git_checkout_command(config)],
        deps: [node.id + '.git_pull'],
        base: node.base
      });
      
      graph.generated.push({
        id: node.id,
        cmds: [],
        deps: node.deps.concat(node.id + '.git_pull'),
        base: node.base
      });
    }

    return cb();
  });
}

var create_directory_command = require('../common.js').create_directory_command;

function create_git_init_command(config) {
  return {
    sources: [],
    cmd: 'git',
    args: ['init'],
    cwd: config.target,
    action: 'update'
  };
};

function create_git_add_remote_command(config) {
  return {
    sources: [],
    cmd: 'git',
    args: ['remote', 'add', 'origin', config.repo],
    cwd: config.target,
    action: 'update'
  };
}

function create_git_fetch_command(config) {
  return {
    sources: [],
    cmd: 'git',
    args: ['fetch'],
    cwd: config.target,
    action: 'update'
  };
}

function create_git_checkout_track_command(config) {
  return {
    sources: [],
    cmd: 'git',
    args: ['checkout', '-b', config.branch, '--track', 'origin/' + config.branch],
    cwd: config.target,
    action: 'update'
  };
}

function create_git_pull_command(config) {
  return {
    sources: [],
    cmd: 'git',
    args: ['pull'],
    cwd: config.target,
    action: 'update'
  };
}

function create_git_checkout_command(config) {
  return {
    sources: [],
    cmd: 'git',
    args: ['checkout', config.branch],
    cwd: config.target,
    action: 'update'
  };
}

function create_git_submodule_init_command(config) {
  return {
    sources: [],
    cmd: 'git',
    args: ['submodule', 'update', '--init'],
    cwd: config.target,
    action: 'update'
  };
}

module.exports.register = register;
module.exports.generate = generate;
module.exports.name = 'git';
