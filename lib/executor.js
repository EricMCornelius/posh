var async = require('async');
var child_process = require('child_process');
var fs = require('fs');
var path = require('path');
var os = require('os');

var exec = child_process.exec;
var spawn = child_process.spawn;

var config_path = path.resolve('.posh', 'config.json');

var config = {
  concurrency: os.cpus().length
};

try {
  config = JSON.parse(fs.readFileSync(config_path));
}
catch(e) { }

var command_queue = async.queue(function(task, done) {
  task(done);
}, config.concurrency);

function sink() { }

function execute(cmd, args, cb) {
  function task(done) {
    exec(cmd, args, function() {
      cb.apply(this, [].slice.call(arguments, 0));
      done();
    });
  }
  command_queue.push(task, sink);
}

function spawn(cmd, args, config, cb) {
  function task(done) {
    spawn(cmd, args, config).on('exit', function() {
      cb.apply(this, [].slice.call(arguments, 0));
      done();
    });
  }
  command_queue.push(task, sink);
}

module.exports.execute = execute;
module.exports.spawn = spawn;
