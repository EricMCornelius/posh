var fs = require('fs');
var crypto = require('crypto');

var _ = require('lodash');
var mkdirp = require('mkdirp');

function public(args, module) {
  _.each(args, function(arg) {
    if (_.isFunction(arg)) {
      module.exports[arg.name] = arg;
    }
    else {
      _.each(arg, function(val, key) {
        module.exports[key] = val;
      });
    }
  });
}

function exists(obj) {
  return !_.isUndefined(obj);
}

function getErrorObject() {
  try {
    throw Error('');
  } catch(err) {
    return err;
  }
}

function getCaller() {
  var err = getErrorObject();
  var caller_line = err.stack.split('\n')[4];
  var index = caller_line.indexOf('at ');
  return caller_line.slice(index+2, caller_line.length);
}

var __nextid = 0;
var __pending = {};

// extends util with method to force single callback execution
function force(cb, msg) {
  var id = ++__nextid;
  var wrapped = function() {
    delete __pending[id];
    return cb.apply(null, arguments);
  };
  __pending[id] = (msg ? msg + ' - ' : '') + 'initialized at ' + getCaller();
  return wrapped;
}

// retrieves object from file
function retrieve(file, cb) {
  if (exists(cb)) {
    fs.readFile(file, function(err, data) {
      if (err)
        return cb(err);
      cb(null, JSON.parse(data));
    });
  }
  else
    return JSON.parse(fs.readFileSync(file));
}

// hashes the contents of a file
function hash(file, cb) {
  var h = crypto.createHash('sha1');
  var s = fs.ReadStream(file);
  s.on('data', function(d) {
    h.update(d);
  });

  s.on('end', function() {
    cb(null, h.digest('hex'));
  });

  s.on('error', function(err) {
    cb('Failed hashing file: ' + file);
  });
};

// pretty-printed json dump
function dump(obj) {
  return JSON.stringify(obj, null, 2);
}

// serializes object to file
function cache(file, obj, cb) {
  mkdirp.sync(path.dirname(file));
  if (exists(cb))
    fs.writeFile(file, dump(obj), cb);
  else
    fs.writeFileSync(file, dump(obj));
}

module.exports = {
  public: public,
  exists: exists,
  force: force,
  isArray: _.isArray,
  clone: _.cloneDeep,
  retrieve: retrieve,
  hash: hash,
  cache: cache
};

