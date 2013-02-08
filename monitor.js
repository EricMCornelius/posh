var path = require('path');
var fs = require('fs');
var async = require('async');
var glob = require('glob');

var dep_files = glob.sync('**/.dep');
var js_files = glob.sync('**/*.js');
var files = dep_files.concat(js_files);

var reload = path.resolve(__dirname, 'action.js');

var allowLoad = true;

function resetLoad() {
  allowLoad = true;
}

function monitor() {
  files = files.map(async.apply(path.resolve, process.cwd()));
  files.forEach(function(file) {
    fs.watch(file, function() {
      if (!allowLoad) return;

      try {
        allowLoad = false;
        setTimeout(resetLoad, 100);
        delete require.cache[reload];
        var m = require(reload);
        m.run();
      }
      catch(e) {
        console.error(e.stack);
      }
    });
  });
}

monitor();