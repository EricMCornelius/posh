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
  console.log('Copying ' + src + ' -> ' + dst);

  function copy(err) {
    var is, os;

    if (!err)
      console.log('Overwriting file: ' + dst);

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
cache = function(file, obj, cb) {
  wrench.mkdirSyncRecursive(path.dirname(file));
  fs.writeFile(file, dump(obj), cb);
}

// retrieves object from file
retrieve = function(file, cb) {
  fs.readFile(file, function(err, data) {
    if (err)
      return cb(err);
    cb(null, JSON.parse(data));
  });
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
    cmds: ['cd ' + root, [args.cmd].concat(args.args).join(' ')],
    stdout: [],
    stderr: [],
    exit_code: 0
  };

  console.log(invocation.cmds[1]);

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
    if (invocation.exit_code !== 0) {
      console.log(invocation.stderr + '');
      return cb(new Error(invocation.exit_code), invocation);
    }
    cb(null, invocation);
  });
};

// loads .cache files containing target metadata
var cache_files = {};
load_cache_file = function(cache_path, cb) {
  var cache = cache_files[cache_path];
  if (exists(cache))
    return cb(cache);

  retrieve(cache_path, function(err, obj) {
    if (err)
      obj = {};

    var cache = cache_files[cache_path];
    if (exists(cache))
      return cb(cache);

    cache_files[cache_path] = obj;
    return cb(obj);
  });
};

save_cache_files = function(cb) {
  var files = Object.keys(cache_files);
  async.forEach(
    files,
    function(file, cb) {
      cache(file, cache_files[file], cb);
    },
    function(err) {
      if (err)
        throw err;
      cb();
    }
  );
};

// hashes the contents of a file
var hash = function(file, cb) {
  var h = crypto.createHash('sha1');
  var s = fs.ReadStream(file);
  s.on('data', function(d) {
    h.update(d);
  });

  s.on('end', function() {
    cb(h.digest('hex'));
  });
};

// tracks trigger updated flags
var updated = {};

// for a given set of files, determines whether invalidation is necessary
exports.invalidate = function(cache_file, root, triggers, cb) {
  load_cache_file(cache_file, function(cache) {
    var triggered = false;

    async.forEach(
      triggers,
      function(trigger, cb) {
        if (trigger in updated) {
          if (updated[trigger] === true)
            triggered = true;
          return cb();
        }

        hash(path.join(root, trigger), function(val) {
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
        cb(triggered);
      }
    );
  });
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
