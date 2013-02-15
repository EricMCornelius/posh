var glob = require('glob');
var async = require('async');
var assert = require('assert');
var util = require('util');
var path = require('path');

var exists = util.exists;

function register(node, registry, cb) {
  var valid_languages = ['C++', 'c++', 'cplusplus', 'cpp'];
  if (valid_languages.indexOf(node.language) === -1)
    return cb();

  node.language = 'c++';
  node.type = node.type || node.env.type || 'application';
  var valid_types = ['application', 'shared_lib', 'static_lib'];
  assert(valid_types.indexOf(node.type) !== -1, 'Invalid c++ project type: ' + node.type);

  node.includedir = node.includedir || node.env.includedir || 'include';
  node.sourcedir = node.sourcedir || node.env.sourcedir || 'src';
  node.installdir = node.installdir || node.env.installdir || 'install';
  node.objectdir = node.objectdir || node.env.objectdir || 'obj';

  node.sources = util.isArray(node.sources) ? node.sources :  
                 exists(node.sources) ? [node.sources] : [path.join(node.sourcedir, '**.{cpp,c,C,cxx}')];

  node.includes = util.isArray(node.includes) ? node.includes :
                  exists(node.includes) ? [node.includes] : [path.join(node.includedir, '**.{hpp,h,H,hxx}')];

  node.build = function(cb) {
    processors['cplusplus'].build(this, cb);
  }
 
  async.parallel([
    async.apply(register['sources'], node),
    async.apply(register['includes'], node)
  ], function(err) {
    cb(err);
  });
}

register.sources = function(node, cb) {
  var sources = node.sources.map(async.apply(path.resolve, node.env.base));
  async.map(
    sources,
    function(source, cb) { glob.Glob(source, {}, cb); },
    function(err, results) {
      console.log(results);
      cb();
    }
  );
}

register.includes = function(node, cb) {
  var includes = node.includes.map(async.apply(path.resolve, node.env.base));
  async.map(
    includes,
    function(include, cb) { glob.Glob(include, {}, cb); },
    function(err, results) {
      console.log(results);
      cb();
    }
  );
}

function build(node, cb) {
  build[node.type](node, cb);
}

build.application = function(node, cb) {
  console.log(node);
  cb();
}

build.shared_lib = function(node, cb) {
  console.log(node);
  cb();
}

build.static_lib = function(node, cb) {
  console.log(node);
  cb();
}

module.exports.register = register;
module.exports.build = build;
module.exports.name = 'cplusplus'
