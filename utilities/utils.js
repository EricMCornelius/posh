var async = require('async');
var wrench = require('wrench');
var $ = require('jquery');

var crypto = require('crypto');
var fs = require('fs');
var path = require('path');
var proc = require('child_process');
var util = require('util');
var vm = require('vm');

// extends path with a split function
path.split = function(p) {
  return p.split(path.sep);
};

// joins an array of strings with the path separator
path.join_arr = function(l) {
  return path.sep + l.reduce(function(l, r) {
    return path.join(l, r);
  }, '');
};

path.info = function(p) {
  return new PathInfo(p);
};

PathInfo = function(p) {
  var self = this;

  self.dir = path.dirname(p);
  self.ext = path.extname(p);
  self.file = path.basename(p, self.ext);

  self.join = PathInfo.prototype.join.bind(self);
};

PathInfo.prototype.join = function(args) {
  args = args || {};
  return path.join(args.dir || this.dir, (args.file || this.file) + (args.ext || this.ext));
};

// extends fs with an asynchronous copy function
fs.copy = function (src, dst, cb) {
  function copy(err) {
    var is, os;

    fs.stat(src, function (err) {
      if (err)
        return cb(err);

      is = fs.createReadStream(src);
      os = fs.createWriteStream(dst);
      util.pump(is, os, cb);
    });
  }

  fs.stat(dst, copy);
};

// pretty-printed json dump
dump = function(obj) {
  return JSON.stringify(obj, null, 2);
}

// serializes object to file
exports.cache = function(file, obj, cb) {
  wrench.mkdirSyncRecursive(path.dirname(file));
  if (exists(cb))
    fs.writeFile(file, dump(obj), cb);
  else
    fs.writeFileSync(file, dump(obj));
}

// retrieves object from file
exports.retrieve = function(file, cb) {
  fs.readFile(file, function(err, data) {
    if (err)
      return cb(err);
    cb(null, JSON.parse(data));
  });
}

// writes string to file
write = function(file, str, cb) {
  wrench.mkdirSyncRecursive(path.dirname(file));
  if (exists(cb))
    fs.writeFile(file, str, cb);
  else
    fs.writeFileSync(file, str);
}

replace = function(str, replacements) {
  for (key in replacements)
    str = str.replace(key, replacements[key]);
  return str;
}

// deep clone of object
clone = function(obj) {
  return $.extend(true, {}, obj);
}

exists = function(obj) {
  return (obj !== undefined && obj !== null);
}

empty = function(str) {
  return (str !== '');
}

launch = function(args, cb) {
  args.opts = args.opts || {};
  var root = args.opts.cwd || __dirname;

  var invocation = {
    cmd: [args.cmd].concat(args.args).join(' '),
    cwd: root,
    stdout: [],
    stderr: [],
    exit_code: 0
  };

  var invoke = proc.spawn(args.cmd, args.args, args.opts);
  invoke.stdout.on('data', function(data) {
    invocation.stdout.push(data);
  });

  invoke.stderr.on('data', function(data) {
    invocation.stderr.push(data);
  });

  invoke.on('exit', function(code) {
    invocation.exit_code = code;
  });

  invoke.on('close', function() {
    invocation.stdout = invocation.stdout.join('');
    invocation.stderr = invocation.stderr.join('');
    if (invocation.exit_code !== 0) {
      return cb(new Error(invocation.exit_code), invocation);
    }
    cb(null, invocation);
  });
};

// hashes the contents of a file
var hash = function(file, cb) {
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

// for a given set of files, determines whether invalidation is necessary
exports.invalidate = function(args) {
  var updated = args.updated;
  var cache = args.cache;
  var root = args.root;
  var triggers = args.triggers;
  var cb = args.cb;

  var triggered = false;

  async.forEach(
    triggers,
    function(trigger, cb) {
      if (trigger in updated) {
        if (updated[trigger] === true)
          triggered = true;
        return cb();
      }

      hash(path.join(root, trigger), function(err, val) {
        if (err)
          return cb(err);

        if (trigger in updated) {
          if (updated[trigger] === true)
            triggered = true;
          return cb();
        }

        updated[trigger] = (val !== cache[trigger]);
        cache[trigger] = val;

        if (updated[trigger] === true)
          triggered = true;
        cb();
      });
    },
    function(err) {
      cb(err, triggered);
    }
  );
};

// args
// path: file to load
// prerun: function to execute before evaluation
// postrun: function to execute following evaluation
include = function(args) {
  fs.readFile(args.path, null, function(err, code) {
    args.prerun();
    try {
      vm.runInThisContext(code);
    }
    catch(e) {
      console.log('Failed to process file: ' + args.path);
      throw (e);
    }
    args.postrun();
  });
};
