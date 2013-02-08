var path = require('path');

function PathInfo(p) {
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

// returns a new path info instance
path.info = function(p) {
  return new PathInfo(p);
};