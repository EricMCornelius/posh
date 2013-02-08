function register(node, registry, cb) {
  var valid_types = ['C++', 'c++', 'cplusplus', 'cpp', undefined];
  if (valid_types.indexOf(node.type) === -1)
    return cb();

  node.type = 'c++';

  node.build = function(cb) {
    processors['cplusplus'].build(this, cb);
  }

  cb();
}

function build(node, cb) {
  console.log(node);
  cb();
}

module.exports.register = register;
module.exports.build = build;
module.exports.name = 'cplusplus'