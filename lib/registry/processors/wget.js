require('node_extensions');

var assert = require('assert');
var util = require('util');
var mkdirp = require('mkdirp');
var async = require('async');
var path = require('path');
var http = require('http');
var https = require('https');
var fs = require('fs');
var url = require('url');

var exec = require('child_process').exec;

var exists = util.exists;
var launch = util.launch;
var message = util.message;

function register(node, registry, cb) {
  var config = node.wget;

  if (exists(config)) {
    assert(exists(config.url), 'No url specified');
    var urlObj = url.parse(config.url);
    config.targetdir = path.resolve(node.env.base, config.targetdir || path.dirname(config.target) || '.');
    config.target = path.basename(config.target || urlObj.pathname);
    config.protocol = urlObj.protocol;

    node.generate = function(graph, cb) {
      processors['wget'].generate(graph, this, cb);
    }
  }

  cb();
}

function generate(graph, node, cb) {
  var config = node.wget;
  config.wget_target = path.join(node.env.base, config.target);
  config.extract_target = (node.env.base === config.targetdir) ? path.join(config.targetdir, path.basename(config.wget_target)) : config.targetdir;

  var directory_cmds = [create_directory_command(config.targetdir)];
  var wget_cmds = [create_wget_command(config)];

  graph.generated.push({
    id: node.id + '.gen_dirs',
    cmds: directory_cmds,
    deps: [],
    base: node.base
  });

  graph.generated.push({
    id: node.id + '.wget',
    cmds: wget_cmds,
    deps: [node.id + '.gen_dirs'],
    base: node.base
  });

  if (config.target.endsWith('.tar.gz')) {
    var untar_cmds = [create_untar_command(config)];
    graph.generated.push({
      id: node.id + '.extract',
      cmds: untar_cmds,
      deps: [node.id + '.wget'],
      base: node.base
    });
  }
  else if(config.target.endsWith('.zip')) {
    var unzip_cmds = [create_unzip_command(config)];
    graph.generated.push({
      id: node.id + '.extract',
      cmds: unzip_cmds,
      deps: [node.id + '.wget'],
      base: node.base
    });
  }

  cb();
}

function create_directory_command(path) {
  return {
    sources: [],
    cmd: 'mkdir',
    args: ['-p', path],
    action: 'update'
  };
}

function create_wget_command(config) {
  return {
    sources: [],
    cmd: 'wget',
    args: [config.url, '-O', config.wget_target],
    action: 'update'
  };
}

function create_untar_command(config) {
  return {
    sources: [config.wget_target],
    cmd: 'tar',
    args: ['-xvf', config.wget_target, '--keep-newer-files', '-C', config.targetdir],
    action: 'update'
  };
}

function create_unzip_command(config) {
  return {
    sources: [config.wget_target],
    cmd: 'unzip',
    args: ['-u', config.wget_target, '-d', config.targetdir],
    action: 'update'
  };
}

module.exports.register = register;
module.exports.generate = generate;
module.exports.name = 'wget';
