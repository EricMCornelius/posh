var assert = require('assert');
var util = require('util');
var mkdirp = require('mkdirp');
var async = require('async');
var path = require('path');

var exec = require('child_process').exec;

require('../../extensions/extensions.js');

var exists = util.exists;
var launch = util.launch;

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
    config.target = config.target || '.';
    config.target = path.resolve(node.env.base, config.target);
    config.branch = config.branch || 'master';

    node.update = function(cb) {
      processors['git'].update(this, cb);
    }
  }

  cb();
}

var executed = {};
function update(node, cb) {
  var config = node.git;

  var key = [config.repo, config.branch, config.target].join('/');
  if (key in executed)
    return cb();
  executed[key] = true;

  var opts = {
    cwd: config.target
  };

  async.series([
    async.apply(mkdirp, config.target),
    message('Initializing git repo in directory: ' + opts.cwd),
    async.apply(launch, {cmd: 'git', args: ['init'], opts: opts}),
    message('Setting origin: ' + config.repo),
    succeed(async.apply(launch, {cmd: 'git', args: ['remote', 'add', 'origin', config.repo], opts: opts})),
    message('Fetching latest changes...'),
    async.apply(launch, {cmd: 'git', args: ['fetch'], opts: opts}),
    message('Checking out branch: ' + config.branch),
    succeed(
      async.apply(
        async.detectSeries,
      [
        async.apply(launch, {cmd: 'git', args: ['checkout', '-b', config.branch, '--track', 'origin/' + config.branch], opts: opts}),
        async.apply(launch, {cmd: 'git', args: ['checkout', config.branch], opts: opts})
      ], 
      function(task, cb) {
        task(function(err) {
          err ? cb(false) : cb(true);
        });
      }
    ))
  ], function(err, results) {
    cb(err);
  });
}

module.exports.register = register;
module.exports.update = update;
module.exports.name = 'git';